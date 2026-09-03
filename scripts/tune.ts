/**
 * Sweep engine tuning against both things that matter, in one process.
 *
 * Agreement alone is not the goal — an engine that only ever offered the five
 * most obvious neighbours would score well and be useless. Reach (how much of
 * the catalog is ever offered) and repetition are the counterweight, and the
 * point of putting them side by side is that a change which buys agreement by
 * narrowing the field shows its cost in the same table.
 *
 * In-process because the catalog takes most of a minute to load, and a sweep
 * that reloads it per setting is a sweep nobody runs.
 *
 *   npx vite-node scripts/tune.ts                 # the standard grid
 *   npx vite-node scripts/tune.ts jitter 0.1 0.5  # one knob, explicit values
 */
import { readFileSync } from 'node:fs';
import { ITEMS } from '../src/data/catalog';
import { pickBranches, TUNING } from '../src/engine/recommend';

interface Fixture {
  seeds: Record<string, { name: string; similar: { mbid: string; name: string }[] }>;
}
const fx: Fixture = JSON.parse(
  readFileSync(new URL('../data/similar-artists.json', import.meta.url), 'utf8'),
);
let graph: { edges: Record<string, string[]> } | null = null;
try {
  graph = JSON.parse(
    readFileSync(new URL('../data/similarity-graph.json', import.meta.url), 'utf8'),
  );
} catch { /* one-directional scoring, as eval-recs warns */ }

const edgeSets = new Map<string, Set<string>>();
for (const [k, v] of Object.entries(graph?.edges ?? {})) edgeSets.set(k, new Set(v));
const knows = (a: string, b: string) =>
  Boolean(edgeSets.get(a)?.has(b)) || Boolean(edgeSets.get(b)?.has(a));

const STARTS = 20;
const seeds = Object.entries(fx.seeds);

/** Agreement with co-listening at the near end of the dial. */
function agreement(): number {
  let hits = 0, offers = 0;
  for (const [seedId, seed] of seeds) {
    const accepted = new Set(seed.similar.map((s) => s.mbid));
    for (const start of ITEMS.filter((i) => i.artistId === seedId).slice(0, STARTS)) {
      for (const b of pickBranches(start, ITEMS, 0, new Set([start.id]))) {
        offers++;
        const a = b.item.artistId;
        if (a && (accepted.has(a) || a === seedId || knows(seedId, a))) hits++;
      }
    }
  }
  return offers ? hits / offers : 0;
}

/*
 * Median quality of what the widest setting offers, against the catalog's own
 * median.
 *
 * The far end is built to disagree with co-listening, so agreement cannot
 * judge it — an engine returning noise out there scores 0% exactly as
 * designed. Quality comes from devotion and MusicBrainz ratings, independent
 * of the co-listening ground truth, so it is a fair test of whether the wide
 * end is still choosing records worth hearing or has stopped choosing at all.
 */
function farQuality(): { far: number; catalog: number } {
  const med = (xs: number[]) =>
    xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0;
  const qs: number[] = [];
  for (const start of ITEMS.filter((_, i) => i % 89 === 0).slice(0, 120)) {
    for (const b of pickBranches(start, ITEMS, 1, new Set([start.id]))) {
      qs.push(b.item.quality);
    }
  }
  return { far: med(qs), catalog: med(ITEMS.map((i) => i.quality)) };
}

/** How much of the catalog a long random walk ever puts in front of anyone. */
function reach(): { share: number; repeats: number } {
  const seen = new Map<string, number>();
  let offers = 0;
  // Fixed starts and dials, so runs are comparable across settings.
  const starts = ITEMS.filter((_, i) => i % 97 === 0).slice(0, 80);
  for (const start of starts) {
    let cur = start;
    for (let step = 0; step < 20; step++) {
      const dial = (step % 5) / 4;
      const bs = pickBranches(cur, ITEMS, dial, new Set([cur.id]));
      if (!bs.length) break;
      for (const b of bs) {
        offers++;
        seen.set(b.item.id, (seen.get(b.item.id) ?? 0) + 1);
      }
      cur = bs[step % bs.length].item;
    }
  }
  return {
    share: seen.size / ITEMS.length,
    repeats: offers / Math.max(1, seen.size),
  };
}

const GRID: [keyof typeof TUNING, number[]][] = [
  ['popularitySigma', [2.7, 3.5, 4.5, 6.0]],
  ['jitter', [0.15, 0.25, 0.4, 0.6]],
  ['poolSize', [15, 30, 60, 120]],
  ['idiomWeight', [0.45, 0.65, 0.85]],
];

const argKnob = process.argv[2] as keyof typeof TUNING | undefined;
const grid: [keyof typeof TUNING, number[]][] = argKnob
  ? [[argKnob, process.argv.slice(3).map(Number)]]
  : GRID;

console.log(`catalog ${ITEMS.length.toLocaleString()}, ${seeds.length} seeds\n`);
console.log('knob                value   agreement    reach   repeats  farQual');
console.log('-'.repeat(68));

for (const [knob, values] of grid) {
  const original = TUNING[knob];
  let best = { v: original, a: -1 };
  for (const v of values) {
    (TUNING as Record<string, number>)[knob as string] = v;
    const a = agreement();
    const r = reach();
    const q = farQuality();
    const mark = v === original ? ' (current)' : '';
    console.log(
      `${String(knob).padEnd(18)} ${String(v).padStart(6)}   ` +
      `${(100 * a).toFixed(1).padStart(6)}%  ${(100 * r.share).toFixed(1).padStart(6)}%  ` +
      `${r.repeats.toFixed(1).padStart(6)}x  ` +
      `${q.far.toFixed(1).padStart(5)}${mark}`,
    );
    if (a > best.a) best = { v, a };
  }
  (TUNING as Record<string, number>)[knob as string] = original;
  console.log(`${''.padEnd(18)} best agreement at ${best.v}\n`);
}
