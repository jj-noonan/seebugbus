#!/usr/bin/env python3
"""
One-time import of the JSON crawl state into SQLite.

Preserves everything already harvested — albums, artists, tags, corridor
memberships, listen counts and which corridor/tag pairs are finished — so the
migration costs no re-crawling.

  python3 scripts/migrate_json_to_sqlite.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "scripts" / ".crawl-state.json"


def main() -> int:
    if not STATE.exists():
        print("no JSON state to migrate")
        return 0

    state = json.loads(STATE.read_text())
    conn = db.connect()
    db.init(conn)

    artists = state.get("artists", {})
    albums = state.get("albums", {})
    print(f"migrating {len(albums)} albums / {len(artists)} artists")

    for a in artists.values():
        db.upsert_artist(conn, a)
    conn.commit()

    names = {a["id"]: a["name"] for a in artists.values()}
    for i, alb in enumerate(albums.values(), 1):
        alb = {**alb, "artistName": alb.get("artistName") or names.get(alb["artistId"], "")}
        db.upsert_album(conn, alb)
        if i % 2000 == 0:
            conn.commit()
            print(f"  {i}…")
    conn.commit()

    # doneTags were stored as "corridor/tag"; tag names themselves contain no
    # slashes, so a single split from the left is unambiguous.
    for key in state.get("doneTags", []):
        corridor, _, tag = key.partition("/")
        if corridor and tag:
            conn.execute(
                """INSERT OR IGNORE INTO crawl_tags (corridor_id, tag, done_at)
                   VALUES (?,?,datetime('now'))""",
                (corridor, tag),
            )
    conn.commit()

    print("done:", db.stats(conn))
    return 0


if __name__ == "__main__":
    sys.exit(main())
