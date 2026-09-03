import { useState } from 'react';
import { AXES, type Item } from '../data/schema';
import { CORRIDOR_BY_ID } from '../data/corridors';
import { AXIS_SD, TAG_IDF, MEAN_IDF } from '../data/catalog';
import { STOPS } from './DistanceDial';
import { idiomOverlap, TUNING, type Branch } from '../engine/recommend';
import { all as allFeedback, summary as feedbackSummary, exportText, clear as clearFeedback } from '../engine/feedback';
import { ITEM_BY_ID } from '../data/catalog';
import './Debug.css';

interface Props {
  current: Item;
  branches: Branch[];
  wildcard: Item | null;
  trail: Item[];
  dial: number;
  poolSize: number;
  onClose: () => void;
  /** Re-read weights after the log is cleared here. */
  onFeedbackChange: () => void;
}

/*
 * The tags of whichever record has fewer, priced and marked for sharing.
 *
 * Overlap divides by the smaller set, so these are the terms that actually
 * decided the score — and their idf is why a pick that looks arbitrary often
 * is not, or is. A row of cheap shared words (rock 0.9, pop 2.3) next to a
 * high score is the signature of the failure this panel exists to catch.
 */
function sharedTags(a: Item, b: Item) {
  const at = new Set(a.tags.map((t) => t.tag));
  const bt = new Set(b.tags.map((t) => t.tag));
  const [small, large] = at.size <= bt.size ? [at, bt] : [bt, at];
  return [...small]
    .map((tag) => ({
      tag,
      idf: TAG_IDF.get(tag) ?? MEAN_IDF,
      shared: large.has(tag),
    }))
    .sort((x, y) => Number(y.shared) - Number(x.shared) || y.idf - x.idf)
    .slice(0, 10);
}

const n = (v: number | null | undefined, d = 2) =>
  v == null ? '—' : v.toFixed(d);

/**
 * Everything behind the current recommendation, on one screen.
 *
 * The scores are products of several terms, so a pick that looks arbitrary is
 * usually one term dominating. Showing the factors separately is the only way
 * to tell "the metric disagrees with me" from "the metric is broken".
 */
