import { useCallback } from 'react';
import type { Item } from '../data/schema';
import { record, verdictFor, type Verdict } from '../engine/feedback';
import './Feedback.css';

interface Props {
  item: Item;
  from: Item | null;
  dial: number;
  role?: 'deeper' | 'wider' | 'shuffle';
  /** Bump so the parent re-reads weights and re-picks the offers. */
  onChange: () => void;
}

const CHOICES: { verdict: Verdict; glyph: string; label: string }[] = [
  { verdict: 'good', glyph: '♥', label: 'Good call' },
  { verdict: 'meh', glyph: '~', label: 'Fine, not for me' },
  { verdict: 'bad', glyph: '✕', label: 'Wrong turn' },
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
export function Feedback({ item, from, dial, role, onChange }: Props) {
  const current = verdictFor(item.id, from?.id);

  const cast = useCallback(
    (verdict: Verdict) => {
      record({
        id: item.id,
        verdict,
        at: new Date().toISOString(),
        fromId: from?.id,
        dial,
        role,
        title: item.title,
        artist: item.subtitle,
        fromTitle: from?.title,
      });
      onChange();
    },
    [item, from, dial, role, onChange],
  );

  return (
    <div className="fb" role="group" aria-label="Rate this recommendation">
      {CHOICES.map((c) => (
        <button
          key={c.verdict}
          type="button"
          className={`fb__btn fb__btn--${c.verdict}${current === c.verdict ? ' is-on' : ''}`}
          aria-pressed={current === c.verdict}
          title={c.label}
          aria-label={c.label}
          onClick={() => cast(c.verdict)}
        >
          {c.glyph}
        </button>
      ))}
    </div>
  );
}
