import type { Item } from '../data/schema';
import { verdictFor, type Verdict } from '../engine/feedback';
import './Feedback.css';

interface Props {
  item: Item;
  from: Item | null;
  dial: number;
  role?: 'deeper' | 'wider' | 'shuffle';
  /** Bump so the parent re-reads weights and re-picks the offers. */
  onChange: () => void;
  /** Casting lives in the parent, so a key and a click take the same path. */
  onCast: (v: Verdict) => void;
  /** Briefly lit after a keyboard verdict, where the eye is on the cover
   *  rather than on these marks and the change of state is easy to miss. */
  flash: Verdict | null;
}

const CHOICES: { verdict: Verdict; glyph: string; label: string; key: string }[] = [
  { verdict: 'good', glyph: '♥', label: 'Good call', key: 'g' },
  { verdict: 'meh', glyph: '~', label: 'Fine, not for me', key: 'm' },
  { verdict: 'bad', glyph: '✕', label: 'Wrong turn', key: 'x' },
];

/**
 * A verdict on the record in front of you.
 *
 * Deliberately three states, not two. "Wrong turn" and "fine, not for me" pull
 * in the same direction but not with the same force, and without the middle
 * option a merely unexciting pick gets punished as hard as a nonsensical one —
 * which is how a recommender ends up only ever playing safe.
 *
 * The judgement is stored against the *step* as well as the album, because the
 * same record can be right after one thing and wrong after another.
 */
export function Feedback({ item, from, onCast, flash }: Props) {
  const current = verdictFor(item.id, from?.id);

  return (
    <div className="fb" role="group" aria-label="Rate this recommendation">
      {CHOICES.map((c) => (
        <button
          key={c.verdict}
          type="button"
          className={
            `fb__btn fb__btn--${c.verdict}` +
            (current === c.verdict ? ' is-on' : '') +
            (flash === c.verdict ? ' is-flash' : '')
          }
          aria-pressed={current === c.verdict}
          title={`${c.label}  (${c.key})`}
          aria-label={c.label}
          onClick={() => onCast(c.verdict)}
        >
          {c.glyph}
        </button>
      ))}
    </div>
  );
}
