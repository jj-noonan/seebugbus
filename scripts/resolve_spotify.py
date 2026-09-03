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


def safe_commit(conn) -> None:
    """Commit, waiting out another writer rather than dying on it."""
    db.retrying(conn.commit)

load_dotenv(HERE.parent / ".env")
TOKEN_URL = "https://accounts.spotify.com/api/token"
SEARCH_URL = "https://api.spotify.com/v1/search"

LONG_BAN = 300  # seconds; beyond this we stop rather than poll a ban


class RateLimited(RuntimeError):
    """Raised when Spotify imposes a ban too long to wait out."""

    def __init__(self, seconds: int):
        super().__init__(f"Spotify rate limit for {seconds}s ({seconds/3600:.1f}h)")
        self.seconds = seconds


_token: dict = {"value": None, "expires": 0.0}

# Spotify's limit is a rolling window of roughly 180 requests/minute. Running at
# 3/sec sat exactly on that ceiling and eventually drew a long Retry-After.
# Spotify's published guidance is vague, and the real limit is far stricter than
# the commonly-cited ~180/minute. Running at 3/sec drew a 82,646-second ban —
# 23 hours — so this is deliberately conservative. Throughput is not the
# constraint that matters here; staying un-banned is.
MIN_INTERVAL = 1.2
_last_call = [0.0]


def paced() -> None:
    wait = MIN_INTERVAL - (time.time() - _last_call[0])
    if wait > 0:
        time.sleep(wait)
    _last_call[0] = time.time()


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
        paced()
        try:
            r = requests.get(SEARCH_URL, params={"q": q, "type": "album", "limit": 10},
                             headers={"Authorization": f"Bearer {token()}"}, timeout=25)
        except requests.RequestException:
            time.sleep(1 + attempt)
            continue
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", "2"))
            if wait > LONG_BAN:
                # A ban measured in hours is not something to wait out or retry
                # into — continuing to poll during one can extend it. Stop, and
                # let the run resume later; every lookup so far is committed.
                raise RateLimited(wait)
            print(f"  rate limited, waiting {wait + 1}s", flush=True)
            time.sleep(wait + 1)
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
        # Resolve BEFORE touching the database, and commit immediately after.
        #
        # Batching commits held a write transaction open across the network
        # call. When Spotify returned a long Retry-After the process slept
        # inside that transaction, froze at 500 albums, and locked out every
        # other writer — a stall that looked like SQLite contention but was
        # really an HTTP backoff holding a lock it had no business holding.
        try:
            album_id = resolve(row["title"], row["artist"])
        except RateLimited as e:
            print(f"\nstopping: {e}")
            print(f"resolved {hit:,} before the limit; rerun after it lifts.")
            safe_commit(conn)
            return 2
        db.set_spotify(conn, row["id"], album_id)
        safe_commit(conn)
        if album_id:
            hit += 1
        if n % 500 == 0:
            rate = n / max(1e-6, time.time() - start)
            print(f"  {n:,}/{len(todo):,} — {hit:,} matched "
                  f"({100*hit/n:.0f}%, {rate:.1f}/sec)", flush=True)
    safe_commit(conn)
    total = conn.execute("SELECT COUNT(*) FROM items WHERE spotify_id IS NOT NULL").fetchone()[0]
    print(f"done: {hit:,}/{len(todo):,} matched; {total:,} albums now have a Spotify link")
    return 0


if __name__ == "__main__":
    sys.exit(main())
