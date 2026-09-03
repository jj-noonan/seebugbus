import rawCatalog from './catalog.json';
import { deriveVector, lexiconCoverage } from './lexicon';
import { AXES, type Artist, type Axis, type Item, type RawAlbum, type RawCatalog } from './schema';

const raw: RawCatalog = rawCatalog;

const CAA_PREFIX = 'https://coverartarchive.org/release/';

/**
 * Rebuild a cover URL from the stored path.
 *
 * The export ships `<release-mbid>/<image-id>` and nothing more; the shared
 * prefix and the size suffix are re-added here. Always asking for a sized
 * variant matters on its own: CAA renders one on demand, and a release with no
 * pre-generated thumbnail would otherwise hand back a multi-megabyte original
 * into a view that shows four covers at once.
 */
export function coverUrl(path: string | null, px: 250 | 500): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path; // pre-compression export
  return `${CAA_PREFIX}${path}-${px}.jpg`;
}

function searchUrls(
  artist: string,
  title: string,
  releaseGroupId: string,
  spotifyId?: string | null,
) {
  const q = `${artist} ${title}`;
  return {
    /*
     * MusicBrainz rather than Wikipedia, despite the obvious appeal of the
     * latter: we hold the exact release-group MBID, so this always resolves to
     * this record — tracklist, credits, release history, and outbound links to
     * Wikipedia and Discogs where they exist. A Wikipedia search link would be
     * a guess, and most of this catalog is obscure enough that the guess would
     * usually land on "no results found".
     */
    infoUrl: `https://musicbrainz.org/release-group/${releaseGroupId}`,
    /*
     * The exact album where we resolved one, a search otherwise.
     *
     * Resolution is verified on both title and artist (see
     * scripts/resolve_spotify.py) because a confident link to the wrong record
     * is worse than an honest search page — a bare search readily returns a
     * different album by the same artist.
     */
    spotifyUrl: spotifyId
      ? `https://open.spotify.com/album/${spotifyId}`
      : `https://open.spotify.com/search/${encodeURIComponent(q)}`,
    appleMusicUrl: `https://music.apple.com/search?term=${encodeURIComponent(q)}`,
  };
}

/**
 * Obscurity as a percentile rank over ListenBrainz counts rather than an
 * absolute threshold, so the scale self-calibrates as the catalog grows and
 * always spans the full 0..10 range. Albums ListenBrainz has never heard of
 * land at 8 — unknown to the largest open listening dataset is itself decent
 * evidence of a deep cut, though not proof, so it stops short of 10.
 */
function deriveObscurity(albums: RawAlbum[]): Map<string, number> {
  const known = albums.filter((a) => a.listenCount != null);
  const sorted = [...known].sort((a, b) => (a.listenCount ?? 0) - (b.listenCount ?? 0));
  const rank = new Map(sorted.map((a, i) => [a.id, i]));
  const n = Math.max(1, sorted.length - 1);

  const out = new Map<string, number>();
  for (const a of albums) {
    if (a.listenCount == null) {
      out.set(a.id, 8);
    } else {
      const percentile = (rank.get(a.id) ?? 0) / n; // 0 = least listened
      out.set(a.id, Math.round((1 - percentile) * 10 * 10) / 10);
    }
  }
  return out;
}

/**
 * Build a live Item from a raw record. Shared by the bundled catalog and by
 * albums ingested at runtime, so a searched-for record behaves identically to
 * a crawled one — same axes, same links, same card.
 */
export function itemFromRaw(a: RawAlbum, obscurity: number): Item {
  const popularity = a.popularity ?? 10 - obscurity;
  return {
    id: a.id,
    kind: 'album' as const,
    title: a.title,
    subtitle: a.artistName,
    artistId: a.artistId,
    yearStart: a.year,
    yearEnd: null,
    artUrl: coverUrl(a.art, 500),
    artThumbUrl: coverUrl(a.art, 250),
    obscurity,
    popularity,
    // Unknown quality sits just below the middle: it should not be rewarded
    // like a loved record, nor buried like a bad one.
    quality: a.quality ?? 4.5,
    corridorIds: a.corridorIds,
    listenCount: a.listenCount ?? null,
    listenerCount: a.listenerCount ?? null,
    rating: a.rating ?? null,
    country: a.country ?? null,
    spotifyId: a.spotifyId ?? null,
    tags: a.tags,
    vector: deriveVector(a.tags, a.year),
    ...searchUrls(a.artistName, a.title, a.id, a.spotifyId),
    sourceIds: {
      musicbrainzReleaseGroup: a.id,
      musicbrainzArtist: a.artistId,
    },
  };
}

function build(): { items: Item[]; artists: Map<string, Artist> } {
  const obscurity = deriveObscurity(raw.albums);
  const artists = new Map(raw.artists.map((a) => [a.id, a]));

  const items: Item[] = raw.albums
    .filter((a) => a.art) // no art, no card — this is a cover flow
    .map((a) =>
      itemFromRaw(a, a.popularity != null ? 10 - a.popularity : obscurity.get(a.id) ?? 5),
    )
    // Records whose tags we barely recognise get placed at the middle of every
    // axis, which makes them look deceptively similar to everything. Drop them
    // rather than let them pollute the branch offers.
    .filter((item) => lexiconCoverage(item.tags) >= 0.3);

  return { items, artists };
}

const built = build();

export const ITEMS: Item[] = built.items;

/**
 * Standard deviation of each axis across the catalog.
 *
 * The axes are not comparably scaled: `synthetic` varies with sd 0.275 and
 * `density` only 0.092, so a raw 0.15 move means something very different on
 * each. Anything comparing axes — distance, or the wording of a rationale —
 * has to divide by these or it silently becomes a measure of the two widest
 * axes alone.
 */
export const AXIS_SD: Record<Axis, number> = (() => {
  const out = {} as Record<Axis, number>;
  for (const axis of AXES) {
    if (!ITEMS.length) { out[axis] = 1; continue; }
    const mean = ITEMS.reduce((s, i) => s + i.vector[axis], 0) / ITEMS.length;
    const varc = ITEMS.reduce((s, i) => s + (i.vector[axis] - mean) ** 2, 0) / ITEMS.length;
    out[axis] = Math.max(0.02, Math.sqrt(varc));
  }
  return out;
})();

/** Tag sets, for measuring idiom overlap without rebuilding them per query. */
export const TAG_SETS: Map<string, Set<string>> = new Map(
  ITEMS.map((i) => [i.id, new Set(i.tags.map((t) => t.tag))]),
);
export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
export const ARTISTS = built.artists;
export const CATALOG_STATS = raw.stats;
export const CATALOG_GENERATED_AT = raw.generatedAt;

export function itemsInCorridor(corridorId: string): Item[] {
  return ITEMS.filter((i) => i.corridorIds.includes(corridorId));
}
