import { useEffect, useMemo, useRef, useState } from 'react';
import { ITEMS } from '../data/catalog';
import type { Item } from '../data/schema';
import './SearchBox.css';

const LIMIT = 8;

function normalise(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Rank a candidate against the query.
 *
 * Deliberately crude, because it is a stopgap: this scans the catalog the
 * browser already has, which works while the export is capped in the tens of
 * thousands. The real one is FTS5 behind an API — `items_fts` already exists
 * with prefix indexes, and this component only has to swap where `results`
 * comes from.
 *
 * Ordering favours a title that starts with the query, then an artist that
 * does, then anything containing it — and breaks ties by listen count so the
 * record someone is most likely to have meant surfaces first.
 */
function score(item: Item, q: string): number {
  const title = normalise(item.title);
  const artist = normalise(item.subtitle);
  if (title === q || artist === q) return 100;
  if (title.startsWith(q)) return 80;
  if (artist.startsWith(q)) return 70;
  if (title.includes(q)) return 50;
  if (artist.includes(q)) return 40;
  return 0;
}

export function SearchBox({ onPick }: { onPick: (item: Item) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = normalise(query.trim());
    if (q.length < 2) return [];
    const hits: { item: Item; s: number }[] = [];
    for (const item of ITEMS) {
      const s = score(item, q);
      // 10 - obscurity recovers the popularity ordering as a tie-break.
      if (s > 0) hits.push({ item, s: s * 100 + (10 - item.obscurity) });
    }
    hits.sort((a, b) => b.s - a.s);
    return hits.slice(0, LIMIT).map((h) => h.item);
  }, [query]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // "/" focuses search from anywhere, the way every search field on the web does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (item: Item) => {
    onPick(item);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Arrow keys drive the flow globally; inside the field they belong to the
    // result list, so stop them here rather than letting both fire.
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter' && results[cursor]) {
      e.preventDefault();
      pick(results[cursor]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showing = open && query.trim().length >= 2;

  return (
    <div className="search" ref={boxRef}>
      <div className="search__field">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.6-3.6" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          placeholder="Search an album or artist to jump there…"
          aria-label="Search the catalog"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button className="search__clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Clear search">
            ×
          </button>
        )}
      </div>

      {showing && (
        <div className="search__results" role="listbox">
          {results.length === 0 ? (
            <p className="search__empty">
              Nothing in the catalog yet — it only holds what has been crawled.
            </p>
          ) : (
            results.map((item, i) => (
              <button
                key={item.id}
                className="search__row"
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(item)}
              >
                {item.artThumbUrl ? (
                  <img className="search__art" src={item.artThumbUrl} alt="" loading="lazy" />
                ) : (
                  <span className="search__art" />
                )}
                <span className="search__meta">
                  <span className="search__title">{item.title}</span>
                  <span className="search__artist">{item.subtitle}</span>
                </span>
                <span className="search__year">{item.yearStart ?? ''}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
