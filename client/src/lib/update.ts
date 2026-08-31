/**
 * Force update — keeps a phone off a stale bundle.
 *
 * A PWA is sticky by design: an installed app holds a service worker and a cache full of
 * content-hashed assets, so a player can keep running last week's client against this week's
 * server for days without noticing. Every deploy stamps a build id into both the bundle and
 * dist/version.json; this polls the file and, when the two disagree, a newer build is live.
 *
 * Updating is not just a reload: the service worker has to go, and the caches with it, or the
 * reload is served the very bundle we are trying to leave.
 */
import { store } from './store';

declare const __BUILD_ID__: string;
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

// A minute, not five. The file is ~50 bytes and deploys land often; waiting five minutes to be
// told the client is stale reads as the check being broken.
const EVERY_MS = 60 * 1000;

async function liveBuild(): Promise<string | null> {
  try {
    // cache-bust in the URL as well as the header: some webviews ignore `cache: 'no-store'`.
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.build === 'string' ? j.build : null;
  } catch { return null; }
}

/** Poll for a newer deploy: on boot, every few minutes, and whenever the app comes back to life. */
export function initUpdateCheck(): void {
  if (BUILD_ID === 'dev') return;  // `npm run dev` has no version.json and needs no nagging
  const check = async () => {
    if (store.get().updateReady) return;
    const live = await liveBuild();
    if (live && live !== BUILD_ID) store.set({ updateReady: true });
  };
  check();
  setInterval(check, EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('online', check);
}

/** Drop the service worker and every cache, then reload onto the new build. */
export async function applyUpdate(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs || []).map((r) => r.unregister()));
  } catch { /* no service worker, nothing to shed */ }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* Cache Storage unavailable — the reload alone will have to do */ }
  location.reload();
}
