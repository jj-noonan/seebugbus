import { useState, type CSSProperties } from 'react';
import type { Item } from '../data/schema';
import './CoverCase.css';

/** Stable hue per album, so a missing cover still looks deliberate. */
function hueFor(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

/** The closed-case wildcard face: no art, because the point is not knowing. */
export function WildCase({ width }: { width: string }) {
  return (
    <div className="case case--wild" style={{ '--w': width } as CSSProperties}>
      <div className="case__body">
        <div className="case__wildface">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <g className="case__die">
              <rect x="7" y="7" width="18" height="18" rx="4.2" />
              {/* quincunx: the face everyone reads as "chance" */}
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="20" cy="12" r="1.7" />
              <circle cx="16" cy="16" r="1.7" />
              <circle cx="12" cy="20" r="1.7" />
              <circle cx="20" cy="20" r="1.7" />
            </g>
          </svg>
          <span className="case__wildlabel">Wildcard</span>
        </div>
        <div className="case__hinge" />
        <div className="case__sheen" />
        <div className="case__rim" />
      </div>
    </div>
  );
}

interface Props {
  item: Item;
  /** CSS width; the height follows from the jewel-case aspect ratio. */
  width: string;
  reflect?: boolean;
  /** Small cards in the trail and branch rails don't need the 500px art. */
  thumb?: boolean;
}

export function CoverCase({ item, width, reflect = false, thumb = false }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = (thumb ? item.artThumbUrl : item.artUrl) ?? item.artUrl;
  const hue = hueFor(item.title + item.subtitle);

  const face = (
    <>
      {(!loaded || failed) && (
        <div className="case__fallback">
          {item.title}
        </div>
      )}
      {src && !failed && (
        <img
          className={`case__art${loaded ? ' case__art--in' : ''}`}
          src={src}
          alt={`${item.title} by ${item.subtitle}`}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </>
  );

  return (
    <div
      className="case"
      style={{ '--w': width, '--hue': hue } as CSSProperties}
    >
      <div className="case__body">
        {face}
        <div className="case__hinge" />
        <div className="case__sheen" />
        <div className="case__rim" />
      </div>
      {reflect && (
        <div className="case__reflection" aria-hidden="true">
          {face}
        </div>
      )}
    </div>
  );
}
