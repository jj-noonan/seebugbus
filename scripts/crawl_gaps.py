#!/usr/bin/env python3
"""
Fetch artists the evaluation says we should be able to reach, and cannot.

Co-listening names ~1,200 artists as similar to one of the suite's seeds.
31% of them were absent from the database entirely — not filtered out of the
export, simply never crawled. The missing list was overwhelmingly mainstream
pop: Adele, Ed Sheeran, The Weeknd, Dua Lipa, Lorde, Harry Styles. The engine
could not offer them because it had never heard of them, which is a different
and much worse problem than ranking them badly, and invisible to any metric
that only inspects what was offered.

The gap is a consequence of how the catalog was built. Crawling by tag finds
artists that tags describe well; a lot of very famous pop is tagged thinly or
generically, so it fell through. Seeding from the similarity graph inverts
that: it asks what a listener would expect next and fetches exactly those.

Deliberately narrow. It takes a list of mbids, pulls each discography, and
stops. Recommendation quality is not the same problem as catalog coverage,
and this script only does the second.

    .venv/bin/python -u scripts/crawl_gaps.py            # from the fixture
    .venv/bin/python -u scripts/crawl_gaps.py --limit 50
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import crawl  # noqa: E402
import db  # noqa: E402
from crawl_us import discography  # noqa: E402

FIXTURE = HERE.parent / "data" / "similar-artists.json"
GRAPH = HERE.parent / "data" / "similarity-graph.json"


def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


def wanted_artists() -> dict[str, str]:
    """
    Artists the fixture names as similar to a seed, mbid -> name.

    Held-out seeds are skipped. Their whole purpose is to measure the engine
    against a catalog assembled without reference to them; crawling what they
    name would stock the catalog with their own answers and turn their score
    into a measurement of this script.
    """
    fx = json.loads(FIXTURE.read_text())
    out: dict[str, str] = {}
    skipped = 0
    held: set[str] = set()
    for seed in fx["seeds"].values():
        if seed.get("heldOut"):
            skipped += 1
            # Remember these so the graph pass cannot smuggle them back in.
            held.update(
                s.get("mbid") or s.get("artist_mbid") or "" for s in seed["similar"]
            )
            continue
        for s in seed["similar"]:
            mbid = s.get("mbid") or s.get("artist_mbid")
            if mbid:
                out[mbid] = s.get("name") or ""
    if skipped:
        log(f"ignoring {skipped} held-out seeds as a crawl source")

    # Widen beyond the seeds' own lists, using the similarity graph.
    #
    # The fixture names ~1,200 artists. The graph covers the 1,500 most-listened
    # artists in the catalog and everyone their lists reach, which is a far
    # larger frontier — and the reason Smashing Pumpkins and Mudhoney were still
    # missing after the first pass: nothing in the 47 seeds' top-100 happened to
    # name them.
    #
    # Held-out territory is excluded here too. The graph would otherwise
    # reintroduce exactly the artists the held-out seeds were meant to keep out
    # of catalog building, quietly undoing the one number in the suite that
    # cannot be gamed.
    if GRAPH.exists():
        graph = json.loads(GRAPH.read_text()).get("edges", {})
        before = len(out)
        for source, targets in graph.items():
            if source in held:
                continue
            for t in targets:
                if t not in out and t not in held:
                    out[t] = ""
        log(f"similarity graph adds {len(out) - before:,} more candidates "
            f"({len(held):,} held-out artists excluded)")

    return out


def reference_counts() -> dict[str, int]:
    """How many sources name each artist as similar to something."""
    counts: dict[str, int] = {}
    fx = json.loads(FIXTURE.read_text())
    for seed in fx["seeds"].values():
        if seed.get("heldOut"):
            continue
        for s in seed["similar"]:
            mbid = s.get("mbid") or s.get("artist_mbid")
            if mbid:
                counts[mbid] = counts.get(mbid, 0) + 1
    if GRAPH.exists():
        for targets in json.loads(GRAPH.read_text()).get("edges", {}).values():
            for t in targets:
                counts[t] = counts.get(t, 0) + 1
    return counts


def artist_info(mbid: str) -> dict | None:
    """Name and origin for one artist. Needed because the fixture has neither."""
    data = crawl.mb_get(f"/artist/{mbid}", {})
    if not data or not data.get("name"):
        return None
    area = (data.get("area") or {}).get("name")
    return {
        "id": mbid,
        "name": data["name"],
        "sortName": data.get("sort-name") or data["name"],
        "country": data.get("country") or None,
        "area": area,
        "beganYear": None,
        "endedYear": None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="0 means every gap")
    ap.add_argument("--hours", type=float, default=0)
    args = ap.parse_args()

    conn = db.connect()
    db.init(conn)

    wanted = wanted_artists()
    have = {r["id"] for r in conn.execute("SELECT id FROM artists")}
    gaps = {k: v for k, v in wanted.items() if k not in have}

    # Most-named first.
    #
    # The frontier is now ~8,000 artists, which is a night of crawling, so any
    # run short of the whole thing takes a slice — and an arbitrary slice is a
    # waste of the budget. An artist named as similar by many different sources
    # is one many listeners would expect to find; one named once is a long tail
    # that can wait. This costs nothing when the whole list is fetched anyway,
    # and matters every time it is not.
    degree = reference_counts()
    gaps = dict(sorted(gaps.items(), key=lambda kv: -degree.get(kv[0], 0)))

    total_gaps = len(gaps)
    if args.limit:
        gaps = dict(list(gaps.items())[: args.limit])

    # Counted before the limit is applied — reporting "held" against a
    # truncated list said 1,193 of 1,196 were present when 368 were missing,
    # which reads exactly like a finished job.
    log(f"{len(wanted):,} artists named similar to a seed, "
        f"{len(wanted) - total_gaps:,} held, {total_gaps:,} missing"
        + (f" — fetching {len(gaps):,} this run" if args.limit else ""))
    deadline = time.time() + args.hours * 3600 if args.hours else None

    added_artists = added_albums = 0
    for n, (mbid, name) in enumerate(gaps.items(), 1):
        if deadline and time.time() > deadline:
            log("time budget reached — stopping cleanly")
            break

        info = artist_info(mbid)
        if not info:
            log(f"  [{n}/{len(gaps)}] {name or mbid}: no artist record, skipping")
            continue

        albums = discography(mbid)
        if not albums:
            # Recorded as done regardless, so a second run does not re-fetch an
            # artist who genuinely has no album-type release groups.
            db.mark_artist_done(conn, mbid, 0)
            conn.commit()
            continue

        db.upsert_artist(conn, info)
        conn.execute(
            "UPDATE artists SET area=?, checked_at=datetime('now') WHERE id=?",
            (info.get("area"), mbid))
        known = db.existing_ids(conn, [a["id"] for a in albums])
        new = [a for a in albums if a["id"] not in known]
        with_art = crawl.attach_art(new) if new else []
        for alb in with_art:
            # No corridor: these come from the similarity graph, not from a tag
            # sweep, so there is no tag to attribute them to. Corridors are no
            # longer used for scoring, and inventing one would be a lie in the
            # data purely to fill a column.
            db.upsert_album(conn, {**alb, "artistName": info["name"], "corridorIds": []})
        db.mark_artist_done(conn, mbid, len(albums))
        conn.commit()

        added_artists += 1
        added_albums += len(with_art)
        if n % 20 == 0 or len(with_art):
            log(f"  [{n}/{len(gaps)}] {info['name']}: +{len(with_art)} albums "
                f"({added_artists} artists, {added_albums} albums so far)")

    log(f"done — added {added_artists:,} artists and {added_albums:,} albums")
    log(f"db now: {db.stats(conn)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
