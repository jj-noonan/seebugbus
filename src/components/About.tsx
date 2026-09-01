import { useEffect } from 'react';
import { STOPS } from './DistanceDial';
import './About.css';

/** What this thing is and how to drive it. */
export function About({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // The flow's arrow keys must not fire behind the panel.
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="about" role="dialog" aria-modal="true" aria-label="About seebugbus">
      <div className="about__scrim" onClick={onClose} />
      <div className="about__panel">
        <button className="about__close" onClick={onClose} aria-label="Close">×</button>

        <header className="about__head">
          <img src="./svg/logo-stacked.svg" alt="seebugbus" width={116} />
          <p className="tagline">Choose your own <em>music</em> adventure</p>
        </header>

        <p className="about__lede">
          Streaming recommendations circle the densest corner of your taste and
          hand back the same well-known neighbours. This drives somewhere instead.
        </p>

        <section>
          <h3>The three roads</h3>
          <dl>
            <dt><kbd>→</kbd> Wider</dt>
            <dd>Crosses into a bordering lineage. Still defensible, but it hands you off somewhere you weren't.</dd>
            <dt><kbd>↓</kbd> Deeper</dt>
            <dd>Stays inside the lineage you're already walking.</dd>
            <dt><kbd>↑</kbd> Shuffle</dt>
            <dd>A record chosen at random from the whole catalog, ignoring every rule. The move the engine can't recommend.</dd>
            <dt><kbd>←</kbd> Back</dt>
            <dd>One step, to take the road you skipped.</dd>
          </dl>
          <p className="about__note">
            The two offers are never picked independently — the pair is chosen to
            maximise the distance <em>between</em> them, because two good roads
            leading to the same place are only one road.
          </p>
        </section>

        <section>
          <h3>The terrain dial</h3>
          <p>
            How far each step travels. It sets a <em>target</em> distance, not a
            maximum, so turning it up moves both offers outward rather than just
            spreading them. Novelty rides along with it: reaching further also
            means reaching past the canon.
          </p>
          <ol className="about__stops">
            {STOPS.map((s, i) => (
              <li key={s.name}><b>{i + 1} · {s.name}</b> — {s.blurb}</li>
            ))}
          </ol>
        </section>

        <section>
          <h3>Where the records come from</h3>
          <p>
            Crawled from <a href="https://musicbrainz.org" target="_blank" rel="noreferrer">MusicBrainz</a> and
            the <a href="https://coverartarchive.org" target="_blank" rel="noreferrer">Cover Art Archive</a>,
            organised as eleven walkable lineages — krautrock through post-punk to
            early techno, spiritual jazz through sampling-era hip-hop, and so on.
            Each is sampled across popularity <em>and</em> decade, so the canon and
            the deep cuts both show up and no era swamps the rest.
          </p>
          <p>
            Every album is placed on seven axes — era, energy, density, brightness,
            organic↔electronic, conventional↔experimental, instrumental↔vocal —
            mapped by hand from its tags. Hover any cover to see which of those
            moved, and why it's being offered.
          </p>
        </section>

        <section>
          <h3>Search</h3>
          <p>
            Searching something the catalog lacks isn't a dead end: it's looked up
            live in MusicBrainz, and if it exists it's fetched and added on the
            spot. Press <kbd>/</kbd> from anywhere.
          </p>
        </section>

        <footer className="about__foot">
          Titles link to MusicBrainz. Play buttons open a search in Spotify or
          Apple Music — no account or login involved.
        </footer>
      </div>
    </div>
  );
}
