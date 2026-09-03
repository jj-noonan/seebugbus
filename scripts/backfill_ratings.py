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


def safe_commit(conn) -> None:
    """Commit, waiting out another writer rather than dying on it."""
    db.retrying(conn.commit)

spec = importlib.util.spec_from_file_location("crawl", HERE / "crawl.py")
crawl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crawl)


CHUNK = 400


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    conn = db.connect()
    db.init(conn)

    """
    Work in chunks, re-querying the priority queue between each.

    The queue is "unrated, deployed first, then most-listened" — but computed
    once it goes stale immediately. A re-export reshuffles which albums are
    deployed, and a crawl adds new ones; both should jump the line, and with a
    single up-front snapshot neither does. Over a run this long that quietly
    turns the priority ordering into no ordering at all.

    Two workers.

    Measured, not reasoned. Three gave 0.83/sec decaying to 0.54 as MusicBrainz
    began delaying responses (47 read timeouts per 400 lookups). One gave 0.44
    with almost no timeouts — so concurrency does buy net throughput even paying
    the timeout tax, and serial is not the safe-and-fast option it looks like.
    Two sits between them without pushing hard enough to provoke the delays.

    Worth knowing for any future tuning: MusicBrainz throttles by slowing
    responses rather than returning 503, so over-reach looks like their outage
    rather than our load. The only way to tell them apart is to pause all
    requests and probe — ~0.4s responses with the load off means the fault is
    ours.
    """
    print(f"rating up to {limit} albums, re-prioritising every {CHUNK}", flush=True)

    got = 0
    done = 0
    started = time.time()

    while done < limit:
        todo = db.missing_ratings(conn, min(CHUNK, limit - done))
        if not todo:
            print("nothing left unrated")
            break

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(crawl.fetch_rating, m): m for m in todo}
            for i, fut in enumerate(as_completed(futures), 1):
                mbid = futures[fut]
                try:
                    value, votes = fut.result()
                except Exception:
                    # Leave it unrated; the next chunk will offer it again.
                    continue
                db.set_rating(conn, mbid, value, votes)
                if value is not None:
                    got += 1
                done += 1
                # Commit often: each write opens a transaction, and holding the
                # lock for a whole chunk would stall a concurrent export.
                if i % 25 == 0:
                    safe_commit(conn)
        safe_commit(conn)

        rate = done / max(1e-6, time.time() - started)
        left = c_left(conn)
        print(f"  {done} done — {got} rated ({rate:.2f}/sec) "
              f"| deployed still unrated: {left}", flush=True)

    print(f"done: {got}/{done} rated; {db.stats(conn)['withRating']} overall")
    return 0


def c_left(conn) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM items WHERE exported=1 AND rating_votes IS NULL"
    ).fetchone()[0]


if __name__ == "__main__":
    sys.exit(main())
