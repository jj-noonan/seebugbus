/**
 * Validate the recommender against independent ground truth.
 *
 * Ground truth is ListenBrainz Labs `similar-artists`, built from collaborative
 * filtering over real listening sessions (scripts/fetch_similar.py). Its
 * independence is the point: our engine reasons from MusicBrainz tags, so
 * agreeing with a tag-derived source would prove nothing. Co-listening data has
 * never seen our axes, our lexicon or our corridors.
 *
 * WHAT GOOD LOOKS LIKE, and why a single number is the wrong shape:
 *
 *   Agreement should be HIGH at Sidewalk and FALL toward Bushwhack. The far end
 *   of the dial is built to leave the neighbourhood — an engine that agreed with
 *   a similarity model at every setting would have a broken dial, not a good
 *   recommender. An early version of this suite averaged all five settings, got
 *   2.0% against a 2.4% random baseline, and appeared to show the engine losing
 *   to chance. It was measuring three settings that are supposed to disagree.
 *
 * So the assertions are: agreement at the near end clearly beats random, and
 * the curve declines as the dial opens.
 *
 *   npx vite-node scripts/eval-recs.ts
 *   npx vite-node scripts/eval-recs.ts -- --paths
 */
import { readFileSync } from 'node:fs';
import { ITEMS } from '../src/data/catalog';
import { pickBranches } from '../src/engine/recommend';

interface Fixture {
  source: string;
  fetchedAt: string;
  seeds: Record<string, { name: string; similar: { mbid: string; name: string }[] }>;
}

const fx: Fixture = JSON.parse(
  readFileSync(new URL('../data/similar-artists.json', import.meta.url), 'utf8'),
);
const showPaths = process.argv.includes('--paths');

/*
 * Similarity is not symmetric, and the per-seed lists are cut at 100.
 * Calexico does not appear in Wilco's top 100; Wilco appears in Calexico's.
 * Measured against a sample of 40 apparent failures, 6 were similar in the
 * reverse direction only — so a one-directional test was calling roughly 15%
 * of good picks wrong, and every Wilco pick worth defending was in that group.
 *
 * The graph over the catalog's most-listened artists lets a pair count when
 * EITHER direction knows the other. That is both more accurate and steadier:
 * an artist near the truncation boundary stops flipping on list length.
 *
 * The graph is evaluation ground truth. If it is ever fed into the engine as a
 * recommendation signal it stops being independent, and the suite needs a
 * different source.
 */
interface Graph { algorithm: string; edges: Record<string, string[]> }

let graph: Graph | null = null;
try {
  graph = JSON.parse(
    readFileSync(new URL('../data/similarity-graph.json', import.meta.url), 'utf8'),
  );
} catch {
  console.log('note: no similarity-graph.json — scoring one-directionally only,');
  console.log('      which undercounts. Build it with fetch_similar.py --graph.\n');
}

/** Does either artist's similarity list know the other? */
// Sets, not arrays: the chance baseline asks this for every seed against
// every artist in the catalog, and `includes` over 100-element lists turned
// that into tens of millions of string comparisons once the seed list grew.
const edgeSets = new Map<string, Set<string>>();
for (const [k, v] of Object.entries(graph?.edges ?? {})) edgeSets.set(k, new Set(v));
const knows = (a: string, b: string): boolean =>
  Boolean(edgeSets.get(a)?.has(b)) || Boolean(edgeSets.get(b)?.has(a));
const DIALS = [0, 0.25, 0.5, 0.75, 1];
const STARTS = 20;

const albumsByArtist = new Map<string, number>();
for (const i of ITEMS) if (i.artistId) albumsByArtist.set(i.artistId, (albumsByArtist.get(i.artistId) ?? 0) + 1);

console.log(`source:  ${fx.source}`);
console.log(`fetched: ${fx.fetchedAt}`);
console.log(`catalog: ${ITEMS.length.toLocaleString()} albums\n`);

