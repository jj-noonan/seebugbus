/**
 * Drives the app in jsdom and asserts that clicking a branch actually advances
 * the flow. Isolates "the React logic is wrong" from "the element isn't
 * receiving the click in a real browser" — jsdom has no layout or hit testing,
 * so a pass here points the finger squarely at CSS.
 *
 *   npx vite-node scripts/click-check.tsx
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173',
  pretendToBeVisual: true,
});
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
// Node 26 defines `navigator` as a getter-only global; redefine rather than assign.
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.MouseEvent = dom.window.MouseEvent;
g.Image = dom.window.Image;
g.HTMLCanvasElement = dom.window.HTMLCanvasElement;
g.getComputedStyle = dom.window.getComputedStyle;
// feedback.ts reaches for a bare `localStorage`, as it can in a browser.
// Without this it silently catches and no-ops, and the check tests nothing.
g.localStorage = dom.window.localStorage;
g.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id: any) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement } = await import('react');
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: App } = await import('../src/App');

const container = document.getElementById('root')!;
const root = createRoot(container);
await act(async () => { root.render(createElement(App)); });

const read = () => ({
  title: container.querySelector('.plate__title')?.textContent,
  artist: container.querySelector('.plate__sub')?.textContent,
  past: container.querySelectorAll('[data-slot="past"]').length,
  doors: container.querySelectorAll('.slot--interactive').length,
});

console.log('initial:', read());

const branch = container.querySelector('[data-slot="up"] .slot__card') as any;
if (!branch) {
  console.log('\nPROBLEM: no offer card rendered');
  process.exit(1);
}
console.log('offer up:', container.querySelector('[data-slot="up"] .slot__badge')?.textContent,
            '->', container.querySelector('[data-slot="up"] .slot__why')?.textContent);

await act(async () => {
  branch.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
});
const after = read();
console.log('after click:', after);

const before = read.name; // placeholder to keep tsc quiet
void before;

const problems: string[] = [];
if (after.past !== 1) problems.push(`expected 1 past card after one click, got ${after.past}`);
// past card + 2 offers = 3 interactive slots; shuffle is a control now
if (after.doors !== 3) problems.push(`expected 3 interactive slots, got ${after.doors}`);

// And a second click, to be sure the flow keeps advancing.
const branch2 = container.querySelector('[data-slot="down"] .slot__card') as any;
await act(async () => {
  branch2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
});
const after2 = read();
console.log('after 2nd click:', after2);
// Only ever one past card is shown, however deep the path goes.
if (after2.past !== 1) problems.push(`expected exactly 1 past card, got ${after2.past}`);

// Walk back by clicking the oldest trail card.
const step = container.querySelector('[data-slot="past"] .slot__card') as any;
await act(async () => {
  step.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
});
console.log('after back click:', read());

// The wildcard: a third door that ignores the scorer entirely.
const wild = container.querySelector('.shuffle') as any;
if (!wild) problems.push('shuffle control missing');
else {
  const beforeWild = read().title;
  await act(async () => {
    wild.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const afterWild = read();
  console.log('after shuffle:', afterWild);
  if (afterWild.title === beforeWild) problems.push('shuffle did not advance');
}

// Arrow keys must select offers rather than scroll the page.
const key = (k: string) =>
  act(async () => {
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }),
    );
  });
const beforeKey = read().title;
await key('ArrowRight');
const afterKey = read();
console.log('after ArrowRight:', afterKey);
if (afterKey.title === beforeKey) problems.push('ArrowRight did not take the first offer');
await key('ArrowLeft');
console.log('after ArrowLeft:', read());

// Search: open the overlay, type, and click a result. This path silently
// broke once when the footer's stacking context let the header cover the
// result rows and swallow the clicks.
const trigger = container.querySelector('.searchtrigger') as any;
if (!trigger) problems.push('search trigger missing');
else {
  await act(async () => {
    trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const input = container.querySelector('.search__field input') as any;
  if (!input) problems.push('search overlay did not open');
  else {
    /*
     * The rating keys are plain letters, so while the search field is open they
     * have to stay letters. If this ever regresses, searching for "grunge"
     * silently rates three records on the way to the 'r'.
     */
    dom.window.localStorage.clear();
    await key('g');
    await key('x');
    const strayed = JSON.parse(dom.window.localStorage.getItem('segue.feedback.v1') ?? '[]');
    if (strayed.length !== 0) {
      problems.push(`typing in search recorded ${strayed.length} verdict(s)`);
    }
    console.log('verdicts recorded while typing in search:', strayed.length, '(want 0)');

    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype, 'value',
    )!.set!;
    await act(async () => {
      setter.call(input, 'the');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    const rows = container.querySelectorAll('.search__row');
    console.log('search rows for "the":', rows.length);
    if (!rows.length) problems.push('search returned no local results for "the"');
    else {
      const label = rows[0].querySelector('.search__title')?.textContent;
      const before = read().title;
      await act(async () => {
        (rows[0] as any).dispatchEvent(
          new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
        );
      });
      const after = read();
      console.log('picked:', label, '-> focus is now:', after.title);
      if (after.title === before) problems.push('picking a search result did not navigate');
      if (after.title !== label) problems.push(`expected focus "${label}", got "${after.title}"`);
      if (container.querySelector('.searchpanel')) problems.push('overlay stayed open after picking');
    }
  }
}

