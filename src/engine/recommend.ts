import { CORRIDOR_BY_ID } from '../data/corridors';
import { AXES, AXIS_POLES, type Axis, type Item, type Vector } from '../data/schema';

/**
 * How much each axis counts toward "distance". Era is damped because a 30-year
 * gap between two otherwise identical records is a smaller leap than it looks
 * numerically; `abstract` is boosted because a jump in strangeness is the thing
 * a listener notices most.
 */
const AXIS_WEIGHT: Record<Axis, number> = {
  era: 0.75,
  energy: 1.0,
  density: 1.0,
  brightness: 0.9,
  synthetic: 1.15,
  abstract: 1.2,
  voice: 0.95,
};

/*
 * ── Tuning ───────────────────────────────────────────────────────────────
 * Every knob the recommender has, in one place, because this is the part that
 * gets revisited. `npm run walk -- --dial N` prints the effect of any change
 * in a couple of seconds.
 */
export const TUNING = {
  /** Target distance at dial 0 and dial 1. */
  radiusNear: 0.14,
  radiusFar: 0.60,
  /** Width of the distance band; wider at high dial, where precision is moot. */
  sigmaNear: 0.10,
  sigmaFar: 0.16,

  /**
   * Where on the fame scale the dial aims. Low dial wants records people know;
   * high dial wants the tail. This is what actually makes "Sidewalk" feel like
   * a sidewalk — proximity alone still served strangers.
   */
  popularityNear: 8.4,
  popularityFar: 1.8,
  popularitySigma: 2.7,

  /**
   * How hard quality is weighted, near and far.
   *
   * Deliberately *higher* far out. The long tail is mostly records almost
   * nobody kept listening to, so reaching for obscurity without leaning on
   * quality finds noise rather than discovery. Out there, devotion is the only
   * thing separating a lost classic from a nobody's demo.
   */
  qualityWeightNear: 0.40,
  qualityWeightFar: 0.85,

  /** Two offers that lead to the same place are only one offer. */
  divergenceBonus: 1.6,
  /** Same artist twice running reads as a dead end, not a discovery. */
  sameArtistPenalty: 0.25,
} as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const WEIGHT_NORM = Math.sqrt(
  AXES.reduce((sum, a) => sum + AXIS_WEIGHT[a] * AXIS_WEIGHT[a], 0),
);

/** Weighted euclidean distance, normalised to roughly 0..1. */
export function distance(a: Vector, b: Vector): number {
  let sum = 0;
  for (const axis of AXES) {
    const d = (a[axis] - b[axis]) * AXIS_WEIGHT[axis];
    sum += d * d;
  }
  return Math.sqrt(sum) / WEIGHT_NORM;
}

/** Deterministic hash -> [0,1). Keeps branch offers stable across backtracking. */
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export interface Branch {
  item: Item;
  /** Hover-revealed rationale, e.g. "sparser and stranger — 14 years later". */
  reason: string;
  /** Which lineage this hands you to, when it differs from where you are. */
  corridorLabel: string | null;
  role: 'deeper' | 'wider';
  distance: number;
}

/**
 * Describe the move from one record to another in the terms a listener would
 * actually notice: name the one or two axes that shifted most, and treat a
 * large era gap as a fact worth stating outright rather than as "later".
 */
export function describeMove(from: Item, to: Item): string {
  const deltas = AXES.filter((a) => a !== 'era')
    .map((axis) => ({ axis, delta: to.vector[axis] - from.vector[axis] }))
    .filter((d) => Math.abs(d.delta) > 0.11)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 2);

  const phrases = deltas.map(({ axis, delta }) =>
    delta > 0 ? AXIS_POLES[axis].high : AXIS_POLES[axis].low,
  );

  const yearGap =
    from.yearStart && to.yearStart ? to.yearStart - from.yearStart : null;
  if (yearGap != null && Math.abs(yearGap) >= 8) {
    phrases.push(
      `${Math.abs(yearGap)} years ${yearGap > 0 ? 'later' : 'earlier'}`,
    );
  }

  if (phrases.length === 0) return 'a close neighbour';
  if (phrases.length === 1) return phrases[0];
  return `${phrases.slice(0, -1).join(', ')} — ${phrases[phrases.length - 1]}`;
}

interface Scored {
  item: Item;
  d: number;
  score: number;
}

/**
 * Offer two records that are both plausible next steps but lead somewhere
 * genuinely different from each other.
 *
 * The dial sets a *target* distance rather than a maximum, so turning it up
 * moves the whole band outward instead of merely widening it — at low settings
 * both offers are variations on where you are, at high settings both are real
 * departures. Novelty rides along with it: reaching further should also mean
 * reaching past the canon, which is why there is no separate obscurity slider.
 *
 * The two roles are asymmetric by construction. `deeper` stays inside the
 * lineage you are already walking; `wider` hands you to a corridor that
 * borders it. Then the pair is chosen jointly to maximise the distance
 * *between the two offers*, because two equally good branches that lead to the
 * same place are only one branch.
 */
