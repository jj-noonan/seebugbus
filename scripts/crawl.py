#!/usr/bin/env python3
"""
Build the album catalog from MusicBrainz + Cover Art Archive.

Runs unattended for a long time (MusicBrainz caps anonymous clients at 1
request/second), so it is written to be interrupted and resumed: progress is
checkpointed per tag, and src/data/catalog.json is rewritten after every
corridor completes. The UI reads that file, so the catalog grows underneath the
app while the app is being developed.

  python3 scripts/crawl.py            # resume where it left off
  python3 scripts/crawl.py --reset    # start over
  python3 scripts/crawl.py --per-tag 40

No API keys required.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

# MusicBrainz requires a descriptive User-Agent with contact info; anonymous
# clients are limited to ~1 req/sec and get 503s if they push past it.
UA = "MusicRecsCoverFlow/0.1 (https://github.com/jj/music-recs; jj@noonan.cc)"
MB = "https://musicbrainz.org/ws/2"
CAA = "https://coverartarchive.org"
LB = "https://api.listenbrainz.org/1"

# MusicBrainz allows ~1 req/sec, but throttles bursts even when the average is
# legal — and a deep crawl sends its pages back-to-back. At 1.1s roughly 9% of
# slices were failing, and each failure costs five retries with backoff, which
# is far more time than the extra 0.2s ever saves.
MB_INTERVAL = 1.3
POOL_FACTOR = 3    # harvest this many times `per_tag` before stratifying down
_mb_lock = threading.Lock()
_mb_last = [0.0]

session = requests.Session()
session.headers.update({"User-Agent": UA, "Accept": "application/json"})


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def mb_get(path: str, params: dict) -> dict | None:
    """Rate-limited MusicBrainz GET with backoff on 503."""
    for attempt in range(5):
        with _mb_lock:
            wait = MB_INTERVAL - (time.time() - _mb_last[0])
            if wait > 0:
                time.sleep(wait)
            _mb_last[0] = time.time()
        try:
            r = session.get(f"{MB}{path}", params={**params, "fmt": "json"}, timeout=30)
        except requests.RequestException as e:
            log(f"  mb error {e}; retrying")
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code == 503:
            time.sleep(3 * (attempt + 1))
            continue
        if r.status_code != 200:
            log(f"  mb {r.status_code} for {path} {params}")
            return None
        try:
            return r.json()
        except ValueError:
            return None
    # Exhausted every retry — almost always sustained 503 rate limiting, which
    # otherwise returns None with nothing in the log to explain it.
    log(f"  mb gave up after retries: {path} {params.get('query', '')}")
    return None


# --------------------------------------------------------------------------
# Phase A — harvest release groups per corridor tag
# --------------------------------------------------------------------------

VARIOUS = {"various artists", "[various artists]", "soundtrack", "[unknown]"}


DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]


def harvest_slice(
    tag: str, decade: int, offset: int, pages: int
) -> tuple[list[dict], int, bool, int | None]:
    """
    Fetch `pages` pages of one (tag, decade) slice starting at `offset`.

    Returns (candidates, next_offset, exhausted, total). `exhausted` means
    MusicBrainz has no more rows for this slice, so it never needs visiting
    again — that is what lets a multi-day crawl keep making progress instead of
    re-reading the same relevance-ordered first page forever.

    Slicing by release date does double duty: it multiplies how much of a large
    tag the search API will actually surface, and it balances eras by
    construction rather than by sampling after the fact.
    """
    lo, hi = decade, decade + 9
    query = (
        f'tag:"{tag}" AND primarytype:album '
        f"AND firstreleasedate:[{lo}-01-01 TO {hi}-12-31]"
    )

    out: list[dict] = []
    total: int | None = None
    answered = False
    exhausted = False

    for _ in range(pages):
        data = mb_get("/release-group", {"query": query, "limit": 100, "offset": offset})
        if not data:
            break
        answered = True
        total = data.get("count", total)
        groups = data.get("release-groups", [])
        offset += len(groups)
        if len(groups) < 100:
            exhausted = True

        for rg in groups:
            parsed = parse_release_group(rg, tag)
            if parsed:
                out.append(parsed)
        if exhausted:
            break

    if not answered:
        return ([], offset, False, total)
    return (out, offset, exhausted, total)


def parse_release_group(rg: dict, found_via: str) -> dict | None:
    """Filter and flatten one search hit; None if it makes a poor card."""
    credits = rg.get("artist-credit") or []
    if not credits:
        return None
    artist = credits[0].get("artist") or {}
    artist_name = artist.get("name") or ""
    if not artist.get("id") or artist_name.lower() in VARIOUS:
        return None
    if len(credits) > 2:
        return None

    secondary = [s.lower() for s in (rg.get("secondary-types") or [])]
    if any(s in ("compilation", "live", "remix", "dj-mix") for s in secondary):
        return None

    m = re.match(r"^(\d{4})", rg.get("first-release-date") or "")
    year = int(m.group(1)) if m else None
    if year is None or year < 1948 or year > 2026:
        return None

    tags = [
        {"tag": t["name"].lower(), "count": int(t.get("count") or 1)}
        for t in (rg.get("tags") or [])
        if t.get("name")
    ]
    if not any(t["tag"] == found_via for t in tags):
        tags.append({"tag": found_via, "count": 3})

    return {
        "id": rg["id"],
        "title": rg.get("title") or "",
        "artistId": artist["id"],
        "artistName": artist_name,
        "artistSortName": artist.get("sort-name"),
        "artistCountry": artist.get("country"),
        "year": year,
        "tags": tags,
        "foundVia": found_via,
    }



# --------------------------------------------------------------------------
# Phase B — cover art (this is a cover-flow app; no art means no card)
# --------------------------------------------------------------------------


def fetch_art(rgid: str) -> tuple[str, str] | None:
    """Return (full, thumb) front-cover URLs, or None when CAA has no art."""
    for attempt in range(3):
        try:
            r = requests.get(
                f"{CAA}/release-group/{rgid}",
                headers={"User-Agent": UA},
                timeout=25,
            )
        except requests.RequestException:
            time.sleep(1 + attempt)
            continue
        if r.status_code == 404:
            return None
        if r.status_code in (429, 502, 503):
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code != 200:
            return None
        try:
            images = r.json().get("images", [])
        except ValueError:
            return None
        front = next((i for i in images if i.get("front")), None) or (
            images[0] if images else None
        )
        if not front:
            return None
        thumbs = front.get("thumbnails") or {}
        full = thumbs.get("500") or front.get("image")
        thumb = thumbs.get("250") or thumbs.get("small") or full
        if not full:
            return None
        return (full.replace("http://", "https://"), thumb.replace("http://", "https://"))
    return None


def attach_art(candidates: list[dict], workers: int = 6) -> list[dict]:
    kept = []
    lock = threading.Lock()

    def work(c):
        art = fetch_art(c["id"])
        if art:
            c["artUrl"], c["artThumbUrl"] = art
            with lock:
                kept.append(c)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(work, candidates))
    return kept


# --------------------------------------------------------------------------
# Phase C — popularity, for the obscurity score
# --------------------------------------------------------------------------


def fetch_popularity(rgids: list[str]) -> dict[str, tuple[int, int]]:
    """
    ListenBrainz listens *and* distinct listeners, in batches of 50.

    Listeners matter more than listens: raw play counts are dominated by
    whoever put a record on two hundred times, whereas the number of separate
    people who reached for it is what "popular" actually means. Keeping both
    also gives us listens-per-listener, which is the closest thing to a free
    quality signal — it separates records people return to from records people
    tried once.
    """
    out: dict[str, tuple[int, int]] = {}
    for i in range(0, len(rgids), 50):
        batch = rgids[i : i + 50]
        try:
            r = requests.post(
                f"{LB}/popularity/release-group",
                json={"release_group_mbids": batch},
                headers={"User-Agent": UA},
                timeout=30,
            )
            if r.status_code != 200:
                continue
            for row in r.json() or []:
                mbid = row.get("release_group_mbid")
                if not mbid:
                    continue
                out[mbid] = (
                    int(row.get("total_listen_count") or 0),
                    int(row.get("total_user_count") or 0),
                )
        except (requests.RequestException, ValueError):
            continue
        time.sleep(0.3)
    return out


def fetch_rating(mbid: str) -> tuple[float | None, int]:
    """
    MusicBrainz community rating for one release group.

    There is no bulk endpoint, so this costs one rate-limited request each and
    can only ever cover a slice of the catalog. Callers should spend those
    requests on the albums most likely to be offered.
    """
    data = mb_get(f"/release-group/{mbid}", {"inc": "ratings"})
    if not data:
        return (None, 0)
    r = data.get("rating") or {}
    value = r.get("value")
    return (float(value) if value is not None else None, int(r.get("votes-count") or 0))


# --------------------------------------------------------------------------
# Stratification
# --------------------------------------------------------------------------


def stratify(candidates: list[dict], keep: int) -> list[dict]:
    """
    Pick a spread across the popularity range rather than the top N.

    MusicBrainz orders a tag search by text relevance, which is uncorrelated
    with how known a record is — taking the first N gives an arbitrary slice
    that in practice skews heavily obscure. A catalog with no anchors is worse
    than one with too many: the listener has nothing to orient by, and the
    obscurity signal has no range to span.

    So: sort by listen count, split into quartiles, and take a weighted sample
    that leans toward the well-known without letting it dominate. Deep cuts
    still make up most of what is kept; they just stop being *all* of it.
    """
    # Always fetch counts, even when no trimming is needed: the obscurity score
    # depends on them regardless of whether we had to sample.
    pop = fetch_popularity([c["id"] for c in candidates])
    for c in candidates:
        listens, listeners = pop.get(c["id"], (None, None))
        c["listenCount"] = listens
        c["listenerCount"] = listeners

    if len(candidates) <= keep:
        return candidates

    return _spread_by_decade(candidates, keep)


def _by_popularity(candidates: list[dict], keep: int) -> list[dict]:
    """Quartile sample: anchors, familiar, lesser-known, deep cuts."""
    if len(candidates) <= keep:
        return candidates
    ranked = sorted(candidates, key=lambda c: c.get("listenerCount") or c.get("listenCount") or -1, reverse=True)
    quartile = max(1, len(ranked) // 4)
    buckets = [ranked[i * quartile : (i + 1) * quartile] for i in range(4)]
    buckets[3].extend(ranked[4 * quartile :])

    shares = [0.30, 0.25, 0.23, 0.22]
    out: list[dict] = []
    for bucket, share in zip(buckets, shares):
        out.extend(bucket[: max(1, round(keep * share))])
    return out[:keep]


def _spread_by_decade(candidates: list[dict], keep: int) -> list[dict]:
    """
    Allocate slots across decades before sampling popularity within each.

    MusicBrainz tag coverage is far denser for recent releases — there are
    simply more editors tagging new music — so sampling on popularity alone
    produced a catalog that was 58% post-2010 and only 16% pre-1990. Era
    diversity then can't come out of the recommender no matter how it is
    tuned, because the records aren't in the pool to offer.

    Slots are allocated proportional to sqrt(count) rather than count: a
    decade with four times the candidates earns twice the slots, not four
    times. That flattens the skew substantially without inventing quotas for
    decades that genuinely have little tagged material.
    """
    from collections import defaultdict
    import math

    by_decade: dict[int, list[dict]] = defaultdict(list)
    for c in candidates:
        by_decade[(c["year"] // 10) * 10].append(c)

    weights = {d: math.sqrt(len(v)) for d, v in by_decade.items()}
    total = sum(weights.values()) or 1.0

    out: list[dict] = []
    leftovers: list[dict] = []
    for decade, group in by_decade.items():
        slots = max(1, round(keep * weights[decade] / total))
        picked = _by_popularity(group, slots)
        out.extend(picked)
        leftovers.extend(c for c in group if c not in picked)

    # Rounding can leave us short; backfill from the best of what's left.
    if len(out) < keep and leftovers:
        out.extend(_by_popularity(leftovers, keep - len(out)))
    return out[:keep]


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------


def load_corridors() -> list[dict]:
    """Parse corridor ids + tags straight out of the TS module (single source of truth)."""
    src = (ROOT / "src" / "data" / "corridors.ts").read_text()
    blocks = re.findall(r"\{\s*\n\s*id: '([^']+)',(.*?)\n  \},", src, re.S)
    corridors = []
    for cid, body in blocks:
        tags_m = re.search(r"tags: \[(.*?)\]", body, re.S)
        if not tags_m:
            continue
        tags = re.findall(r"'([^']+)'", tags_m.group(1))
        corridors.append({"id": cid, "tags": tags})
    return corridors


def export_catalog(conn, path: Path, limit: int | None = None) -> None:
    """Write the JSON the browser app reads. Optional cap: past a few tens of
    thousands the app must query an API instead of loading the whole catalog."""
    import export_catalog as exporter

    exporter.export(conn, path, limit=limit)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0,
                    help="cap albums kept per slice; 0 keeps everything (deep crawls)")
    ap.add_argument("--pages", type=int, default=2,
                    help="pages fetched per slice per sweep")
    ap.add_argument("--sweeps", type=int, default=1,
                    help="how many times to walk every unfinished slice")
    ap.add_argument("--hours", type=float, default=0,
                    help="stop cleanly after this many hours; 0 = no limit")
    ap.add_argument("--db", default=str(db.DEFAULT_DB))
    ap.add_argument("--export", default=str(ROOT / "src" / "data" / "catalog.json"),
                    help="JSON the dev app reads; '' to skip")
    ap.add_argument("--export-limit", type=int, default=12000)
    ap.add_argument("--ratings", type=int, default=400,
                    help="MusicBrainz rating lookups per sweep; 0 to skip")
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()

    conn = db.connect(args.db)
    db.init(conn)
    if args.reset:
        conn.execute("DELETE FROM crawl_units")
        conn.commit()

    corridors = load_corridors()
    export_path = Path(args.export) if args.export else None
    deadline = time.time() + args.hours * 3600 if args.hours else None
    stop = False

    for sweep in range(1, args.sweeps + 1):
        state = db.unit_state(conn)
        units = [
            (c["id"], tag, decade)
            for c in corridors
            for tag in c["tags"]
            for decade in DECADES
            if not (state.get((c["id"], tag, decade)) or {"exhausted": 0})["exhausted"]
        ]
        if not units:
            log("every slice exhausted — nothing left to crawl")
            break

        prog = db.crawl_progress(conn)
        log(f"sweep {sweep}/{args.sweeps}: {len(units)} slices open, "
            f"{prog['exhausted']}/{prog['units']} exhausted, "
            f"{db.stats(conn)['albums']} albums held")

        for n, (cid, tag, decade) in enumerate(units, 1):
            if deadline and time.time() > deadline:
                log("time budget reached — stopping cleanly")
                stop = True
                break

            row = state.get((cid, tag, decade))
            offset = row["next_offset"] if row else 0

            found, next_offset, exhausted, total = harvest_slice(
                tag, decade, offset, args.pages)
            if not found and next_offset == offset and not exhausted:
                log(f"  {tag} {decade}s: MusicBrainz unreachable, will retry")
                continue

            known = db.existing_ids(conn, [c["id"] for c in found])
            fresh = [c for c in found if c["id"] not in known]
            selected = stratify(fresh, args.sample) if (args.sample and fresh) else fresh
            kept = attach_art(selected) if selected else []

            for c in kept:
                db.upsert_artist(conn, {
                    "id": c["artistId"], "name": c["artistName"],
                    "sortName": c.get("artistSortName"), "country": c.get("artistCountry"),
                })
                db.upsert_album(conn, {**c, "corridorIds": [cid]})

            # An album reached from several corridors is a bridge — the crossings
            # that make the "wider" branch worth offering.
            for c in found:
                if c["id"] in known:
                    conn.execute(
                        "INSERT OR IGNORE INTO item_corridors (item_id, corridor_id) VALUES (?,?)",
                        (c["id"], cid))

            db.save_unit(conn, cid, tag, decade, next_offset, exhausted, total, len(kept))
            conn.commit()

            if kept or exhausted:
                log(f"  [{n}/{len(units)}] {tag} {decade}s @{offset}: "
                    f"{len(found)} found, {len(fresh)} new, kept {len(kept)}"
                    f"{' (slice exhausted)' if exhausted else ''} of {total}")

            if n % 40 == 0 and export_path:
                export_catalog(conn, export_path, args.export_limit)
                log(f"    ...{db.stats(conn)['albums']} albums in db")

        missing = db.missing_listen_counts(conn, 40000)
        if missing:
            log(f"fetching popularity for {len(missing)} albums")
            pop = fetch_popularity(missing)
            db.set_popularity(conn, pop)
            conn.commit()
            log(f"  got popularity for {len(pop)}")

        # Ratings, most-listened first: one request each, so coverage will
        # always be partial and the order is what makes it worth having.
        if args.ratings:
            todo = db.missing_ratings(conn, args.ratings)
            if todo:
                log(f"fetching ratings for {len(todo)} albums (most-listened first)")
                rated = 0
                for mbid in todo:
                    value, votes = fetch_rating(mbid)
                    db.set_rating(conn, mbid, value, votes)
                    if value is not None:
                        rated += 1
                conn.commit()
                log(f"  {rated} of {len(todo)} had a community rating")

        if export_path:
            export_catalog(conn, export_path, args.export_limit)
        log(f"sweep {sweep} done: {db.stats(conn)} {db.crawl_progress(conn)}")
        if stop:
            break

    log("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
