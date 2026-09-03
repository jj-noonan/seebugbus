import type { Corridor } from './schema';

/**
 * Walkable lineages — retained for two narrow jobs, no longer part of the
 * recommendation decision.
 *
 * These still seed the crawl (the tag lists are how it knows what to harvest,
 * and harvesting by lineage is what gives the catalog enough local density for
 * short steps to exist), and they still label a crossing where one applies.
 *
 * They used to decide "deeper" versus "wider", and were poor at it: membership
 * came from the tag the crawler *searched* rather than the tags an album
 * carries, 17% of assignments had no exact tag support, and 23% of shipped
 * albums had no corridor at all. That job now belongs to idiom overlap, which
 * is derived from tags at load time and needs no precomputation. Kept whole
 * rather than deleted — the lineages encode real musical knowledge that may
 * earn another use.
 *
 * The catalog's skeleton. Each corridor is a lineage you can actually walk —
 * consecutive waypoints share personnel, labels, studios or direct influence,
 * so a short step inside a corridor lands somewhere plausible while a long
 * step still moves you meaningfully.
 *
 * `bridges` are where corridors genuinely touch (shared tags, shared artists).
 * Those crossings are the high-value branches: still defensible, but they hand
 * you off to a lineage you weren't in.
 */
export const CORRIDORS: Corridor[] = [
  {
    id: 'kraut-techno',
    label: 'Motorik to Machine',
    waypoints: ['Krautrock', 'Post-punk', 'Industrial', 'EBM', 'Detroit techno'],
    tags: [
      'krautrock', 'kosmische musik', 'post-punk', 'coldwave', 'minimal wave',
      'industrial', 'ebm', 'electro', 'detroit techno', 'acid house',
    ],
    bridges: ['minimalism', 'punk-noise', 'soul-house'],
  },
  {
    id: 'jazz-beats',
    label: 'Modal to Beat Scene',
    waypoints: ['Modal jazz', 'Spiritual jazz', 'Fusion', 'Boom bap', 'Beat scene'],
    tags: [
      'modal jazz', 'spiritual jazz', 'free jazz', 'jazz fusion', 'jazz-funk',
      'jazz rap', 'boom bap', 'instrumental hip hop', 'trip hop', 'wonky',
    ],
    bridges: ['soul-house', 'global-psych', 'minimalism'],
  },
  {
    id: 'folk-ambient',
    label: 'Fingerpicked to Formless',
    waypoints: ['Traditional folk', 'Psych folk', 'Freak folk', 'Drone', 'Ambient'],
    tags: [
      'folk', 'british folk rock', 'psychedelic folk', 'freak folk',
      'american primitivism', 'drone', 'ambient', 'new age', 'fourth world',
    ],
    bridges: ['minimalism', 'shoegaze', 'country-americana'],
  },
  {
    id: 'dub-bass',
    label: 'Roots to Rinse',
    waypoints: ['Roots reggae', 'Dub', 'Jungle', 'UK garage', 'Grime'],
    tags: [
      'roots reggae', 'dub', 'dancehall', 'jungle', 'drum and bass',
      'uk garage', '2-step', 'dubstep', 'grime', 'sound system',
    ],
    bridges: ['soul-house', 'kraut-techno', 'global-psych'],
  },
  {
    id: 'punk-noise',
    label: 'Three Chords to No Chords',
    waypoints: ['Punk', 'Hardcore', 'Noise rock', 'Post-hardcore', 'Math rock'],
    tags: [
      'punk rock', 'proto-punk', 'hardcore punk', 'post-hardcore', 'noise rock',
      'math rock', 'slowcore', 'no wave', 'sludge metal',
    ],
    bridges: ['metal-doom', 'shoegaze', 'kraut-techno'],
  },
  {
    id: 'soul-house',
    label: 'Church to Warehouse',
    waypoints: ['Soul', 'Funk', 'Disco', 'Boogie', 'House'],
    tags: [
      'soul', 'southern soul', 'funk', 'p-funk', 'disco', 'boogie',
      'house', 'deep house', 'garage house', 'gospel',
    ],
    bridges: ['jazz-beats', 'dub-bass', 'kraut-techno'],
  },
  {
    id: 'minimalism',
    label: 'Repetition to Rupture',
    waypoints: ['Minimalism', 'Modern composition', 'Musique concrète', 'Electroacoustic'],
    tags: [
      'minimalism', 'modern classical', 'contemporary classical', 'avant-garde',
      'musique concrète', 'electroacoustic', 'tape music', 'serialism', 'post-minimalism',
    ],
    bridges: ['folk-ambient', 'kraut-techno', 'jazz-beats'],
  },
  {
    id: 'shoegaze',
    label: 'Reverb and Retreat',
    waypoints: ['Post-punk', 'Ethereal wave', 'Shoegaze', 'Dream pop', 'Slowcore'],
    tags: [
      'shoegaze', 'dream pop', 'ethereal wave', 'noise pop', 'slowcore',
      'sadcore', 'jangle pop', 'twee pop', 'indie pop',
    ],
    bridges: ['punk-noise', 'folk-ambient', 'metal-doom'],
  },
  {
    id: 'country-americana',
    label: 'Bakersfield to Basement',
    waypoints: ['Country', 'Outlaw country', 'Alt-country', 'Americana'],
    tags: [
      'country', 'bluegrass', 'honky tonk', 'outlaw country', 'country rock',
      'alt-country', 'americana', 'singer-songwriter', 'gothic country',
    ],
    bridges: ['folk-ambient', 'punk-noise'],
  },
  {
    id: 'global-psych',
    label: 'Tropicália to Sahel',
    waypoints: ['Tropicália', 'Afrobeat', 'Ethio-jazz', 'Desert blues'],
    tags: [
      'tropicalia', 'mpb', 'afrobeat', 'highlife', 'ethio-jazz', 'cumbia',
      'desert blues', 'raï', 'psychedelic rock', 'anatolian rock',
    ],
    bridges: ['jazz-beats', 'dub-bass', 'folk-ambient'],
  },
  {
    id: 'metal-doom',
    label: 'Riff to Ritual',
    waypoints: ['Heavy metal', 'Doom', 'Black metal', 'Post-metal'],
    tags: [
      'heavy metal', 'doom metal', 'stoner rock', 'sludge metal',
      'black metal', 'atmospheric black metal', 'post-metal', 'drone metal',
    ],
    bridges: ['punk-noise', 'shoegaze'],
  },
];

export const CORRIDOR_BY_ID = new Map(CORRIDORS.map((c) => [c.id, c]));
