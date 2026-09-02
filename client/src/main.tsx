import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/oswald';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './styles.css';
import App from './App';
import { preloadAssets } from './lib/assets';
import { isNative } from './lib/platform';
import { captureError, initMonitor } from './lib/monitor';

// Keep the last runtime errors reachable for debugging (window.__mekinaErrors) and show a readable fallback.
const errs: string[] = ((window as any).__mekinaErrors = []);
const push = (e: any) => { errs.push(String((e && (e.stack || e.message)) || e)); };
window.addEventListener('error', (e) => push(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => push(e.reason));

class Boundary extends React.Component<{ children: React.ReactNode }, { err: any }> {
  state = { err: null as any };
  static getDerivedStateFromError(err: any) { return { err }; }
  // A React tree that has fallen over is the one error worth knowing about above all others: the
  // player is looking at a fallback screen and cannot tell us anything useful themselves. It goes
  // to the local buffer (readable from the console, and replayed if Sentry loads later) AND out.
  componentDidCatch(err: any, info: any) { push(err); captureError(err, { componentStack: info?.componentStack }); }
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

/** Drive the splash's progress bar. It lives in index.html, so this talks to it through the DOM. */
function splashProgress(done: number, total: number) {
  const el = document.getElementById('splash');
  if (!el || !total) return;
  const pct = Math.round((done / total) * 100);
  el.setAttribute('data-loading', '');
  el.style.setProperty('--sp', pct + '%');
  const label = el.querySelector('.sp-pct');
  if (label) label.textContent = pct + '%';
}

function mount() {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Boundary>
        <App />
      </Boundary>
    </React.StrictMode>,
  );
  dismissSplash();
  initMonitor();   // after the app is on screen: monitoring is not what anyone came for
}

/**
 * Fill the art cache before the first paint, so the board never renders against half-loaded
 * images — and on every visit after the first, so it never touches the network for them at all.
 * Capped: a slow or blocked cache must not hold the game hostage, and every asset falls back to
 * its own path anyway, so mounting early costs nothing but a few late images.
 */
const BOOT_CAP_MS = 6000;
Promise.race([
  preloadAssets(splashProgress),
  new Promise((r) => setTimeout(r, BOOT_CAP_MS)),
]).catch(() => { /* the theme keeps its original paths */ }).then(mount);

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

// Register the PWA service worker (installable + offline shell). Prod only — no SW in dev, and
// never inside the native shell. There the assets are already local and are replaced by store
// releases, so a cache in front of them is a SECOND, independent source of staleness — and unlike
// a browser there is no way for a player to force a refresh out of it. (lib/update.ts needs no
// such guard: in an app /version.json is the bundled copy, so it always matches BUILD_ID and the
// "newer build is live" prompt simply never fires.)
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative()) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
