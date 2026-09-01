/**
 * Renders the app once, server-side, and reports the structure it produced.
 *
 * Catches the class of breakage a typecheck can't — a crash during render, a
 * branch rail that silently comes back empty, a focus card with no title —
 * without needing a browser.
 *
 *   npx tsx scripts/render-check.tsx
 */
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
};
(globalThis as any).window = { addEventListener() {}, removeEventListener() {} };

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import App from '../src/App';

const html = renderToString(createElement(App));
const count = (re: RegExp) => (html.match(re) ?? []).length;

console.log('rendered chars: ', html.length);
console.log('jewel cases:    ', count(/class="case"/g));
console.log('reflections:    ', count(/case__reflection/g));
console.log('slot badges:    ', count(/slot__badge/g));
console.log('hover reasons:  ', count(/slot__why/g));
console.log('play links:     ', count(/class="play play--(spotify|apple)"/g));
console.log('dial present:   ', /dial__face/.test(html));
console.log('search present: ', /class="searchtrigger"/.test(html));
console.log('shuffle present:', /class="shuffle"/.test(html));
console.log('brand opens info:', /class="brand"/.test(html));
console.log('gauge stops:   ', (html.match(/gauge__num/g) ?? []).length);
console.log(
  'focus card:     ',
  html.match(/class="plate__title">.*?>([^<]+)</s)?.[1],
  '·',
  html.match(/class="plate__sub">([^<]*)/)?.[1]?.replace(/<!-- -->/g, ''),
);
console.log(
  'reasons:        ',
  [...html.matchAll(/class="slot__why">([^<]+)/g)].map((m) => m[1]),
);

const problems: string[] = [];
if (count(/class="case"/g) < 3) problems.push('expected a focus card plus two offers');
if (count(/data-slot="focus"/g) !== 1) problems.push('expected exactly one focus slot');
if (!/class="shuffle"/.test(html)) problems.push('shuffle control missing');
if (!/class="searchtrigger"/.test(html)) problems.push('search trigger missing');
if (!/gauge__needle/.test(html)) problems.push('gauge needle missing');
if (!/dial__face/.test(html)) problems.push('distance dial missing');
if (count(/class="play play--(spotify|apple)"/g) !== 2) problems.push('expected two streaming buttons');
console.log(problems.length ? `\nPROBLEMS: ${problems.join('; ')}` : '\nOK');
process.exit(problems.length ? 1 : 0);
