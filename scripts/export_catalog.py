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


def scores(rows) -> dict[str, tuple[float, float]]:
    """
    Two 0-10 scores per album: popularity, then quality.

    Popularity is distinct listeners, not plays — plays are dominated by
    whoever put a record on two hundred times, while the number of separate
    people who reached for it is what the word actually means.

    Quality blends two things:

      devotion — listens per listener. It cleanly separates records people
        return to from records people tried once: Burial's Untrue scores 48
        plays per listener against Skrillex's 9.9, despite similar totals. It
        is shrunk toward the catalog mean by listener count, so an album with
        one obsessive listener doesn't outrank a classic.

      rating — the MusicBrainz community score, where it exists. Authoritative
        but sparse and expensive to collect, so it is a bonus on top of
        devotion rather than the basis.

    Both are percentile-ranked, which self-calibrates as the catalog grows and
    always spans the full range.
    """
    import statistics

    devotions = []
    for r in rows:
        listeners = r["listener_count"] or 0
        if listeners >= 5:
            devotions.append((r["listen_count"] or 0) / listeners)
    prior = statistics.median(devotions) if devotions else 8.0

    raw_pop: dict[str, float] = {}
    raw_q: dict[str, float] = {}
    for r in rows:
        listeners = r["listener_count"]
        listens = r["listen_count"] or 0
        raw_pop[r["id"]] = float(listeners) if listeners is not None else -1.0

        if listeners:
            # Bayesian shrink: with few listeners, trust the catalog median.
            k = 12
            devotion = (listens + prior * k) / (listeners + k)
        else:
            devotion = prior * 0.6  # unknown reads slightly below average

        rating, votes = r["rating"], r["rating_votes"] or 0
        if rating is not None and votes >= 2:
            # Same shrink for a 5-star score with few votes.
            adj = (rating * votes + 3.4 * 6) / (votes + 6)
            devotion *= 0.65 + (adj / 5.0) * 0.7
        raw_q[r["id"]] = devotion

    def percentiles(raw: dict[str, float]) -> dict[str, float]:
        known = sorted((v, k) for k, v in raw.items() if v >= 0)
        n = max(1, len(known) - 1)
        out = {k: 0.0 for k in raw}
        for i, (_, k) in enumerate(known):
            out[k] = round((i / n) * 10, 1)
        return out

    pop = percentiles(raw_pop)
    qual = percentiles(raw_q)
    return {k: (pop[k], qual[k]) for k in raw_pop}


def select(rows, score: dict[str, tuple[float, float]], limit: int | None):
    """
    Choose which albums make it into the capped export.

    Not simply the most-listened. Taking the top N by reach quietly truncates
    the whole obscure half of the catalog — and the far end of the terrain dial
    aims squarely at that half, so the app would ask for deep cuts it no longer
    contained. Instead: sample across all ten popularity deciles, tilted
    modestly toward the well-known because those are also what people search
    for, keeping the tail genuinely represented.

    Within each decile the highest-quality records win the slots, so a smaller
    export is a better one rather than merely a shorter one.
    """
    if not limit or len(rows) <= limit:
        return list(rows)

    by_decile: dict[int, list] = {i: [] for i in range(10)}
    for r in rows:
        pop = score[r["id"]][0]
        by_decile[min(9, int(pop))].append(r)

    # 0.7 at the bottom rising to 1.3 at the top.
    weights = [0.7 + (i / 9) * 0.6 for i in range(10)]
    live = [i for i in range(10) if by_decile[i]]
    total = sum(weights[i] for i in live) or 1.0

    out = []
    for i in live:
        take = round(limit * weights[i] / total)
        ranked = sorted(by_decile[i], key=lambda r: score[r["id"]][1], reverse=True)
        out.extend(ranked[:take])

    # Rounding can leave slack; fill it with the best of what's left over.
    if len(out) < limit:
        chosen = {r["id"] for r in out}
        rest = sorted(
            (r for r in rows if r["id"] not in chosen),
            key=lambda r: score[r["id"]][1], reverse=True,
        )
        out.extend(rest[: limit - len(out)])
    return out[:limit]


def export(conn: sqlite3.Connection, out: Path, limit: int | None = None) -> dict:
    all_rows = conn.execute("""
        SELECT i.id, i.title, i.artist_id, i.year_start, i.art_url, i.art_thumb_url,
               i.listen_count, i.listener_count, i.rating, i.rating_votes,
               a.name AS artist_name
        FROM items i LEFT JOIN artists a ON a.id = i.artist_id
        WHERE i.art_url IS NOT NULL
    """).fetchall()

    # Score against the whole catalog, so percentiles mean the same thing
    # regardless of what the export happens to keep.
    score = scores(all_rows)
    rows = select(all_rows, score, limit)
    keep = {r["id"] for r in rows}

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
        "listenerCount": r["listener_count"],
        "popularity": score[r["id"]][0],
        "quality": score[r["id"]][1],
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
