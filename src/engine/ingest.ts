import { itemFromRaw } from '../data/catalog';
import { CORRIDORS } from '../data/corridors';
import type { Item, ItemTag, RawAlbum } from '../data/schema';

/**
 * Search-driven ingest.
 *
 * The catalog only holds what has been crawled, so searching for anything else
 * comes up empty — which is the moment a discovery app feels smallest. Both
 * MusicBrainz and the Cover Art Archive send `Access-Control-Allow-Origin: *`,
 * so the browser can do the whole thing itself: validate that the record
 * exists, fetch its art and tags, and hand back a card indistinguishable from
 * a crawled one. No backend, and the album is usable in about a second.
 *
 * Every ingest is also written to a durable queue, so the real crawler can
 * later fold these records into SQLite permanently (see pendingMbids and
 * scripts/ingest_mbids.py).
 *
 * Note: MusicBrainz rejects generic User-Agents with a 403, which browsers
 * never trip because they send their own. Scripts calling this module must set
 * a real UA — see scripts/ingest-check.ts.
 */

const MB = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org';
const LB = 'https://api.listenbrainz.org/1';
const QUEUE_KEY = 'segue.ingest.v1';

export interface Candidate {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  year: number | null;
  tags: ItemTag[];
  score: number;
}

export interface QueueEntry {
  query: string;
  mbid: string | null;
  title: string;
  artist?: string;
  state: 'validated' | 'ingested' | 'failed';
  at: string;
  /**
   * How many times a person searched their way to this record.
   *
   * Tracked but not yet weighted. A human typing an artist's name is a much
   * stronger signal of interest than anything the crawler infers, and it is
   * worth having the history before deciding what it should be worth.
   */
  searchCount?: number;
}

/* ── rate limiting ───────────────────────────────────────────────────────
 * MusicBrainz allows ~1 request/second per client. A user typing quickly can
 * outrun that easily, so serialise every call through one gate rather than
 * trusting the debounce alone.
 */
