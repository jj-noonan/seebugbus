#!/usr/bin/env python3
"""
Seed the catalog from the most-listened US artists.

The corridor crawl reaches artists through genre-lineage tags — krautrock,
post-hardcore, spiritual jazz — which are deliberately underground lineages.
Mainstream pop, arena metal, chart hip-hop and standards carry none of those
tags, so corridor crawling can never reach them however long it runs. Measured:
only 56% of the 500 most-listened US artists had a single album.

This comes at it from the other end. ListenBrainz publishes a sitewide artist
ranking; we take it, keep the US ones, and pull their discographies. Corridors
are then inferred from each album's own tags, so a Metallica record lands in
the metal lineage the same way a crawled one would.

  python3 scripts/seed_top_artists.py --top 2000
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db  # noqa: E402

spec = importlib.util.spec_from_file_location("crawl", HERE / "crawl.py")
crawl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crawl)

spec2 = importlib.util.spec_from_file_location("crawl_us", HERE / "crawl_us.py")
crawl_us = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(crawl_us)

log = crawl.log
LB = "https://api.listenbrainz.org/1"


def top_artists(want: int) -> list[dict]:
    """Sitewide listen ranking, newest page at a time."""
    out: list[dict] = []
    for offset in range(0, want * 3, 500):
        try:
            r = requests.get(
                f"{LB}/stats/sitewide/artists",
                params={"count": 500, "offset": offset, "range": "all_time"},
                headers={"User-Agent": crawl.UA}, timeout=40,
            )
            got = r.json().get("payload", {}).get("artists", [])
        except (requests.RequestException, ValueError):
            break
        if not got:
            break
        out.extend(a for a in got if a.get("artist_mbid"))
        time.sleep(0.4)
    return out


def us_only(artists: list[dict]) -> list[dict]:
    """Keep the US ones, asking MusicBrainz forty at a time."""
    info: dict[str, dict] = {}
    ids = [a["artist_mbid"] for a in artists]
    for i in range(0, len(ids), 40):
        chunk = ids[i : i + 40]
        data = crawl.mb_get(
            "/artist/", {"query": " OR ".join(f"arid:{m}" for m in chunk), "limit": 100}
        )
        for a in (data or {}).get("artists", []):
            info[a["id"]] = a
    keep = []
    for a in artists:
        meta = info.get(a["artist_mbid"])
        if meta and meta.get("country") == "US":
            keep.append({**a, "_meta": meta})
    return keep


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=1500, help="how many US artists to seed")
    ap.add_argument("--hours", type=float, default=0)
    args = ap.parse_args()

    conn = db.connect()
    db.init(conn)
    corridors = crawl.load_corridors()
    # tag -> corridor, so an album lands in the lineage its own tags imply
    # rather than the one we happened to find it through.
    tag_map: dict[str, str] = {}
    for c in corridors:
        for t in c["tags"]:
            tag_map.setdefault(t, c["id"])

    log("fetching the sitewide listen ranking")
    ranked = top_artists(args.top)
    log(f"  {len(ranked):,} ranked artists; checking which are US")
    us = us_only(ranked)[: args.top]
    log(f"  {len(us):,} US artists to seed")

    pending = db.artists_pending(conn, [a["artist_mbid"] for a in us])
    log(f"  {len(pending):,} not yet pulled")

    deadline = time.time() + args.hours * 3600 if args.hours else None
    added = 0
    for n, aid in enumerate(pending, 1):
        if deadline and time.time() > deadline:
            log("time budget reached — stopping cleanly")
            break

        entry = next(a for a in us if a["artist_mbid"] == aid)
        meta = entry["_meta"]
        albums = crawl_us.discography(aid)
        if albums:
            db.upsert_artist(conn, {
                "id": aid, "name": meta.get("name") or entry["artist_name"],
                "sortName": meta.get("sort-name"), "country": "US",
            })
            conn.execute(
                "UPDATE artists SET area=?, checked_at=datetime('now') WHERE id=?",
                ((meta.get("area") or {}).get("name"), aid))
            known = db.existing_ids(conn, [a["id"] for a in albums])
            new = [a for a in albums if a["id"] not in known]
            kept = crawl.attach_art(new) if new else []
            for alb in kept:
                names = {t["tag"] for t in alb.get("tags", [])}
                corridor_ids = sorted({tag_map[t] for t in names if t in tag_map})
                db.upsert_album(conn, {
                    **alb,
                    "artistName": meta.get("name") or entry["artist_name"],
                    "corridorIds": corridor_ids,
                })
            added += len(kept)
            log(f"  [{n}/{len(pending)}] {entry['artist_name'][:28]:<28} "
                f"{entry['listen_count']:>9,} listens  +{len(kept)} albums")
        db.mark_artist_done(conn, aid, len(albums))
        conn.commit()

    log(f"done: +{added:,} albums; {db.stats(conn)['albums']:,} total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
