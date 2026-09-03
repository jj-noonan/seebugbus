/**
 * How much of the catalog can the engine actually offer, and at what quality?
 *
 * The two pull against each other: weighting quality harder raises the average
 * of what's offered but shrinks the reachable set, which is the repetition this
 * app exists to avoid. This prints both so the trade-off is visible when tuning
 * TUNING in recommend.ts.
 *
 *   npx vite-node scripts/reach-check.ts
 */
import { ITEMS } from '../src/data/catalog';
import { pickBranches, pickStart } from '../src/engine/recommend';

const WALKS = 400, STEPS = 8;
const dials = [0, 0.25, 0.5, 0.75, 1];
const seen = new Set<string>();
const quals: number[] = [];
const pops: number[] = [];
let offers = 0;

for (let w = 0; w < WALKS; w++) {
  const dial = dials[w % dials.length];
  let cur = pickStart(ITEMS, `r${w}`);
  if (!cur) continue;
  const visited = new Set<string>([cur.id]);
  for (let s = 0; s < STEPS; s++) {
    const bs = pickBranches(cur, ITEMS, dial, visited);
    if (bs.length < 2) break;
    for (const b of bs) {
      seen.add(b.item.id);
      quals.push(b.item.quality);
      pops.push(b.item.popularity);
      offers++;
    }
    cur = bs[s % 2].item;
    visited.add(cur.id);
  }
}

const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`catalog            ${ITEMS.length.toLocaleString()}`);
console.log(`offers made        ${offers.toLocaleString()}`);
console.log(`distinct offered   ${seen.size.toLocaleString()} (${(100 * seen.size / ITEMS.length).toFixed(1)}% of catalog)`);
console.log(`repeats per album  ${(offers / seen.size).toFixed(1)}x`);
console.log(`offered quality    median ${med(quals).toFixed(1)}  (catalog median ${med(ITEMS.map(i => i.quality)).toFixed(1)})`);
console.log(`offered popularity median ${med(pops).toFixed(1)}`);
