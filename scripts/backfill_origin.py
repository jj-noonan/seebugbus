#!/usr/bin/env python3
"""
Fill in where each artist is from.

The crawler stored artist country from release-group search results, but that
index never returns it — all 35,595 artists were NULL. This asks the artist
index instead, forty at a time via `arid:X OR arid:Y ...`, which turns a
ten-hour serial backfill into about fifteen minutes.

MusicBrainz leaves `country` blank for artists whose origin is recorded only as
a sub-country area ("Denver"), and its own `country:US` filter does not resolve
those either. So an artist ends up in one of three states, and the difference
matters when weighting: confirmed US, confirmed elsewhere, or genuinely unknown
— which is not the same as foreign.

  python3 scripts/backfill_origin.py
"""
from __future__ import annotations

import importlib.util
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db  # noqa: E402

spec = importlib.util.spec_from_file_location("crawl", HERE / "crawl.py")
crawl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crawl)

BATCH = 40  # keeps the Lucene query near 1.8KB, well inside URL limits


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 200000
    conn = db.connect()
    db.init(conn)
    todo = db.artists_missing_origin(conn, limit)
    if not todo:
        print("every artist already has an origin recorded")
        return 0

    print(f"looking up {len(todo):,} artists, {BATCH} per request "
          f"(~{len(todo) / BATCH * 1.1 / 60:.0f} min)", flush=True)

    done = 0
    for i in range(0, len(todo), BATCH):
        chunk = todo[i : i + BATCH]
        query = " OR ".join(f"arid:{a}" for a in chunk)
        data = crawl.mb_get("/artist/", {"query": query, "limit": 100})

        found = {}
        for a in (data or {}).get("artists", []):
            found[a["id"]] = (a.get("country"), (a.get("area") or {}).get("name"))

        # Record a row for every artist asked about, not only those that came
        # back — otherwise an artist MusicBrainz has no origin for is retried
        # forever.
        rows = [(aid, *found.get(aid, (None, None))) for aid in chunk]
        db.set_artist_origin(conn, rows)
        conn.commit()
        done += len(chunk)

        if done % 2000 < BATCH:
            s = db.origin_summary(conn)
            print(f"  {done:,}/{len(todo):,} — US {s['us']:,} | "
                  f"elsewhere {s['foreign']:,} | unknown {s['unknown']:,}", flush=True)

    s = db.origin_summary(conn)
    print(f"done: {s['checked']:,} checked | US {s['us']:,} "
          f"({100*s['us']/max(1,s['checked']):.0f}%) | elsewhere {s['foreign']:,} | "
          f"unknown {s['unknown']:,} | US albums {s['usAlbums']:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
