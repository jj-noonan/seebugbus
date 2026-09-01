#!/usr/bin/env python3
"""
Fill in ListenBrainz popularity for albums that don't have it yet.

The crawler only does this at the end of a sweep, and a sweep is long. Between
sweeps, freshly harvested albums carry no listener count — which matters more
than it sounds: the export stratifies by popularity decile, so albums with no
data would all pile into the bottom band and crowd out the genuine deep cuts
that band is meant to hold.

Cheap to run: 50 albums per request, no rate limit worth worrying about.

  python3 scripts/backfill_popularity.py
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db  # noqa: E402

spec = importlib.util.spec_from_file_location("crawl", HERE / "crawl.py")
crawl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crawl)


def main() -> int:
    conn = db.connect()
    db.init(conn)
    todo = db.missing_listen_counts(conn, 200000)
    if not todo:
        print("popularity already complete")
        return 0

    print(f"backfilling popularity for {len(todo)} albums")
    got = 0
    for i in range(0, len(todo), 2000):
        chunk = todo[i : i + 2000]
        pop = crawl.fetch_popularity(chunk)
        db.set_popularity(conn, pop)
        conn.commit()
        got += len(pop)
        print(f"  {i + len(chunk)}/{len(todo)} scanned, {got} with data", flush=True)

    print("stats:", db.stats(conn))
    return 0


if __name__ == "__main__":
    sys.exit(main())
