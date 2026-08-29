import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/oswald';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './styles.css';
import App from './App';

// Keep the last runtime errors reachable for debugging (window.__mekinaErrors) and show a readable fallback.
const errs: string[] = ((window as any).__mekinaErrors = []);
const push = (e: any) => { errs.push(String((e && (e.stack || e.message)) || e)); };
window.addEventListener('error', (e) => push(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => push(e.reason));

class Boundary extends React.Component<{ children: React.ReactNode }, { err: any }> {
  state = { err: null as any };
  static getDerivedStateFromError(err: any) { return { err }; }
  componentDidCatch(err: any) { push(err); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui', color: '#fff', background: '#18181b', minHeight: '100vh' }}>
          <h2 style={{ margin: 0 }}>ELMEKINA — something broke in the UI</h2>
          <p>Reload the page. If it keeps happening, copy this and report it:</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, opacity: 0.8 }}>{String(this.state.err && (this.state.err.stack || this.state.err.message || this.state.err))}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>,
);

/**
 * Take down the boot splash from index.html once React has actually painted.
 *
 * Two frames, not a timer: the first lands after React's commit, the second after the browser has
 * painted it — so the splash never lifts onto a blank frame. The removal is also belt-and-braces
 * (transitionend AND a timeout) because a backgrounded tab can skip the transition entirely and
 * would otherwise keep an invisible overlay swallowing every tap.
 */
function dismissSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    el.classList.add('gone');
    const kill = () => el.remove();
    el.addEventListener('transitionend', kill, { once: true });
    setTimeout(kill, 700); // a backgrounded tab can skip the transition entirely
  };
  // Two frames so the splash never lifts onto a blank frame — but rAF does NOT run in a background
  // tab, and on its own that leaves an invisible full-screen overlay eating every tap. The timer is
  // the one that actually guarantees removal.
  requestAnimationFrame(() => requestAnimationFrame(go));
  setTimeout(go, 1200);
}
dismissSplash();

// Register the PWA service worker (installable + offline shell). Prod only — no SW in dev.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
