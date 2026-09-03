#!/usr/bin/env python3
"""
Recover tags for albums fetched without them.

The US crawl pulled discographies through the browse endpoint without
`inc=tags`, which returns none — leaving 24,764 albums with no tags at all.
That is not a cosmetic gap: the recommender derives all seven axes from tags,
so a tagless album sits at the exact centre of the space, and the client's
lexicon-coverage filter drops it on load.

Repairs by artist rather than by album: one browse request returns the whole
discography's tags, so ~3,000 requests fix ~25,000 albums.

  python3 scripts/backfill_tags.py
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

log = crawl.log


def main() -> int:
    conn = db.connect()
    db.init(conn)
    corridors = crawl.load_corridors()
    tag_map: dict[str, str] = {}
    for c in corridors:
        for t in c["tags"]:
            tag_map.setdefault(t, c["id"])

    artists = [r["artist_id"] for r in conn.execute(
        """SELECT DISTINCT i.artist_id FROM items i
           WHERE i.artist_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id)""")]
    log(f"{len(artists):,} artists have albums missing tags "
        f"(~{len(artists) * 1.1 / 60:.0f} min)")

    fixed = 0
    for n, aid in enumerate(artists, 1):
        data = crawl.mb_get(
            "/release-group",
            {"artist": aid, "type": "album", "inc": "tags", "limit": 100},
        )
        if not data:
            continue

        # A browse returns the artist's whole release-group list, including
        # ones we never stored — filtered out earlier for missing cover art or
        # an unusable date. Tagging those violates the foreign key, so keep to
        # the albums we actually hold.
        ours = {r["id"] for r in conn.execute(
            "SELECT id FROM items WHERE artist_id = ?", (aid,))}

        for rg in data.get("release-groups", []):
            if rg["id"] not in ours:
                continue
            tags = [
                {"tag": t["name"].lower(), "count": int(t.get("count") or 1)}
                for t in (rg.get("tags") or []) if t.get("name")
            ]
            if not tags:
                continue
            conn.executemany(
                """INSERT INTO item_tags (item_id, tag, count) VALUES (?,?,?)
                   ON CONFLICT(item_id, tag) DO UPDATE SET
                     count=MAX(item_tags.count, excluded.count)""",
                [(rg["id"], t["tag"], t["count"]) for t in tags])
            # Corridors follow from the tags we just learned.
            names = {t["tag"] for t in tags}
            for cid in {tag_map[t] for t in names if t in tag_map}:
                conn.execute(
                    "INSERT OR IGNORE INTO item_corridors (item_id, corridor_id) VALUES (?,?)",
                    (rg["id"], cid))
            fixed += 1
        conn.commit()

        if n % 200 == 0:
            left = conn.execute(
                """SELECT COUNT(*) FROM items i WHERE NOT EXISTS
                   (SELECT 1 FROM item_tags t WHERE t.item_id = i.id)""").fetchone()[0]
            log(f"  {n:,}/{len(artists):,} artists — {fixed:,} albums tagged, "
                f"{left:,} still bare")

    left = conn.execute(
        """SELECT COUNT(*) FROM items i WHERE NOT EXISTS
           (SELECT 1 FROM item_tags t WHERE t.item_id = i.id)""").fetchone()[0]
    log(f"done: {fixed:,} albums tagged; {left:,} remain without any")
    return 0


if __name__ == "__main__":
    sys.exit(main())