export function Debug({
  current, branches, wildcard, trail, dial, poolSize, onClose, onFeedbackChange,
}: Props) {
  const [copied, setCopied] = useState(false);
  const entries = allFeedback();
  const fb = feedbackSummary();
  // Newest first, and capped — the panel is for spotting a pattern, not for
  // reading the whole log. `copy` hands over everything.
  const recent = [...entries].reverse().slice(0, 12);

  const copy = () => {
    navigator.clipboard.writeText(exportText(ITEM_BY_ID)).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };

  const stop = STOPS[Math.round(dial * (STOPS.length - 1))];

  return (
    <div className="debug">
      <div className="debug__head">
        <b>debug</b>
        <span>
          terrain {stop.name} ({dial.toFixed(2)}) · pool {poolSize.toLocaleString()} ·
          target radius {n(branches[0]?.debug?.targetR)} · target popularity{' '}
          {n(branches[0]?.debug?.targetPop, 1)} · quality weight{' '}
          {n(branches[0]?.debug?.qWeight)}
        </span>
        <button onClick={onClose} aria-label="Close debug">×</button>
      </div>

      <section>
        <h4>focus</h4>
        <table>
          <tbody>
            <tr><th>album</th><td>{current.title}</td></tr>
            <tr><th>artist</th><td>{current.subtitle}</td></tr>
            <tr><th>year</th><td>{current.yearStart ?? '—'}</td></tr>
            <tr><th>origin</th><td>{current.country ?? '—'}</td></tr>
            <tr><th>popularity</th><td>{n(current.popularity, 1)} / 10</td></tr>
            <tr><th>quality</th><td>{n(current.quality, 1)} / 10</td></tr>
            <tr><th>obscurity</th><td>{n(current.obscurity, 1)} / 10</td></tr>
            <tr><th>listeners</th><td>{current.listenerCount?.toLocaleString() ?? '—'}</td></tr>
            <tr><th>plays</th><td>{current.listenCount?.toLocaleString() ?? '—'}</td></tr>
            <tr><th>devotion</th><td>
              {current.listenCount && current.listenerCount
                ? `${(current.listenCount / current.listenerCount).toFixed(1)} plays per listener`
                : '—'}
            </td></tr>
            <tr><th>MB rating</th><td>{current.rating != null ? `${current.rating} / 5` : 'none'}</td></tr>
            <tr><th>corridors</th><td>
              {current.corridorIds.length
                ? current.corridorIds.map((c) => CORRIDOR_BY_ID.get(c)?.label ?? c).join(', ')
                : <em>none — cannot be a lineage crossing</em>}
            </td></tr>
            <tr><th>tags</th><td className="debug__tags">
              {current.tags.length
                ? current.tags.map((t) => `${t.tag}·${t.count}`).join('  ')
                : <em>none</em>}
            </td></tr>
            <tr><th>mbid</th><td className="debug__mono">{current.id}</td></tr>
          </tbody>
        </table>

        <h4>vector</h4>
        <div className="debug__axes">
          {AXES.map((a) => (
            <div key={a} className="debug__axis">
              <span>{a}</span>
              <span className="debug__bar"><i style={{ width: `${current.vector[a] * 100}%` }} /></span>
              <span className="debug__num">{n(current.vector[a])}</span>
              <span className="debug__sd">sd {n(AXIS_SD[a])}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4>offers</h4>
        {branches.map((b) => (
          <div key={b.item.id} className="debug__offer">
            <div className="debug__offerhead">
              <b>{b.role}</b> {b.item.subtitle} — {b.item.title}
              <span> ({b.item.yearStart})</span>
            </div>
            <div className="debug__factors">
              <span>distance <b>{n(b.distance, 3)}</b></span>
              <span>idiom <b>{n(idiomOverlap(current, b.item))}</b></span>
              <span>pop <b>{n(b.item.popularity, 1)}</b></span>
              <span>qual <b>{n(b.item.quality, 1)}</b></span>
            </div>
            {b.debug && (
              <div className="debug__factors debug__factors--calc">
                <span>score <b>{b.debug.score.toExponential(2)}</b></span>
                <span>= band {n(b.debug.band, 3)}</span>
                <span>× fame {n(b.debug.fame, 3)}</span>
                {b.debug.voted !== 1 && (
                  <span className="debug__voted">× feedback <b>{n(b.debug.voted, 2)}</b></span>
                )}
                <span>× merit {n(b.debug.merit)}</span>
                <span>× idiom {n(b.debug.idiom)}</span>
                <span>× artist {n(b.debug.sameArtist)}</span>
                <span>× jitter {n(b.debug.jitter)}</span>
              </div>
            )}
            <div className="debug__tagshare">
              {sharedTags(current, b.item).map(({ tag, idf, shared }) => (
                <span
                  key={tag}
                  className={shared ? 'debug__tag is-shared' : 'debug__tag'}
                  title={`${shared ? 'shared' : 'not shared'} — idf ${idf.toFixed(2)}`}
                >
                  {tag}
                  <i>{idf.toFixed(1)}</i>
                </span>
              ))}
            </div>
            <div className="debug__why">{b.reason}</div>
          </div>
        ))}
        {wildcard && (
          <div className="debug__offer">
            <div className="debug__offerhead">
              <b>shuffle</b> {wildcard.subtitle} — {wildcard.title}
            </div>
            <div className="debug__factors">
              <span>uniform random, no scoring</span>
              <span>pop <b>{n(wildcard.popularity, 1)}</b></span>
              <span>qual <b>{n(wildcard.quality, 1)}</b></span>
            </div>
          </div>
        )}
      </section>

      <section>
        <h4>path ({trail.length})</h4>
        <ol className="debug__path">
          {trail.map((t, i) => (
            <li key={`${t.id}-${i}`}>
              {t.subtitle} — {t.title}
              <span> pop {n(t.popularity, 1)} · qual {n(t.quality, 1)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h4>feedback ({fb.total})</h4>
        {fb.total === 0 ? (
          <p className="debug__empty">
            Nothing judged yet. The marks under the case feed straight back into
            scoring — a rejected step is suppressed the next time it comes up.
          </p>
        ) : (
          <>
            <div className="debug__factors">
              <span>♥ good <b>{fb.good}</b></span>
              <span>~ meh <b>{fb.meh}</b></span>
              <span>✕ bad <b>{fb.bad}</b></span>
            </div>
            <ol className="debug__path">
              {recent.map((e, i) => (
                <li key={`${e.id}-${i}`}>
                  <b>{e.verdict}</b>{' '}
                  {ITEM_BY_ID.get(e.id)?.subtitle ?? e.artist} —{' '}
                  {ITEM_BY_ID.get(e.id)?.title ?? e.title}
                  <span>
                    {e.role ?? 'seed'} · dial {n(e.dial)}
                    {e.fromTitle ? ` · after ${e.fromTitle}` : ''}
                  </span>
                </li>
              ))}
            </ol>
            <div className="debug__fbactions">
              <button onClick={copy}>{copied ? 'copied' : 'copy all as text'}</button>
              <button
                onClick={() => {
                  clearFeedback();
                  onFeedbackChange();
                }}
              >
                clear
              </button>
            </div>
          </>
        )}
      </section>

      <footer>
        idiom weight {TUNING.idiomWeight} · divergence bonus {TUNING.divergenceBonus} ·
        pool {TUNING.poolSize} · pairs {TUNING.pairSearch} · jitter ±{TUNING.jitter}
        <br />
        <kbd>d</kbd> closes this
      </footer>
    </div>
  );
}
