#!/usr/bin/env python3
"""
Rebuild corridor membership from the tags an album actually carries.

The corridor crawl filed each album under the tag it *searched*, but
MusicBrainz tag search is fuzzy: a query for tag:"folk" returns records tagged
only "folk rock". Born in the U.S.A. ended up in folk-ambient — a lineage that
runs to drone and ambient — and since folk-ambient legitimately borders
minimalism, the engine then offered Ornette Coleman's In All Languages as a
reasonable next step. 17% of all corridor assignments had no exact tag support.

Corridors are re-derived here from exact tag matches only. An album with no
matching tag gets no corridor, which is honest: it can still be reached by
distance, it just can't be the far side of a lineage crossing it doesn't belong
to.

  python3 scripts/rederive_corridors.py
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

    tag_map: dict[str, list[str]] = {}
    for c in crawl.load_corridors():
        for t in c["tags"]:
            tag_map.setdefault(t, []).append(c["id"])

    before = conn.execute("SELECT COUNT(*) FROM item_corridors").fetchone()[0]

    rows = conn.execute(
        """SELECT t.item_id, t.tag FROM item_tags t
           WHERE t.tag IN (%s)""" % ",".join("?" * len(tag_map)),
        list(tag_map),
    ).fetchall()

    derived: dict[str, set[str]] = {}
    for r in rows:
        for cid in tag_map[r["tag"]]:
            derived.setdefault(r["item_id"], set()).add(cid)

    conn.execute("DELETE FROM item_corridors")
    conn.executemany(
        "INSERT OR IGNORE INTO item_corridors (item_id, corridor_id) VALUES (?,?)",
        [(item, cid) for item, cids in derived.items() for cid in cids],
    )
    conn.commit()

    after = conn.execute("SELECT COUNT(*) FROM item_corridors").fetchone()[0]
    with_any = conn.execute(
        "SELECT COUNT(DISTINCT item_id) FROM item_corridors").fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    print(f"assignments {before:,} -> {after:,}")
    print(f"albums with at least one corridor: {with_any:,} of {total:,} "
          f"({100 * with_any / total:.0f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
