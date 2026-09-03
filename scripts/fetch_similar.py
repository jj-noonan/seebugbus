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
LABS = "https://labs.api.listenbrainz.org/similar-artists/json"
ALGO = ("session_based_days_7500_session_300_contribution_5_"
        "threshold_10_limit_100_filter_True_skip_30")
UA = "seebugbus-eval/0.1 (jj@noonan.cc)"

# Deliberately spread across idioms so the suite can't pass by being good at
# one kind of music: stadium pop, heartland rock, jam band, blues revival,
# alt-country, hip-hop, indie rock, classic soul.
SEEDS = [
    "Taylor Swift", "Bruce Springsteen", "Grateful Dead", "Alabama Shakes",
    "Wilco", "Kendrick Lamar", "The National", "Stevie Wonder",
    "Fleetwood Mac", "Nirvana",
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


if __name__ == "__main__":
    sys.exit(main())
