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
    print(f"rating {len(todo)} albums (~{len(todo) * 1.3 / 60:.0f} min at 1 req/sec)")

    got = 0
    for i, mbid in enumerate(todo, 1):
        value, votes = crawl.fetch_rating(mbid)
        db.set_rating(conn, mbid, value, votes)
        if value is not None:
            got += 1
        if i % 100 == 0:
            conn.commit()
            print(f"  {i}/{len(todo)} — {got} had a rating", flush=True)
    conn.commit()
    print(f"done: {got}/{len(todo)} rated; {db.stats(conn)['withRating']} overall")
    return 0


if __name__ == "__main__":
    sys.exit(main())
