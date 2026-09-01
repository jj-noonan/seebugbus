#!/usr/bin/env python3
"""
Fold search-ingested albums permanently into the catalog.

The app ingests albums client-side so a search is never a dead end, but that
copy lives in the visitor's browser. This takes the MBIDs it queued and writes
them into SQLite, where the recommender and every future export can see them.

  # in the browser console:  copy(segueQueue().join('\\n'))
  pbpaste | python3 scripts/ingest_mbids.py
  python3 scripts/ingest_mbids.py <mbid> [<mbid> ...]
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("crawl", Path(__file__).parent / "crawl.py")
crawl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crawl)


def fetch_one(mbid: str) -> dict | None:
    """Look up a release group by id, with the tags and artist we need."""
    data = crawl.mb_get(f"/release-group/{mbid}", {"inc": "artists+tags"})
    if not data:
        return None
    return crawl.parse_release_group(data, found_via="")


def main() -> int:
    mbids = [a.strip() for a in sys.argv[1:] if a.strip()]
    if not mbids:
        mbids = [line.strip() for line in sys.stdin if line.strip()]
    mbids = [m for m in mbids if len(m) == 36]
    if not mbids:
        print("no MBIDs given")
        return 1

    conn = db.connect()
    db.init(conn)
    known = db.existing_ids(conn, mbids)
    todo = [m for m in mbids if m not in known]
    print(f"{len(mbids)} given, {len(known)} already held, {len(todo)} to fetch")

    added = 0
    for mbid in todo:
        rec = fetch_one(mbid)
        if not rec:
            print(f"  {mbid}: not found")
            continue
        art = crawl.fetch_art(mbid)
        if not art:
            print(f"  {mbid}: no cover art, skipping")
            continue
        rec["artUrl"], rec["artThumbUrl"] = art
        # Corridors come from the tags, same rule the browser applies, so an
        # ingested album is reachable as a branch rather than stranded.
        names = {t["tag"] for t in rec["tags"]}
        corridors = [c["id"] for c in crawl.load_corridors() if names & set(c["tags"])]

        db.upsert_artist(conn, {
            "id": rec["artistId"], "name": rec["artistName"],
            "sortName": rec.get("artistSortName"), "country": rec.get("artistCountry"),
        })
        db.upsert_album(conn, {**rec, "corridorIds": corridors})
        conn.commit()
        added += 1
        print(f"  + {rec['artistName']} — {rec['title']} ({rec['year']}) {corridors or '(no corridor)'}")

    counts = crawl.fetch_listen_counts([m for m in todo])
    if counts:
        db.set_listen_counts(conn, counts)
        conn.commit()
    print(f"added {added}; db now {db.stats(conn)['albums']} albums")
    return 0


if __name__ == "__main__":
    sys.exit(main())
