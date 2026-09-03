import { AXES, type Item } from '../data/schema';
import { CORRIDOR_BY_ID } from '../data/corridors';
import { AXIS_SD } from '../data/catalog';
import { STOPS } from './DistanceDial';
import { idiomOverlap, TUNING, type Branch } from '../engine/recommend';
import './Debug.css';

interface Props {
  current: Item;
  branches: Branch[];
  wildcard: Item | null;
  trail: Item[];
  dial: number;
  poolSize: number;
  onClose: () => void;
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
  current, branches, wildcard, trail, dial, poolSize, onClose,
}: Props) {
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
                <span>× merit {n(b.debug.merit)}</span>
                <span>× idiom {n(b.debug.idiom)}</span>
                <span>× artist {n(b.debug.sameArtist)}</span>
                <span>× jitter {n(b.debug.jitter)}</span>
              </div>
            )}
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

      <footer>
        idiom weight {TUNING.idiomWeight} · divergence bonus {TUNING.divergenceBonus} ·
        pool {TUNING.poolSize} · pairs {TUNING.pairSearch} · jitter ±{TUNING.jitter}
        <br />
        <kbd>d</kbd> closes this
      </footer>
    </div>
  );
}
