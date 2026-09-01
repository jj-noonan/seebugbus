import { useEffect, useRef, useState } from 'react';
import './Die.css';

/** Pip coordinates on a 3x3 grid, per face. */
const FACES: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

const ROLL_MS = 560;

/**
 * A real die, not a die-shaped icon.
 *
 * The face actually changes while it tumbles and settles on where it landed —
 * a static glyph that merely spins reads as decoration, whereas a face that
 * cycles reads as chance being resolved. Which is the whole point of the
 * control it sits on.
 */
export function Die({ rolling }: { rolling: boolean }) {
  const [face, setFace] = useState(5);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!rolling) return;
    // Cycle faces during the tumble, then settle on the last one drawn.
    timer.current = window.setInterval(() => {
      setFace(1 + Math.floor(Math.random() * 6));
    }, 70);
    const stop = window.setTimeout(() => {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
    }, ROLL_MS - 60);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      window.clearTimeout(stop);
    };
  }, [rolling]);

  return (
    <span className={`die${rolling ? ' die--rolling' : ''}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <rect
          className="die__body"
          x="6" y="6" width="88" height="88" rx="20"
        />
        {FACES[face].map(([cx, cy], i) => (
          <circle
            key={i}
            className="die__pip"
            cx={25 + cx * 25}
            cy={25 + cy * 25}
            r="7.6"
          />
        ))}
      </svg>
    </span>
  );
}

export { ROLL_MS };
