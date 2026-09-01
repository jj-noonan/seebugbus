import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted so the app has no CDN dependency and works offline.
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/playfair-display/900.css';
import './index.css';
import App from './App.tsx';
import { ToastHost } from './components/Toast';
import { pendingMbids } from './engine/ingest';

// The ingest queue lives in localStorage; this is how it gets to the crawler:
//   copy(segueQueue().join('\n'))   then   pbpaste | python3 scripts/ingest_mbids.py
(window as unknown as { segueQueue: () => string[] }).segueQueue = pendingMbids;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastHost>
      <App />
    </ToastHost>
  </StrictMode>,
);
