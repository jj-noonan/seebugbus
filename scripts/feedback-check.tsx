/**
 * Does a verdict actually change what gets offered?
 *
 * The store and the scorer are separately correct easily enough; the thing
 * worth testing is the loop between them, which is where a feature like this
 * usually fails silently — the click registers, the log fills up, and the
 * recommendations never budge.
 */
import { ITEMS, ITEM_BY_ID } from '../src/data/catalog';
import { pickBranches } from '../src/engine/recommend';
import { record, weights, clear, all, verdictFor } from '../src/engine/feedback';

// The module talks to localStorage; give it one.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const pool = ITEMS;
const seed =
  ITEMS.find((i) => /Born in the U\.S\.A/i.test(i.title)) ?? ITEMS[0];
const none = new Set<string>();

console.log(`seed: ${seed.subtitle} — ${seed.title}\n`);

// 1. Baseline.
clear();
const before = pickBranches(seed, pool, 0.25, none, weights());
check('baseline returns two offers', before.length === 2,
  before.map((b) => `${b.role}: ${b.item.title}`).join(' | '));

// 2. Reject one of them; it should stop being offered.
const rejected = before[0];
record({
  id: rejected.item.id, verdict: 'bad', at: new Date().toISOString(),
  fromId: seed.id, dial: 0.25, role: rejected.role,
});
const after = pickBranches(seed, pool, 0.25, none, weights());
check('a rejected offer is displaced',
  !after.some((b) => b.item.id === rejected.item.id),
  `was "${rejected.item.title}", now ${after.map((b) => b.item.title).join(' | ')}`);

// 3. The verdict survives a read-back, keyed on the pair.
check('verdict reads back for the pair',
  verdictFor(rejected.item.id, seed.id) === 'bad');

// 4. The penalty is scoped to the step, not global. From a different source
//    the same record should still be reachable — a bad pairing is not a ban.
const w = weights();
check('pair penalty is harsher than the item penalty',
  (w.byPair.get(`${seed.id}>${rejected.item.id}`) ?? 1) <
  (w.byItem.get(rejected.item.id) ?? 1));

// 5. Approval pushes the other way.
clear();
const liked = pickBranches(seed, pool, 0.25, none, weights())[1];
const rival = pool.find(
  (i) => i.id !== liked.item.id && i.id !== seed.id && i.artistId !== seed.artistId,
)!;
record({
  id: rival.id, verdict: 'good', at: new Date().toISOString(),
  fromId: seed.id, dial: 0.25,
});
const w2 = weights();
check('approval raises the multiplier above 1',
  (w2.byPair.get(`${seed.id}>${rival.id}`) ?? 1) > 1);

// 6. Re-judging replaces rather than accumulates.
record({ id: rival.id, verdict: 'bad', at: new Date().toISOString(), fromId: seed.id });
check('re-judging replaces the earlier verdict',
  all().filter((e) => e.id === rival.id && e.fromId === seed.id).length === 1 &&
  verdictFor(rival.id, seed.id) === 'bad');

// 7. Nothing said, nothing changed.
clear();
const w3 = weights();
check('empty feedback is a no-op', w3.byItem.size === 0 && w3.byPair.size === 0);

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`);
console.log(`catalog: ${ITEMS.length.toLocaleString()} items, ${ITEM_BY_ID.size.toLocaleString()} indexed`);
process.exit(failures === 0 ? 0 : 1);