export function pickBranches(
  current: Item,
  pool: Item[],
  dial: number,
  excludeIds: ReadonlySet<string>,
): Branch[] {
  const targetR = lerp(TUNING.radiusNear, TUNING.radiusFar, dial);
  const sigma = lerp(TUNING.sigmaNear, TUNING.sigmaFar, dial);
  const targetPop = lerp(TUNING.popularityNear, TUNING.popularityFar, dial);
  const qWeight = lerp(TUNING.qualityWeightNear, TUNING.qualityWeightFar, dial);

  const currentCorridors = new Set(current.corridorIds);
  const bridgeCorridors = new Set(
    current.corridorIds.flatMap((id) => CORRIDOR_BY_ID.get(id)?.bridges ?? []),
  );

  const scored: Scored[] = [];
  for (const item of pool) {
    if (item.id === current.id || excludeIds.has(item.id)) continue;

    const d = distance(current.vector, item.vector);
    // Gaussian around the target radius: being nearer than asked is just as
    // wrong as being further, otherwise every dial setting collapses to "close".
    const band = Math.exp(-((d - targetR) ** 2) / (2 * sigma * sigma));

    /*
     * Fame. The dial slides a *target* along the popularity scale rather than
     * applying a one-way bonus, so turning it down genuinely asks for records
     * people know instead of merely tolerating them.
     */
    const popGap = item.popularity - targetPop;
    const fame = Math.exp(
      -(popGap * popGap) / (2 * TUNING.popularitySigma * TUNING.popularitySigma),
    );

    /*
     * Quality, weighted harder the further out we reach — see TUNING. A record
     * at quality 10 is worth roughly (1 + qWeight) times one at quality 0.
     */
    const merit = 1 - qWeight + (item.quality / 10) * qWeight * 2;

    // Same artist twice in a row reads as a dead end, not a discovery.
    const sameArtist =
      item.artistId === current.artistId ? TUNING.sameArtistPenalty : 1;

    // Stable tie-break so revisiting a card re-offers the same two records.
    const jitter = 0.9 + 0.2 * hash01(current.id + item.id);

    scored.push({ item, d, score: band * fame * merit * sameArtist * jitter });
  }

  if (scored.length < 2) return [];

  const shares = (i: Item) => i.corridorIds.some((c) => currentCorridors.has(c));
  const bridges = (i: Item) =>
    !shares(i) && i.corridorIds.some((c) => bridgeCorridors.has(c));

  const byScore = (a: Scored, b: Scored) => b.score - a.score;
  const deeperPool = scored.filter((s) => shares(s.item)).sort(byScore).slice(0, 12);
  let widerPool = scored.filter((s) => bridges(s.item)).sort(byScore).slice(0, 12);

  // Early in the crawl a corridor may have no neighbours loaded yet; fall back
  // to anything outside the current lineage before giving up on contrast.
  if (widerPool.length === 0) {
    widerPool = scored.filter((s) => !shares(s.item)).sort(byScore).slice(0, 12);
  }

  const a = deeperPool.length ? deeperPool : scored.sort(byScore).slice(0, 12);
  const b = widerPool.length ? widerPool : scored.sort(byScore).slice(0, 12);

  let best: { a: Scored; b: Scored; total: number } | null = null;
  for (const ca of a.slice(0, 8)) {
    for (const cb of b.slice(0, 8)) {
      if (ca.item.id === cb.item.id) continue;
      const divergence = distance(ca.item.vector, cb.item.vector);
      const total = ca.score + cb.score + divergence * TUNING.divergenceBonus;
      if (!best || total > best.total) best = { a: ca, b: cb, total };
    }
  }
  if (!best) return [];

  const toBranch = (s: Scored, role: Branch['role']): Branch => {
    const crossed = s.item.corridorIds.find((c) => !currentCorridors.has(c));
    return {
      item: s.item,
      reason: describeMove(current, s.item),
      corridorLabel:
        role === 'wider' && crossed
          ? (CORRIDOR_BY_ID.get(crossed)?.label ?? null)
          : null,
      role,
      distance: s.d,
    };
  };

  return [toBranch(best.a, 'deeper'), toBranch(best.b, 'wider')];
}

/**
 * The escape hatch: a uniformly random record, ignoring distance, corridors
 * and the scorer entirely.
 *
 * Both scored branches are arguments the engine is making about where you
 * should go next. However well tuned it is, a listener who only ever picks
 * from its two suggestions is still walking inside its model of music. The
 * wildcard is the move the engine cannot recommend — which is exactly why it
 * belongs on the same screen.
 *
 * Deterministic per album, like the branches, so stepping back and forward
 * returns the same three doors.
 */
export function pickWildcard(
  pool: Item[],
  excludeIds: ReadonlySet<string>,
  seed: string,
): Item | null {
  const eligible = pool.filter((i) => !excludeIds.has(i.id));
  if (!eligible.length) return null;
  return eligible[Math.floor(hash01(`wild:${seed}`) * eligible.length)];
}

/**
 * Opening card. Picks from the middle of the obscurity range — starting on
 * something canonical makes the first branches feel obvious, starting on
 * something unplaceable gives you nothing to steer away from.
 */
export function pickStart(pool: Item[], seed: string): Item | null {
  // Open on something well-liked and mid-known: a canonical record makes the
  // first branches feel obvious, an unloved one gives nothing to steer from.
  const eligible = pool.filter(
    (i) => i.obscurity >= 2 && i.obscurity <= 7.5 && i.quality >= 5,
  );
  const from = eligible.length ? eligible : pool;
  if (!from.length) return null;
  return from[Math.floor(hash01(seed) * from.length)];
}
