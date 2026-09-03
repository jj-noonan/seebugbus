/**
 * Core data model.
 *
 * Everything the recommendation engine touches is an `Item`. Albums are the
 * only `kind` populated today, but artists / sub-genres / micro-eras slot in
 * as new rows without the engine learning anything new. The shape below is
 * deliberately flat and FK-shaped so it maps 1:1 onto SQL tables later:
 *
 *   artists(id, name, sort_name, country, began, ended)
 *   items(id, kind, title, artist_id, year_start, year_end, art_url, ...)
 *   item_tags(item_id, tag, count)
 *   item_corridors(item_id, corridor_id)
 *   edges(from_id, to_id, relation, weight)
 */

export type ItemKind = 'album' | 'artist' | 'genre' | 'era';

/** artists table. Albums FK to this; later, artists become Items themselves. */
export interface Artist {
  id: string; // MusicBrainz artist MBID
  name: string;
  sortName: string | null;
  country: string | null;
  beganYear: number | null;
  endedYear: number | null;
}

/**
 * The axes we position music on. Distance between two Items is distance in
 * this space — it is what the "distance dial" actually dials, and what the
 * hover-revealed branch reasons are generated from.
 *
 * All values are 0..1. Each axis has a name for both poles so the engine can
 * describe a move in words ("darker", "more electronic") by naming the axis
 * that moved most.
 */
export const AXES = [
  'era',        // 0 = 1950s          -> 1 = now
  'energy',     // 0 = still          -> 1 = frantic
  'density',    // 0 = sparse         -> 1 = dense
  'brightness', // 0 = dark           -> 1 = bright
  'synthetic',  // 0 = organic        -> 1 = electronic
  'abstract',   // 0 = conventional   -> 1 = experimental
  'voice',      // 0 = instrumental   -> 1 = vocal-forward
] as const;

export type Axis = (typeof AXES)[number];

/** Human-readable poles, used to render branch rationales. */
export const AXIS_POLES: Record<Axis, { low: string; high: string }> = {
  era:        { low: 'earlier',      high: 'later' },
  energy:     { low: 'calmer',       high: 'more driving' },
  density:    { low: 'sparser',      high: 'denser' },
  brightness: { low: 'darker',       high: 'brighter' },
  synthetic:  { low: 'more organic', high: 'more electronic' },
  abstract:   { low: 'more direct',  high: 'stranger' },
  voice:      { low: 'less sung',    high: 'more sung' },
};

export type Vector = Record<Axis, number>;

/** A weighted tag as MusicBrainz reports it. `count` is community vote count. */
export interface ItemTag {
  tag: string;
  count: number;
}

export interface Item {
  id: string; // MusicBrainz release-group MBID for albums
  kind: ItemKind;

  title: string;
  /** Display line under the title: artist name for albums. */
  subtitle: string;
  artistId: string | null;

  /** Albums use yearStart only; eras and artists use the span. */
  yearStart: number | null;
  yearEnd: number | null;

  artUrl: string | null;
  artThumbUrl: string | null;

  /**
   * 0..10, where 10 is a genuine deep cut. The inverse of `popularity`.
   */
  obscurity: number;

  /** 0..10 by distinct listeners. How many people reached for this record. */
  popularity: number;

  /**
   * 0..10 from listens-per-listener, boosted by the MusicBrainz community
   * rating where one exists. Devotion, not acclaim — how hard people who found
   * it held on. Subjective by nature, but it separates a record people return
   * to from one they sampled once.
   */
  quality: number;

  corridorIds: string[];
  tags: ItemTag[];
  vector: Vector;

  /** Raw evidence behind the scores above — surfaced in debug mode. */
  listenCount: number | null;
  listenerCount: number | null;
  rating: number | null;
  /** Artist origin, ISO country code; null when MusicBrainz doesn't record it. */
  country: string | null;
  /** Exact Spotify album id when verified; null means the link is a search. */
  spotifyId: string | null;

  /** Deep links. Search URLs today; exact IDs once we have them. */
  spotifyUrl: string;
  appleMusicUrl: string;
  /** Authoritative reference page for this release. */
  infoUrl: string;

  sourceIds: {
    musicbrainzReleaseGroup?: string;
    musicbrainzArtist?: string;
    spotifyAlbum?: string;
    appleMusicAlbum?: string;
  };
}

export type RelationKind =
  | 'same-artist'
  | 'same-corridor'
  | 'bridge'      // spans two corridors — the interesting jumps
  | 'same-era'
  | 'derived';    // computed at runtime from vector proximity

export interface Edge {
  fromId: string;
  toId: string;
  relation: RelationKind;
  weight: number; // 0..1
}

/**
 * A walkable lineage. The catalog is built as ~11 of these rather than an even
 * spread across genre x decade, so that short steps actually exist: a uniform
 * 1000-album spread leaves ~6 albums per cell and every branch becomes a wild
 * leap, which makes a distance dial meaningless.
 */
export interface Corridor {
  id: string;
  label: string;
  /** The lineage in order, for display. */
  waypoints: string[];
  /** MusicBrainz tags to harvest, roughly ordered along the lineage. */
  tags: string[];
  /** Corridors these touch — where bridge edges get built. */
  bridges: string[];
}

/** Raw crawler output, before vectors are derived. Mirrors catalog.json. */
export interface RawCatalog {
  generatedAt: string;
  /** Incremented by the crawler as corridors complete; UI shows progress. */
  stats: {
    albums: number;
    artists: number;
    withArt: number;
    corridorsComplete: string[];
  };
  artists: Artist[];
  albums: RawAlbum[];
}

export interface RawAlbum {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  year: number | null;
  /** Cover Art Archive path, without prefix or size suffix. See coverUrl(). */
  art: string | null;
  tags: ItemTag[];
  corridorIds: string[];
  /** ListenBrainz counts where available; null when unknown. */
  listenCount: number | null;
  listenerCount?: number | null;
  rating?: number | null;
  country?: string | null;
  /** Exact Spotify album id, where one was verified. */
  spotifyId?: string | null;
  /** Precomputed 0..10 scores from the exporter. */
  popularity?: number;
  quality?: number;
}
