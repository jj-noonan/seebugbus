#!/usr/bin/env python3
"""
Crawl US artists in our corridors, and take their whole discography.

A different shape from the tag/decade crawl, for a reason. Release-group search
has no artist-origin field — its `country` means the territory a record was
*released* in, so a German band's US pressing matches. The artist index does
have origin, so US-ness has to be decided there:

    artist?query=tag:"post-punk" AND country:US   ->  US artists in that lineage
    release-group?artist=<mbid>                   ->  everything they made

That second call is the efficiency: one request buys an artist's entire
discography rather than one page of mixed results. Cover art is still one
Archive lookup per album, which remains the real cost.

Resumable throughout — per-tag offsets and a per-artist done-marker, so a
corridor naming an artist we already pulled costs nothing.

  python3 scripts/crawl_us.py --hours 8
"""
from __future__ import annotations

import argparse
import importlib.util
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db  # noqa: E402

spec = importlib.util.spec_from_file_location("crawl", HERE / "crawl.py")
crawl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crawl)

log = crawl.log


def us_artists(tag: str, offset: int, pages: int) -> tuple[list[dict], int, bool, int | None]:
    """One page-window of US artists carrying `tag`."""
    out: list[dict] = []
    total: int | None = None
    answered = False
    exhausted = False

    for _ in range(pages):
        data = crawl.mb_get(
            "/artist/",
            {"query": f'tag:"{tag}" AND country:US', "limit": 100, "offset": offset},
        )
        if not data:
            break
        answered = True
        total = data.get("count", total)
        artists = data.get("artists", [])
        offset += len(artists)
        if len(artists) < 100:
            exhausted = True
        for a in artists:
            if a.get("id"):
                out.append({
                    "id": a["id"],
                    "name": a.get("name") or "",
                    "sortName": a.get("sort-name"),
                    "country": a.get("country"),
                    "area": (a.get("area") or {}).get("name"),
                })
        if exhausted:
            break

    if not answered:
        return ([], offset, False, total)
    return (out, offset, exhausted, total)


def discography(artist_id: str) -> list[dict]:
    """Every album-type release group for one artist, in a single request."""
    data = crawl.mb_get(
        "/release-group",
        {"artist": artist_id, "type": "album", "limit": 100},
    )
    if not data:
        return []
    out = []
    for rg in data.get("release-groups", []):
        secondary = [s.lower() for s in (rg.get("secondary-types") or [])]
        if any(s in ("compilation", "live", "remix", "dj-mix") for s in secondary):
            continue
        m = re.match(r"^(\d{4})", rg.get("first-release-date") or "")
        year = int(m.group(1)) if m else None
        if year is None or year < 1948 or year > 2026:
            continue
        tags = [
            {"tag": t["name"].lower(), "count": int(t.get("count") or 1)}
            for t in (rg.get("tags") or []) if t.get("name")
        ]
        out.append({
            "id": rg["id"], "title": rg.get("title") or "",
            "artistId": artist_id, "year": year, "tags": tags,
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=2, help="artist pages per tag per sweep")
    ap.add_argument("--hours", type=float, default=0)
    ap.add_argument("--export", default=str(HERE.parent / "src" / "data" / "catalog.json"))
    ap.add_argument("--export-limit", type=int, default=12000)
    ap.add_argument("--ratings", type=int, default=50,
                    help="rating lookups per tag; 0 to skip")
    args = ap.parse_args()

    conn = db.connect()
    db.init(conn)
    corridors = crawl.load_corridors()
    tags = [t for c in corridors for t in c["tags"]]
    tag_corridor = {t: c["id"] for c in corridors for t in c["tags"]}
    deadline = time.time() + args.hours * 3600 if args.hours else None

    while True:
        state = db.us_tag_state(conn)
        open_tags = [t for t in tags if not (state.get(t) or {"exhausted": 0})["exhausted"]]
        if not open_tags:
            log("every tag exhausted for US artists")
            break

        p = db.us_progress(conn)
        log(f"sweep: {len(open_tags)} tags open, {p['artistsSeen']:,} artists pulled, "
            f"{db.stats(conn)['albums']:,} albums held")

        for n, tag in enumerate(open_tags, 1):
            if deadline and time.time() > deadline:
                log("time budget reached — stopping cleanly")
                return 0

            row = state.get(tag)
            offset = row["next_offset"] if row else 0
            found, next_offset, exhausted, total = us_artists(tag, offset, args.pages)
            if not found and next_offset == offset and not exhausted:
                log(f"  {tag}: MusicBrainz unreachable, will retry")
                continue

            fresh = db.artists_pending(conn, [a["id"] for a in found])
            by_id = {a["id"]: a for a in found}
            kept_albums = 0

            for aid in fresh:
                info = by_id[aid]
                albums = discography(aid)
                if albums:
                    db.upsert_artist(conn, info)
                    conn.execute(
                        "UPDATE artists SET area=?, checked_at=datetime('now') WHERE id=?",
                        (info.get("area"), aid))
                    known = db.existing_ids(conn, [a["id"] for a in albums])
                    new = [a for a in albums if a["id"] not in known]
                    with_art = crawl.attach_art(new) if new else []
                    for alb in with_art:
                        db.upsert_album(conn, {
                            **alb, "artistName": info["name"],
                            "corridorIds": [tag_corridor[tag]],
                        })
                    kept_albums += len(with_art)
                db.mark_artist_done(conn, aid, len(albums))
                conn.commit()

            db.save_us_tag(conn, tag, next_offset, exhausted, total, len(fresh))
            conn.commit()
            if fresh or exhausted:
                log(f"  [{n}/{len(open_tags)}] {tag} @{offset}: {len(found)} US artists, "
                    f"{len(fresh)} new, +{kept_albums} albums"
                    f"{' (tag exhausted)' if exhausted else ''} of {total}")

            # Ratings run inside this loop rather than as a second process.
            # Two processes would each pace themselves at 1 req/sec and
            # together exceed MusicBrainz's limit — the rate gate is
            # per-process — which is what caused the throttling stalls before.
            # Sharing one gate keeps both inside the budget, and the queue is
            # already "deployed first, then most-listened", so albums this
            # crawl just added get picked up on their own.
            if args.ratings:
                todo = db.missing_ratings(conn, args.ratings)
                if todo:
                    got = 0
                    for mbid in todo:
                        value, votes = crawl.fetch_rating(mbid)
                        db.set_rating(conn, mbid, value, votes)
                        got += value is not None
                    conn.commit()
                    log(f"    rated {got}/{len(todo)}; "
                        f"{db.stats(conn)['withRating']:,} rated overall")

            if n % 10 == 0 and args.export:
                import export_catalog as ex
                ex.export(conn, Path(args.export), args.export_limit)
                log(f"    ...{db.stats(conn)['albums']:,} albums in db")

    return 0


if __name__ == "__main__":
    sys.exit(main())