// Debug overlay: 'd' toggles it, and it must show real score components.
await key('d');
const dbg = container.querySelector('.debug');
console.log('debug opens on d:', dbg ? 'yes' : 'NO');
if (!dbg) problems.push('debug panel did not open');
else {
  const txt = dbg.textContent ?? '';
  for (const want of ['distance', 'idiom', 'band', 'jitter', 'vector', 'path']) {
    if (!txt.includes(want)) problems.push(`debug panel missing "${want}"`);
  }
  console.log('debug shows score factors:', /band/.test(txt) && /idiom/.test(txt) ? 'yes' : 'NO');
  await key('d');
  if (container.querySelector('.debug')) problems.push('debug did not close on second d');
  else console.log('debug closes on d again: yes');
}

/*
 * Keyboard verdicts. These must take the same path as the buttons, and must
 * stay out of the way of typing — 'g', 'm' and 'x' are letters in the search
 * field before they are ratings.
 */
{
  dom.window.localStorage.clear();
  await key('g');
  const viaKey = JSON.parse(dom.window.localStorage.getItem('segue.feedback.v1') ?? '[]');
  console.log('after g:', viaKey.length, viaKey[0]?.verdict);
  if (viaKey.length !== 1 || viaKey[0]?.verdict !== 'good') {
    problems.push('g did not record a good verdict');
  }
  dom.window.localStorage.clear();
}

/*
 * Feedback. The click has to reach the button AND the verdict has to reach the
 * scorer: the failure mode worth catching is a mark that lights up, writes its
 * row, and changes nothing about what is offered next.
 */
const marks = container.querySelectorAll('.fb__btn');
if (marks.length !== 3) problems.push(`expected 3 feedback marks, got ${marks.length}`);
else {
  const offers = () =>
    [...container.querySelectorAll('[data-slot="up"] .slot__card, [data-slot="down"] .slot__card')]
      .map((n) => n.textContent?.trim().slice(0, 30)).join(' | ');
  const offeredBefore = offers();
  const bad = container.querySelector('.fb__btn--bad') as any;
  await act(async () => {
    bad.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const pressed = bad.getAttribute('aria-pressed') === 'true';
  if (!pressed) problems.push('feedback mark did not register as pressed');
  const stored = JSON.parse(dom.window.localStorage.getItem('segue.feedback.v1') ?? '[]');
  if (stored.length !== 1) problems.push(`expected 1 stored verdict, got ${stored.length}`);
  if (stored[0]?.verdict !== 'bad') problems.push(`stored verdict was ${stored[0]?.verdict}`);
  console.log('after bad mark:', { pressed, stored: stored.length, verdict: stored[0]?.verdict });

  /*
   * The offers ahead should NOT move. A mark on the focused card judges the
   * step that arrived at it, not the doors leading onward from it.
   */
  if (offers() !== offeredBefore) {
    problems.push('marking the focus changed the offers ahead of it');
  }

  /*
   * The loop that matters is visible one step back: return to where the
   * rejected card was offered, and it should no longer be on offer. This is
   * the whole feature end to end — click, store, score, re-pick.
   */
  const rejected = container.querySelector('.plate__title')?.textContent;
  const backCard = container.querySelector('[data-slot="past"] .slot__card') as any;
  if (!backCard) problems.push('no past card to step back to');
  else {
    await act(async () => {
      backCard.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const doorsNow = offers();
    console.log('rejected:', rejected);
    console.log('doors on return:', doorsNow.slice(0, 90));
    if (rejected && doorsNow.includes(rejected)) {
      problems.push(`rejected card "${rejected}" is still offered after stepping back`);
    }
  }
}

console.log(problems.length ? `\nPROBLEMS: ${problems.join('; ')}` : '\nREACT LOGIC OK');
process.exit(problems.length ? 1 : 0);
