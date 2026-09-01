#!/usr/bin/env python3
"""
Fetch MusicBrainz community ratings, most-listened first.

There is no bulk endpoint — one rate-limited request per album — so coverage
can only ever be partial and the ORDER is what makes it valuable. Rating the
records someone might actually be offered is worth far more than grinding
through the tail alphabetically.

Run this with the crawler stopped; both share MusicBrainz's 1 req/sec budget
and running them together just earns 403s.

  python3 scripts/backfill_ratings.py 5000
"""
from __future__ import annotations

import importlib.util
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db  # noqa: E402

spec = importlib.util.spec_from_file_location("crawl", HERE / "crawl.py")
crawl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crawl)


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    conn = db.connect()
    db.init(conn)
    todo = db.missing_ratings(conn, limit)

    """
    Three workers, not one.

    A rating lookup takes about 2s of round-trip, so a serial loop runs at
    0.5 req/sec — only half of what MusicBrainz allows. The rate gate in
    mb_get paces request *starts* and releases its lock before the call, so
    overlapping a few in flight keeps the cadence legal while roughly tripling
    throughput. Writes stay on this thread; SQLite connections are not
    thread-safe.
    """
    print(f"rating {len(todo)} albums, deployed first "
          f"(~{len(todo) * 1.1 / 3600:.1f}h at ~1 req/sec)", flush=True)

    got = 0
    done = 0
    started = time.time()
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(crawl.fetch_rating, m): m for m in todo}
        for fut in as_completed(futures):
            mbid = futures[fut]
            try:
                value, votes = fut.result()
            except Exception:
                continue
            db.set_rating(conn, mbid, value, votes)
            if value is not None:
                got += 1
            done += 1
            # Commit often. Each set_rating opens a write transaction, so
            # batching 200 of them held SQLite's write lock for ~4 minutes at a
            # time — long enough to blow through a 30s busy_timeout and abort a
            # concurrent export.
            if done % 25 == 0:
                conn.commit()
            if done % 200 == 0:
                rate = done / max(1e-6, time.time() - started)
                print(f"  {done}/{len(todo)} — {got} rated "
                      f"({rate:.2f}/sec, {(len(todo)-done)/rate/3600:.1f}h left)",
                      flush=True)
    conn.commit()
    print(f"done: {got}/{len(todo)} rated; {db.stats(conn)['withRating']} overall")
    return 0


if __name__ == "__main__":
    sys.exit(main())