// Chance rate: for each seed, the share of the catalog that is by a
// similar artist. This is what picking blindly would score.
let chanceSum = 0, chanceN = 0;
const reach: string[] = [];
for (const [seedId, seed] of Object.entries(fx.seeds)) {
  /*
   * Chance must be counted exactly as hits are. Accepting reverse matches in
   * the numerator while leaving them out of the denominator would inflate the
   * lift for free — the baseline has to widen by the same rule the test did.
   */
  const acceptedIds = new Set(seed.similar.map((s) => s.mbid));
  for (const other of albumsByArtist.keys()) {
    if (!acceptedIds.has(other) && knows(seedId, other)) acceptedIds.add(other);
  }
  const present = [...acceptedIds].filter((id) => albumsByArtist.has(id));
  const albums = present.reduce((n, id) => n + (albumsByArtist.get(id) ?? 0), 0)
    + (albumsByArtist.get(seedId) ?? 0);
  chanceSum += albums / ITEMS.length; chanceN++;
  reach.push(`  ${seed.name.padEnd(20)} ${String(present.length).padStart(4)} similar artists held, ${String(albums).padStart(4)} albums (chance ${(100*albums/ITEMS.length).toFixed(1)}%)`);
}
const chance = chanceSum / Math.max(1, chanceN);
console.log('ground-truth reachability:');
reach.forEach((r) => console.log(r));
console.log(`\nchance rate (mean): ${(100 * chance).toFixed(2)}%\n`);

const rows: { dial: number; hits: number; offers: number }[] = [];
const perSeed = new Map<string, { hits: number; offers: number }>();

for (const dial of DIALS) {
  let hits = 0, offers = 0;
  for (const [seedId, seed] of Object.entries(fx.seeds)) {
    const accepted = new Set(seed.similar.map((s) => s.mbid));
    const starts = ITEMS.filter((i) => i.artistId === seedId).slice(0, STARTS);
    for (const start of starts) {
      const bs = pickBranches(start, ITEMS, dial, new Set([start.id]));
      for (const b of bs) {
        offers++;
        const ok = Boolean(b.item.artistId) &&
          (accepted.has(b.item.artistId!) ||
            b.item.artistId === seedId ||
            knows(seedId, b.item.artistId!));
        if (ok) hits++;
        if (dial === 0) {
          const p = perSeed.get(seed.name) ?? { hits: 0, offers: 0 };
          p.offers++; if (ok) p.hits++;
          perSeed.set(seed.name, p);
        }
      }
      if (showPaths && dial === 0) {
        console.log(`  ${seed.name} — ${start.title}`);
        for (const b of bs) {
          const ok = b.item.artistId &&
            (accepted.has(b.item.artistId) || b.item.artistId === seedId ||
              knows(seedId, b.item.artistId));
          console.log(`    ${ok ? '✓' : '·'} ${b.role.padEnd(6)} ${b.item.subtitle.slice(0,26).padEnd(26)} ${b.item.title.slice(0,28)}`);
        }
      }
    }
  }
  rows.push({ dial, hits, offers });
}

console.log('agreement by terrain setting (should fall as the dial opens):');
for (const r of rows) {
  const rate = r.hits / Math.max(1, r.offers);
  const bar = '#'.repeat(Math.round(rate * 120));
  console.log(`  dial ${r.dial.toFixed(2)}  ${String(r.hits).padStart(3)}/${String(r.offers).padEnd(4)} ${(100*rate).toFixed(1).padStart(5)}%  ${bar}`);
}

const near = rows[0].hits / Math.max(1, rows[0].offers);
const far = rows[rows.length - 1].hits / Math.max(1, rows[rows.length - 1].offers);
console.log(`\nnear-end agreement   ${(100*near).toFixed(1)}%`);
console.log(`chance               ${(100*chance).toFixed(2)}%`);
console.log(`LIFT AT NEAR END     ${(near/Math.max(1e-9,chance)).toFixed(1)}x`);
console.log(`declines with dial   ${near > far ? 'yes' : 'NO — the dial is not separating'}`);

console.log('\nper-seed at the near end:');
[...perSeed.entries()].sort((a,b)=>(b[1].hits/b[1].offers)-(a[1].hits/a[1].offers))
  .forEach(([n,v]) => console.log(`  ${n.padEnd(20)} ${v.hits}/${v.offers}  ${(100*v.hits/v.offers).toFixed(0)}%`));

const problems: string[] = [];
if (near < chance * 2) problems.push(`near-end agreement ${(100*near).toFixed(1)}% is under 2x chance`);
if (near <= far) problems.push('agreement does not decline as the dial opens');
console.log(problems.length ? `\nFAIL: ${problems.join('; ')}` : '\nPASS');
process.exit(problems.length ? 1 : 0);
