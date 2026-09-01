import { useCallback, useRef } from 'react';
import './DistanceDial.css';

const MIN_ANGLE = -138;
const MAX_ANGLE = 138;
const BALLS = 13;

/** Named stops, so the number has a meaning attached to it. */
const STOPS: [number, string][] = [
  [0.00, 'Nearby'],
  [0.25, 'Close'],
  [0.50, 'Wander'],
  [0.75, 'Reach'],
  [1.00, 'Far'],
];

function wordFor(v: number): string {
  let best = STOPS[0];
  for (const stop of STOPS) {
    if (Math.abs(stop[0] - v) < Math.abs(best[0] - v)) best = stop;
  }
  return best[1];
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
};

interface Props {
  value: number; // 0..1
  onChange: (v: number) => void;
}

export function DistanceDial({ value, onChange }: Props) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const angle = MIN_ANGLE + value * (MAX_ANGLE - MIN_ANGLE);

  const nudge = useCallback(
    (delta: number) => onChange(clamp(value + delta)),
    [value, onChange],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { y: e.clientY, v: value };
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!drag.current) return;
      // Vertical drag rather than true rotation: angular tracking on a knob
      // this size is fiddly and inverts awkwardly as the pointer crosses the top.
      onChange(clamp(drag.current.v + (drag.current.y - e.clientY) / 150));
    },
    [onChange],
  );

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 0.01 : 0.05;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        nudge(step);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        nudge(-step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        onChange(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        onChange(1);
      }
    },
    [nudge, onChange],
  );

  // Nelson-ball-clock markers along the arc of travel; lit up to the value.
  const markers = Array.from({ length: BALLS }, (_, i) => {
    const t = i / (BALLS - 1);
    const deg = MIN_ANGLE + t * (MAX_ANGLE - MIN_ANGLE);
    const [sx, sy] = polar(38, 38, 25, deg);
    const [bx, by] = polar(38, 38, 32.5, deg);
    const lit = t <= value + 0.001;
    return (
      <g key={i} opacity={lit ? 1 : 0.3}>
        <line
          x1={sx} y1={sy} x2={bx} y2={by}
          stroke={lit ? 'var(--accent)' : 'rgba(242,227,198,.35)'}
          strokeWidth="1"
        />
        <circle
          cx={bx} cy={by} r={i % 3 === 0 ? 2.9 : 2}
          fill={lit ? 'var(--accent)' : 'rgba(242,227,198,.32)'}
        />
      </g>
    );
  });

  const [hx, hy] = polar(38, 38, 20, angle);

  return (
    <div className="dial">
      <button
        className="dial__knob"
        role="slider"
        aria-label="Distance between the two offered paths"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={`${Math.round(value * 100)}, ${wordFor(value)}`}
        title="Drag up or down to change how far each step travels"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onWheel={(e) => nudge(e.deltaY < 0 ? 0.04 : -0.04)}
      >
        <svg width="76" height="76" viewBox="0 0 76 76">
          <defs>
            <radialGradient id="dialFace" cx="36%" cy="28%">
              <stop offset="0%" stopColor="#4a3a2c" />
              <stop offset="64%" stopColor="#2b2118" />
              <stop offset="100%" stopColor="#161009" />
            </radialGradient>
          </defs>

          {markers}

          <circle cx="38" cy="38" r="22.5" fill="url(#dialFace)" />
          <circle
            cx="38" cy="38" r="22.5"
            fill="none"
            stroke="rgba(217,164,65,.3)"
            strokeWidth="1"
          />

          {/* pointer */}
          <line
            x1="38" y1="38" x2={hx} y2={hy}
            stroke="var(--accent)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="38" cy="38" r="3.4" fill="var(--accent)" />
          <circle cx="38" cy="38" r="1.3" fill="#1c1611" />
        </svg>
      </button>

      <div className="dial__chevrons">
        <span
          className="dial__chev"
          role="button"
          tabIndex={-1}
          aria-label="Increase distance"
          onClick={() => nudge(0.05)}
        >
          ▲
        </span>
        <span
          className="dial__chev"
          role="button"
          tabIndex={-1}
          aria-label="Decrease distance"
          onClick={() => nudge(-0.05)}
        >
          ▼
        </span>
      </div>

      <div className="dial__readout">
        <span className="dial__number">{Math.round(value * 100)}</span>
        <span className="dial__word">{wordFor(value)}</span>
        <span className="dial__caption">Distance · drag ↕</span>
      </div>
    </div>
  );
}