let gate: Promise<void> = Promise.resolve();
let lastCall = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = gate.then(async () => {
    const wait = 1100 - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  gate = run.then(() => undefined, () => undefined);
  return run;
}

const VARIOUS = new Set(['various artists', '[various artists]', '[unknown]']);

/** Step (a): does this actually name a record that exists? */
export async function validate(query: string, signal?: AbortSignal): Promise<Candidate[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const url =
    `${MB}/release-group/?query=${encodeURIComponent(`${q} AND primarytype:album`)}` +
    `&fmt=json&limit=10`;

  const res = await throttled(() => fetch(url, { signal, headers: { Accept: 'application/json' } }));
  if (!res.ok) throw new Error(`MusicBrainz returned ${res.status}`);
  const data = await res.json();

  const wanted = q.toLowerCase();
  const out: Candidate[] = [];
  for (const rg of data['release-groups'] ?? []) {
    const credits = rg['artist-credit'] ?? [];
    const artist = credits[0]?.artist;
    if (!artist?.id || VARIOUS.has((artist.name ?? '').toLowerCase())) continue;
    const secondary: string[] = (rg['secondary-types'] ?? []).map((x: string) => x.toLowerCase());
    if (secondary.some((x) => ['compilation', 'live', 'remix', 'dj-mix'].includes(x))) continue;

    const year = /^(\d{4})/.exec(rg['first-release-date'] ?? '')?.[1];
    const tags: ItemTag[] = (rg.tags ?? [])
      .filter((t: { name?: string }) => t.name)
      .map((t: { name: string; count?: number }) => ({
        tag: t.name.toLowerCase(),
        count: t.count ?? 1,
      }));

    const title: string = rg.title ?? '';
    const artistName: string = artist.name ?? '';

    /*
     * Re-rank on top of MusicBrainz's relevance score.
     *
     * Searching "spiderland slint" puts a bootleg titled "spiderland by slint"
     * above Slint's actual album, because the bootleg's title contains more of
     * the query text. Rewarding a candidate whose *artist* the query names
     * separately from its title fixes that: the real record matches on both
     * fields, the bootleg only on one.
     */
    let rank = rg.score ?? 0;
    if (wanted.includes(artistName.toLowerCase()) && artistName.length > 2) rank += 40;
    if (wanted.includes(title.toLowerCase()) && title.length > 2) rank += 30;

    out.push({
      id: rg.id,
      title,
      artistId: artist.id,
      artistName,
      year: year ? Number(year) : null,
      tags,
      score: rank,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Real listening figures for an ingested album.
 *
 * Without these an ingest was given a flat quality of 5 and no popularity,
 * which parks it in the middle of the space where it is a plausible neighbour
 * of far too much. One bulk call is cheap and makes a searched album score on
 * the same evidence as a crawled one.
 */
async function popularity(
  mbid: string,
  signal?: AbortSignal,
): Promise<{ listens: number; listeners: number } | null> {
  try {
    const res = await fetch(`${LB}/popularity/release-group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ release_group_mbids: [mbid] }),
      signal,
    });
    if (!res.ok) return null;
    const row = (await res.json())?.[0];
    if (!row) return null;
    return {
      listens: Number(row.total_listen_count ?? 0),
      listeners: Number(row.total_user_count ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * Quality on the same footing the exporter uses: devotion, capped so a handful
 * of obsessive plays can't read as acclaim, and shrunk toward the catalog
 * median until enough people have actually listened.
 */
function qualityFrom(listens: number, listeners: number): number {
  if (!listeners) return 4.5;
  const DEVOTION_CAP = 30;
  const PRIOR = 7.6;
  const K = 80;
  const capped = Math.min(listens, DEVOTION_CAP * listeners);
  const devotion = (capped + PRIOR * K) / (listeners + K);
  // Map onto the 0..10 scale the rest of the engine expects.
  return Math.max(0, Math.min(10, (devotion / DEVOTION_CAP) * 10));
}

/** Front-cover path, or null when the Archive has no art for this release. */
async function fetchArt(mbid: string, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(`${CAA}/release-group/${mbid}`, { signal });
  if (!res.ok) return null;
  const data = await res.json();
  const images: { front?: boolean; image?: string }[] = data.images ?? [];
  const front = images.find((i) => i.front) ?? images[0];
  if (!front?.image) return null;
  // Store the bare path; catalog.coverUrl() re-adds prefix and size.
  return front.image
    .replace(/^https?:\/\/coverartarchive\.org\/release\//, '')
    .replace(/(-\d+)?\.jpg$/, '');
}

/**
 * Place an ingested album into the corridors its tags imply.
 *
 * Without this it would be an island: reachable by search but never *offered*,
 * because the "wider" branch crosses between corridors and a record belonging
 * to none can never be the far side of a crossing.
 */
function inferCorridors(tags: ItemTag[]): string[] {
  const names = new Set(tags.map((t) => t.tag));
  return CORRIDORS.filter((c) => c.tags.some((t) => names.has(t))).map((c) => c.id);
}

/** Step (b): fetch what's missing and build a usable card. */
export async function ingest(c: Candidate, signal?: AbortSignal): Promise<Item> {
  const art = await fetchArt(c.id, signal);
  if (!art) throw new Error('no cover art in the Archive');

  const pop = await popularity(c.id, signal);

  const raw: RawAlbum = {
    id: c.id,
    title: c.title,
    artistId: c.artistId,
    artistName: c.artistName,
    year: c.year,
    art,
    tags: c.tags,
    corridorIds: inferCorridors(c.tags),
    listenCount: pop?.listens ?? null,
    listenerCount: pop?.listeners ?? null,
    quality: pop ? qualityFrom(pop.listens, pop.listeners) : 4.5,
  };

  /*
   * Obscurity from real listener counts where we have them. The thresholds
   * mirror the catalog's own distribution — its 90th percentile sits near
   * 1,437 listeners — so an ingested album lands in roughly the decile it
   * would have occupied had the crawler found it.
   */
  const listeners = pop?.listeners ?? 0;
  const obscurity = !pop
    ? 5
    : listeners > 5000 ? 1
    : listeners > 1400 ? 3
    : listeners > 300 ? 5
    : listeners > 50 ? 7
    : 9;

  return itemFromRaw(raw, obscurity);
}

/* ── durable queue ─────────────────────────────────────────────────────── */

function readQueue(): QueueEntry[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function enqueue(entry: QueueEntry): void {
  try {
    const q = readQueue();
    const prior = entry.mbid ? q.find((e) => e.mbid === entry.mbid) : undefined;
    const rest = q.filter((e) => !entry.mbid || e.mbid !== entry.mbid);
    rest.push({ ...entry, searchCount: (prior?.searchCount ?? 0) + 1 });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(rest.slice(-400)));
  } catch {
    // Storage unavailable — the in-session ingest still worked.
  }
}

/** Records that a person reached this album by searching, however they got there. */
export function noteSearchHit(item: { id: string; title: string; subtitle: string }, query: string): void {
  enqueue({
    query,
    mbid: item.id,
    title: item.title,
    artist: item.subtitle,
    state: 'ingested',
    at: new Date().toISOString(),
  });
}

export function getQueue(): QueueEntry[] {
  return readQueue();
}

/** MBIDs to hand to scripts/ingest_mbids.py so they become permanent. */
export function pendingMbids(): string[] {
  return [...new Set(readQueue().filter((e) => e.state === 'ingested' && e.mbid).map((e) => e.mbid!))];
}
