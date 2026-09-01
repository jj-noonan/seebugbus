import { useCallback, useRef } from 'react';
import './DistanceDial.css';

const MIN_ANGLE = -122;
const MAX_ANGLE = 122;

/**
 * Five stops, not a continuum.
 *
 * A speedometer that can rest anywhere invites fiddling for a "right" number
 * that doesn't exist — the underlying scale is fuzzy, and five named terrains
 * are all the resolution the recommender can honestly act on. Detents also make
 * the control legible at a glance: you are on stop 3 of 5, not at 49.
 */
export const STOPS: { name: string; blurb: string }[] = [
  { name: 'Sidewalk',    blurb: 'barely a step — close variations' },
  { name: 'Footpath',    blurb: 'a gentle turn off the main road' },
  { name: 'Ridgeline',   blurb: 'real ground covered, still a path' },
  { name: 'Backcountry', blurb: 'far out, and it shows' },
  { name: 'Bushwhack',   blurb: 'no path at all' },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const toIndex = (v: number) => Math.round(clamp01(v) * (STOPS.length - 1));
const toValue = (i: number) => i / (STOPS.length - 1);

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
  const index = toIndex(value);
  const angle = MIN_ANGLE + toValue(index) * (MAX_ANGLE - MIN_ANGLE);

  const step = useCallback(
    (delta: number) => onChange(toValue(Math.min(STOPS.length - 1, Math.max(0, index + delta)))),
    [index, onChange],
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
      // Snap while dragging rather than on release, so the detents are felt.
      const raw = clamp01(drag.current.v + (drag.current.y - e.clientY) / 190);
      const snapped = toValue(toIndex(raw));
      if (snapped !== value) onChange(snapped);
    },
    [onChange, value],
  );

  const endDrag = useCallback(() => { drag.current = null; }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'Home') { e.preventDefault(); onChange(0); }
      else if (e.key === 'End') { e.preventDefault(); onChange(1); }
    },
    [step, onChange],
  );

  // Gauge ticks: five majors with numerals, minors between, on a 244° sweep.
  const majors = STOPS.map((_, i) => {
    const deg = MIN_ANGLE + toValue(i) * (MAX_ANGLE - MIN_ANGLE);
    const [x1, y1] = polar(50, 50, 33, deg);
    const [x2, y2] = polar(50, 50, 41, deg);
    const [nx, ny] = polar(50, 50, 25.5, deg);
    const on = i <= index;
    return (
      <g key={i}>
        <line
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="var(--sbb-ink)"
          strokeWidth={3}
          strokeLinecap="round"
          opacity={on ? 1 : 0.35}
        />
        <text
          x={nx} y={ny + 3.4}
          textAnchor="middle"
          className="gauge__num"
          opacity={on ? 1 : 0.4}
        >
          {i + 1}
        </text>
      </g>
    );
  });

  const minors = Array.from({ length: 4 }, (_, i) => {
    const deg = MIN_ANGLE + ((i + 0.5) / 4) * (MAX_ANGLE - MIN_ANGLE);
    const [x1, y1] = polar(50, 50, 36, deg);
    const [x2, y2] = polar(50, 50, 41, deg);
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--sbb-ink)" strokeWidth={1.4} opacity={0.3} />;
  });

  const [tipX, tipY] = polar(50, 50, 30, angle);
  const [bx1, by1] = polar(50, 50, 5.5, angle - 90);
  const [bx2, by2] = polar(50, 50, 5.5, angle + 90);

  return (
    <div className="dial">
      <button
        className="dial__knob"
        role="slider"
        aria-label="How far the offered paths travel"
        aria-valuemin={1}
        aria-valuemax={STOPS.length}
        aria-valuenow={index + 1}
        aria-valuetext={STOPS[index].name}
        title={`${STOPS[index].name} — ${STOPS[index].blurb}. Drag up or down.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onWheel={(e) => step(e.deltaY < 0 ? 1 : -1)}
      >
        <svg viewBox="0 0 100 100">
          {/* Cream face inside an ink bezel — the badge from the logo, round. */}
          <circle className="gauge__bezel" cx="50" cy="50" r="47" />
          <circle className="gauge__face" cx="50" cy="50" r="43" />
          {minors}
          {majors}
          {/* Needle */}
          <polygon
            className="gauge__needle"
            points={`${tipX},${tipY} ${bx1},${by1} ${bx2},${by2}`}
          />
          <circle className="gauge__hub" cx="50" cy="50" r="6" />
          <circle className="gauge__hubdot" cx="50" cy="50" r="2.1" />
        </svg>
      </button>

      <div className="dial__readout">
        <span className="dial__number">{index + 1}<i>/5</i></span>
        <span className="dial__word">{STOPS[index].name}</span>
        <span className="dial__caption">Terrain · drag ↕</span>
      </div>
    </div>
  );
}
