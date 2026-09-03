#!/usr/bin/env python3
"""
Resolve albums to exact Spotify IDs so the Play button opens the record itself.

Until now both streaming buttons opened a *search page*. MusicBrainz does hold
Spotify links, but on releases rather than release groups — two extra requests
per album, roughly 35 hours for this catalog. Apple's free iTunes API tops out
around 55% verified matches and cannot be tuned past it: searching "Pink Floyd
The Dark Side of the Moon" returns The Wall, Wish You Were Here and Meddle, but
never Dark Side, at any result depth.

Spotify's own search, with client credentials, resolves the album directly.

Matching is verified rather than trusted. A bare search happily returns a
different record by the same artist, and a confident link to the wrong album is
worse than an honest search page — so a result is only accepted when both the
album title and the artist line up after normalisation.

Credentials come from .env, which is gitignored. They stay server-side; the
deployed site only ever receives resolved URLs.

  python3 scripts/resolve_spotify.py 20000
"""
from __future__ import annotations

import base64
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db  # noqa: E402

load_dotenv(HERE.parent / ".env")
TOKEN_URL = "https://accounts.spotify.com/api/token"
SEARCH_URL = "https://api.spotify.com/v1/search"

_token: dict = {"value": None, "expires": 0.0}


def token() -> str:
    """Client-credentials token, refreshed a minute before it lapses."""
    if _token["value"] and time.time() < _token["expires"] - 60:
        return _token["value"]
    cid = os.environ["SPOTIFY_CLIENT_ID"]
    sec = os.environ["SPOTIFY_CLIENT_SECRET"]
    auth = base64.b64encode(f"{cid}:{sec}".encode()).decode()
    r = requests.post(TOKEN_URL, data={"grant_type": "client_credentials"},
                      headers={"Authorization": f"Basic {auth}"}, timeout=25)
    r.raise_for_status()
    d = r.json()
    _token["value"] = d["access_token"]
    _token["expires"] = time.time() + d.get("expires_in", 3600)
    return _token["value"]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    # Editions differ between services and shouldn't block a match.
    s = re.sub(r"\b(deluxe|remaster(ed)?|expanded|edition|version|anniversary|"
               r"reissue|bonus|track[s]?|explicit|mono|stereo)\b", " ", s)
    s = re.sub(r"\(.*?\)|\[.*?\]", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def accepts(want_title: str, want_artist: str, got_title: str, got_artist: str) -> bool:
    wt, gt = norm(want_title), norm(got_title)
    wa, ga = norm(want_artist), norm(got_artist)
    if not wt or not gt or not wa or not ga:
        return False
    title_ok = wt == gt or gt.startswith(wt) or wt.startswith(gt)
    artist_ok = wa == ga or wa in ga or ga in wa
    return title_ok and artist_ok


def resolve(title: str, artist: str) -> str | None:
    q = f'album:"{title}" artist:"{artist}"'
    for attempt in range(4):
        try:
            r = requests.get(SEARCH_URL, params={"q": q, "type": "album", "limit": 10},
                             headers={"Authorization": f"Bearer {token()}"}, timeout=25)
        except requests.RequestException:
            time.sleep(1 + attempt)
            continue
        if r.status_code == 429:
            # Spotify tells us exactly how long to wait; obey it.
            time.sleep(int(r.headers.get("Retry-After", "2")) + 1)
            continue
        if r.status_code == 401:
            _token["value"] = None
            continue
        if r.status_code != 200:
            return None
        for a in r.json().get("albums", {}).get("items", []):
            names = ", ".join(x["name"] for x in a.get("artists", []))
            if accepts(title, artist, a.get("name", ""), names):
                return a["id"]
        return None
    return None


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    conn = db.connect()
    db.init(conn)
    todo = db.missing_spotify(conn, limit)
    print(f"resolving {len(todo):,} albums", flush=True)

    hit = 0
    start = time.time()
    for n, row in enumerate(todo, 1):
        db.set_spotify(conn, row["id"], resolve(row["title"], row["artist"]))
        hit += 1 if conn.execute(
            "SELECT spotify_id FROM items WHERE id=?", (row["id"],)
        ).fetchone()[0] else 0
        if n % 25 == 0:
            conn.commit()
        if n % 500 == 0:
            rate = n / max(1e-6, time.time() - start)
            print(f"  {n:,}/{len(todo):,} — {hit:,} matched "
                  f"({100*hit/n:.0f}%, {rate:.1f}/sec)", flush=True)
    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM items WHERE spotify_id IS NOT NULL").fetchone()[0]
    print(f"done: {hit:,}/{len(todo):,} matched; {total:,} albums now have a Spotify link")
    return 0


if __name__ == "__main__":
    sys.exit(main())
