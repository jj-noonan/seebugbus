import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Item } from '../data/schema';
import { CoverCase, WildCase } from './CoverCase';

export type SlotName = 'past' | 'focus' | 'up' | 'down';
type RenderedSlot = SlotName | 'exit-left' | 'exit-right';

export interface FlowCard {
  /** Identity across renders. Continuity of key is what produces the glide. */
  key: string;
  item: Item | null;
  slot: SlotName;
  face: 'art' | 'wild';
  badge?: string;
  /** Key that takes this branch, shown in the badge. */
  badgeKey?: string;
  why?: ReactNode;
  taken?: boolean;
  onClick?: () => void;
}

interface Rendered extends Omit<FlowCard, 'slot'> {
  slot: RenderedSlot;
  exiting?: boolean;
}

/** A card leaving the offer rail exits right; the discarded past card exits left. */
function exitSlotFor(slot: SlotName): RenderedSlot {
  return slot === 'past' ? 'exit-left' : 'exit-right';
}

/**
 * Keeps cards mounted briefly after they leave, so they can animate out.
 *
 * React unmounts a removed child immediately, which would make unchosen offers
 * and the dropped past card blink out of existence mid-glide. Holding them for
 * one transition — in an exit slot, at zero opacity — lets the whole screen
 * settle as one motion instead of part sliding and part disappearing.
 */
function usePresence(desired: FlowCard[], ttl = 520): Rendered[] {
  const [leaving, setLeaving] = useState<Rendered[]>([]);
  const previous = useRef<FlowCard[]>([]);

  useEffect(() => {
    const live = new Set(desired.map((d) => d.key));
    const gone = previous.current.filter((p) => !live.has(p.key));
    previous.current = desired;
    if (!gone.length) return;

    const exits: Rendered[] = gone.map((g) => ({
      ...g,
      slot: exitSlotFor(g.slot),
      exiting: true,
      onClick: undefined,
    }));
    setLeaving((cur) => [...cur.filter((c) => !live.has(c.key)), ...exits]);

    const timer = setTimeout(() => {
      const dropped = new Set(exits.map((e) => e.key));
      setLeaving((cur) => cur.filter((c) => !dropped.has(c.key)));
    }, ttl);
    return () => clearTimeout(timer);
  }, [desired, ttl]);

  const live = new Set(desired.map((d) => d.key));
  return [...(desired as Rendered[]), ...leaving.filter((l) => !live.has(l.key))];
}

export function Flow({ cards }: { cards: FlowCard[] }) {
  const rendered = usePresence(cards);

  return (
    <>
      {rendered.map((c) => {
        const interactive = Boolean(c.onClick);
        const body = (
          <div className="slot__in">
            {c.face === 'wild' || !c.item ? (
              <WildCase width="100%" />
            ) : (
              <CoverCase item={c.item} width="100%" reflect={c.slot === 'focus'} />
            )}
          </div>
        );

        return (
          <div
            key={c.key}
            className={`slot${interactive ? ' slot--interactive' : ''}`}
            data-slot={c.slot}
          >
            {interactive ? (
              <button
                className="slot__card"
                onClick={c.onClick}
                title={c.item ? `${c.item.title} — ${c.item.subtitle}` : 'Wildcard'}
              >
                {body}
              </button>
            ) : (
              <div className="slot__card">{body}</div>
            )}
            {c.badge && (
              <span className="slot__badge">
                {c.badgeKey && <kbd>{c.badgeKey}</kbd>}
                {c.badge}
              </span>
            )}
            {c.taken && <span className="slot__taken" title="the path you took">✓</span>}
            {c.why && !c.exiting && <span className="slot__why">{c.why}</span>}
          </div>
        );
      })}
    </>
  );
}
