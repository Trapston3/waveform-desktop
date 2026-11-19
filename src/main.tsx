import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter';
import '@fontsource/plus-jakarta-sans';
import '@fontsource/instrument-serif';
import '@fontsource/fraunces';
import '@fontsource/space-grotesk';
import '@fontsource/jetbrains-mono';
import '@fontsource/outfit';
import App from './App';
import { OverlayViewportApp } from './lyricVisualizer/ui/OverlayViewportApp';
import { AmbientViewportApp } from './lyricVisualizer/ui/AmbientViewportApp';
import './index.css';

export function resolveRootComponentForHash(hash: string): 'overlay' | 'ambient' | 'app' {
  const clean = (hash || '').trim();
  if (clean.startsWith('#/overlay')) return 'overlay';
  if (clean.startsWith('#/ambient')) return 'ambient';
  return 'app';
}

const RootViewportRouter: React.FC = () => {
  const [hash, setHash] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.hash : ''
  );

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const route = resolveRootComponentForHash(hash);
  if (route === 'overlay') {
    return <OverlayViewportApp />;
  }
  if (route === 'ambient') {
    return <AmbientViewportApp />;
  }
  return <App />;
};

if (typeof document !== 'undefined') {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <RootViewportRouter />
      </React.StrictMode>
    );
  }
}
