#!/usr/bin/env python3
"""
Fetch independent artist-similarity ground truth for the evaluation suite.

Source: ListenBrainz Labs `similar-artists`, which derives similarity from
collaborative filtering over real listening sessions. That independence is the
whole point — our engine reasons from MusicBrainz tags, so validating against a
tag-derived source would only confirm we agree with ourselves. Co-listening
data knows nothing about our axes, our lexicon, or our corridors.

Results are cached to data/similar-artists.json so the suite runs offline and
reproducibly; re-run this only to refresh the fixture.

  python3 scripts/fetch_similar.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db  # noqa: E402

OUT = HERE.parent / "data" / "similar-artists.json"
GRAPH = HERE.parent / "data" / "similarity-graph.json"
LABS = "https://labs.api.listenbrainz.org/similar-artists/json"
ALGO = ("session_based_days_7500_session_300_contribution_5_"
        "threshold_10_limit_100_filter_True_skip_30")
UA = "seebugbus-eval/0.1 (jj@noonan.cc)"

# Deliberately spread across idioms so the suite can't pass by being good at
# one kind of music: stadium pop, heartland rock, jam band, blues revival,
# alt-country, hip-hop, indie rock, classic soul.
# Seeds for the evaluation fixture.
#
# The first ten were the artists picked to sanity-check paths by hand. Ten
# seeds and 100 offers turned out to be too thin to tune against: a three-point
# difference is three offers, which is noise, and knob sweeps were landing
# inside it. The rest widen the base deliberately across era, genre and fame,
# because a suite drawn only from canonical American rock would happily approve
# an engine that is good at canonical American rock.
#
# Skipped silently if absent from the catalog, so this list can name artists
# the crawl has not reached yet.
SEEDS = [
    # The original hand-checked set.
    "Taylor Swift", "Bruce Springsteen", "Grateful Dead", "Alabama Shakes",
    "Wilco", "Kendrick Lamar", "The National", "Stevie Wonder",
    "Fleetwood Mac", "Nirvana",
    # Rock and pop across five decades.
    "The Beatles", "David Bowie", "Fleet Foxes", "Radiohead", "Pixies",
    "Talking Heads", "Joni Mitchell", "Prince", "Beyoncé", "Lana Del Rey",
    "R.E.M.", "Pavement", "The Cure", "Kate Bush", "Sonic Youth",
    # Country, folk and soul.
    "Dolly Parton", "Johnny Cash", "Aretha Franklin", "Marvin Gaye",
    "Emmylou Harris", "Sturgill Simpson", "Bill Withers",
    # Hip hop and R&B.
    "OutKast", "A Tribe Called Quest", "Missy Elliott", "Frank Ocean",
    "Nas", "SZA",
    # Electronic, jazz and further out.
    "Aphex Twin", "Daft Punk", "Burial", "Miles Davis", "John Coltrane",
    "Alice Coltrane", "Portishead", "Björk", "Brian Eno", "Fela Kuti",
    "Sigur Rós", "Massive Attack",
]


def main() -> int:
    conn = db.connect()
    out: dict[str, dict] = {}

    for name in SEEDS:
        row = conn.execute(
            """SELECT a.id, a.name, COUNT(i.id) n FROM artists a
               JOIN items i ON i.artist_id = a.id
               WHERE a.name = ? GROUP BY a.id ORDER BY n DESC LIMIT 1""",
            (name,),
        ).fetchone()
        if not row:
            print(f"  {name}: not in the catalog, skipping")
            continue

        try:
            r = requests.get(
                LABS,
                params={"artist_mbids": row["id"], "algorithm": ALGO},
                headers={"User-Agent": UA}, timeout=40,
            )
            payload = r.json()
        except (requests.RequestException, ValueError) as e:
            print(f"  {name}: fetch failed ({e})")
            continue

        # The response is a flat array of artist objects. (An earlier version
        # looked for a {"data": [...]} wrapper and silently found nothing for
        # every seed — worth stating plainly since a wrong shape here fails
        # quietly rather than loudly.)
        rows = payload if isinstance(payload, list) else []
        similar = [
            {"mbid": x.get("artist_mbid"), "name": x.get("name"), "score": x.get("score")}
            for x in rows if x.get("artist_mbid")
        ]
        if not similar:
            print(f"  {name}: no similarity data")
            continue

        out[row["id"]] = {
            "name": row["name"],
            "albumsInCatalog": row["n"],
            "similar": similar,
        }
        print(f"  {name}: {len(similar)} similar artists, {row['n']} albums held")
        time.sleep(0.5)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "ListenBrainz Labs similar-artists",
        "algorithm": ALGO,
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "seeds": out,
    }, indent=1))
    print(f"\nwrote {len(out)} seeds -> {OUT}")
    return 0




def build_graph(limit: int = 1500) -> int:
    """
    Fetch similar-artist lists for the catalog's most-listened artists.

    The per-seed fixture above truncates at 100, and similarity is not
    symmetric: Calexico does not appear in Wilco's top 100, but Wilco appears in
    Calexico's. Measured, 15% of the engine's apparent failures were exactly
    this — real similarity hidden by a one-directional cut, which made the
    evaluation understate agreement by roughly half.

    A graph over many artists lets the suite accept a pair when EITHER direction
    knows the other, which is both more accurate and more stable.

    Note for later: this graph is evaluation ground truth. If it is ever fed
    into the engine as a recommendation signal, it stops being independent and
    the suite has to find a different source.
    """
    conn = db.connect()
    rows = conn.execute(
        """SELECT a.id, a.name, SUM(i.listener_count) tot FROM artists a
           JOIN items i ON i.artist_id = a.id
           WHERE i.listener_count IS NOT NULL
           GROUP BY a.id ORDER BY tot DESC LIMIT ?""", (limit,)).fetchall()
    print(f"building similarity graph over {len(rows):,} artists "
          f"(~{len(rows) * 0.55 / 60:.0f} min)", flush=True)

    graph: dict[str, list[str]] = {}
    for n, r in enumerate(rows, 1):
        try:
            resp = requests.get(
                LABS, params={"artist_mbids": r["id"], "algorithm": ALGO},
                headers={"User-Agent": UA}, timeout=40)
            data = resp.json() if resp.status_code == 200 else []
        except (requests.RequestException, ValueError):
            data = []
        if isinstance(data, list) and data:
            graph[r["id"]] = [x["artist_mbid"] for x in data if x.get("artist_mbid")]
        time.sleep(0.45)
        if n % 200 == 0:
            print(f"  {n:,}/{len(rows):,} — {len(graph):,} with data", flush=True)
            GRAPH.write_text(json.dumps({"algorithm": ALGO, "edges": graph}))

    GRAPH.write_text(json.dumps({"algorithm": ALGO, "edges": graph}))
    total = sum(len(v) for v in graph.values())
    print(f"wrote {len(graph):,} artists, {total:,} edges -> {GRAPH}")
    return 0


if __name__ == "__main__":
    if "--graph" in sys.argv:
        sys.exit(build_graph())
    sys.exit(main())
