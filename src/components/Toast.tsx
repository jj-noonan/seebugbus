import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './Toast.css';

type Tone = 'ok' | 'warn' | 'busy';
interface Note { id: number; text: ReactNode; tone: Tone }

const Ctx = createContext<(text: ReactNode, tone?: Tone, ms?: number) => number>(() => 0);
export const useToast = () => useContext(Ctx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const next = useRef(1);

  const push = useCallback((text: ReactNode, tone: Tone = 'ok', ms = 4200) => {
    const id = next.current++;
    setNotes((n) => [...n, { id, text, tone }]);
    // A busy note stays until whoever raised it replaces or clears it.
    if (ms > 0) window.setTimeout(() => setNotes((n) => n.filter((x) => x.id !== id)), ms);
    return id;
  }, []);

  const api = useMemo(() => push, [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {notes.map((n) => (
          <div key={n.id} className={`toast toast--${n.tone}`}>{n.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
