#!/usr/bin/env python3
"""
SQLite -> catalog.json for the browser app.

A stopgap by design: the app loads the whole catalog into the bundle, which
stops being viable in the tens of thousands. Until the API exists, the export
is capped and takes the most-listened albums, so a huge crawl still yields a
usable app instead of an unloadable one.

  python3 scripts/export_catalog.py --limit 12000
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


CAA_PREFIX = "https://coverartarchive.org/release/"


def art_path(url: str | None) -> str | None:
    """Strip the shared prefix and the size suffix; the client re-adds both."""
    if not url or not url.startswith(CAA_PREFIX):
        return url
    rest = url[len(CAA_PREFIX):]
    for suffix in ("-500.jpg", "-250.jpg", "-1200.jpg", ".jpg"):
        if rest.endswith(suffix):
            return rest[: -len(suffix)]
    return rest


def export(conn: sqlite3.Connection, out: Path, limit: int | None = None) -> dict:
    where = "WHERE i.art_url IS NOT NULL"
    order = "ORDER BY i.listen_count IS NULL, i.listen_count DESC"
    cap = f" LIMIT {int(limit)}" if limit else ""

    rows = conn.execute(f"""
        SELECT i.id, i.title, i.artist_id, i.year_start, i.art_url, i.art_thumb_url,
               i.listen_count, a.name AS artist_name
        FROM items i LEFT JOIN artists a ON a.id = i.artist_id
        {where} {order}{cap}
    """).fetchall()
    ids = [r["id"] for r in rows]
    keep = set(ids)

    tags: dict[str, list] = defaultdict(list)
    for r in conn.execute("SELECT item_id, tag, count FROM item_tags"):
        if r["item_id"] in keep:
            tags[r["item_id"]].append({"tag": r["tag"], "count": r["count"]})

    corridors: dict[str, list] = defaultdict(list)
    for r in conn.execute("SELECT item_id, corridor_id FROM item_corridors"):
        if r["item_id"] in keep:
            corridors[r["item_id"]].append(r["corridor_id"])

    albums = [{
        "id": r["id"], "title": r["title"], "artistId": r["artist_id"],
        "artistName": r["artist_name"] or "", "year": r["year_start"],
        # Just the path, not the URL. Every cover lives under the same Cover Art
        # Archive prefix, and the 500px and 250px variants differ only by a
        # suffix — so storing two full URLs per album repeated ~36 identical
        # characters 24,000 times. The client rebuilds both from this.
        "art": art_path(r["art_url"]),
        "tags": tags.get(r["id"], []), "corridorIds": corridors.get(r["id"], []),
        "listenCount": r["listen_count"],
    } for r in rows]

    artist_ids = {a["artistId"] for a in albums if a["artistId"]}
    artists = [{
        "id": r["id"], "name": r["name"], "sortName": r["sort_name"],
        "country": r["country"], "beganYear": r["began_year"], "endedYear": r["ended_year"],
    } for r in conn.execute("SELECT * FROM artists") if r["id"] in artist_ids]

    done = [r["corridor_id"] for r in conn.execute(
        """SELECT corridor_id FROM crawl_tags WHERE done_at IS NOT NULL
           GROUP BY corridor_id""")]

    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "stats": {
            "albums": len(albums), "artists": len(artists),
            "withArt": sum(1 for a in albums if a["art"]),
            "corridorsComplete": sorted(done),
            "totalInDb": db.stats(conn)["albums"],
        },
        "artists": artists, "albums": albums,
    }
    tmp = out.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False))
    tmp.replace(out)  # atomic: the dev server never reads a half-written file
    return payload["stats"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(db.DEFAULT_DB))
    ap.add_argument("--out", default=str(ROOT / "src" / "data" / "catalog.json"))
    ap.add_argument("--limit", type=int, default=12000)
    args = ap.parse_args()

    conn = db.connect(args.db)
    db.init(conn)
    stats = export(conn, Path(args.out), args.limit or None)
    print(f"exported {stats['albums']} of {stats['totalInDb']} albums -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
