/**
 * Simulate walks through the catalog and print them, so recommendation quality
 * can be judged without a browser. This is the fast loop for tuning the lexicon
 * and the branch scorer.
 *
 *   npx tsx scripts/walk.ts [--steps 8] [--dial 0.5] [--walks 3]
 */
import { CATALOG_STATS, ITEMS } from '../src/data/catalog';
import { CORRIDOR_BY_ID } from '../src/data/corridors';
import { pickBranches, pickStart } from '../src/engine/recommend';

const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};

const steps = arg('steps', 7);
const walks = arg('walks', 3);
const dial = arg('dial', 0.5);

console.log(
  `catalog: ${ITEMS.length} usable albums (${CATALOG_STATS.albums} harvested), ` +
    `${CATALOG_STATS.corridorsComplete.length}/11 corridors\n`,
);

const spread = (get: (i: (typeof ITEMS)[number]) => number, label: string) => {
  const v = ITEMS.map(get).sort((a, b) => a - b);
  console.log(
    `${label.padEnd(11)} min ${v[0]?.toFixed(1)} / median ` +
      `${v[Math.floor(v.length / 2)]?.toFixed(1)} / max ${v.at(-1)?.toFixed(1)}`,
  );
};
spread((i) => i.popularity, 'popularity');
spread((i) => i.quality, 'quality');
console.log();

for (let w = 0; w < walks; w++) {
  const start = pickStart(ITEMS, `walk-${w}-${dial}`);
  if (!start) break;
  console.log(`── walk ${w + 1} (dial ${dial}) ──────────────────────────`);
  let current = start;
  const visited = new Set<string>([start.id]);
  console.log(
    `  ${current.subtitle} — ${current.title} (${current.yearStart}) ` +
      `[pop ${current.popularity} q ${current.quality}] {${current.corridorIds.join(',')}}`,
  );

  for (let s = 0; s < steps; s++) {
    const branches = pickBranches(current, ITEMS, dial, visited);
    if (branches.length < 2) {
      console.log('  (no branches)');
      break;
    }
    for (const b of branches) {
      const cross = b.corridorLabel ? ` -> ${b.corridorLabel}` : '';
      console.log(
        `     ${b.role === 'deeper' ? 'D' : 'W'} d=${b.distance.toFixed(2)} ` +
          `${b.item.subtitle} — ${b.item.title} (${b.item.yearStart}) ` +
          `[pop ${b.item.popularity} q ${b.item.quality}] "${b.reason}"${cross}`,
      );
    }
    const spread = branches.length === 2
      ? Math.hypot(
          ...Object.keys(branches[0].item.vector).map(
            (k) => (branches[0].item.vector as any)[k] - (branches[1].item.vector as any)[k],
          ),
        )
      : 0;
    // Take the wider branch half the time so walks don't all hug one corridor.
    const chosen = branches[s % 2];
    console.log(`     ^ spread between offers: ${spread.toFixed(2)} — taking ${chosen.role}`);
    current = chosen.item;
    visited.add(current.id);
    console.log(
      `  ${current.subtitle} — ${current.title} (${current.yearStart}) ` +
        `{${current.corridorIds.map((c) => CORRIDOR_BY_ID.get(c)?.label ?? c).join(',')}}`,
    );
  }
  console.log();
}
