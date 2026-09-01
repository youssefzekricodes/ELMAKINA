/**
 * Push notifications — the browser's own, not Firebase.
 *
 * The app already registers a service worker, so subscribing is three calls and nothing added to
 * the bundle: ask, subscribe, hand the subscription to supabase/functions/push. That function signs
 * with VAPID and sends; the worker in public/sw.js shows what arrives.
 *
 * Nothing here ever throws at a caller. A browser with no push support, a permission that was
 * denied months ago, a private window, a missing key in the build — all of them end the same way,
 * with the game running exactly as it did before.
 */
import { supabase } from './supabase';
import { store } from './store';
import { i18n } from '../i18n';

const VAPID = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || '';
const ASKED = 'mekina.pushAsked';

/** Base64url → the Uint8Array the Push API wants for applicationServerKey. */
function keyBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
    && 'Notification' in window && !!VAPID;
}

/** granted | denied | default | unsupported — what the UI should say for itself. */
export function pushStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission as 'granted' | 'denied' | 'default';
}

/** Has this player already been asked once? We never ask twice on our own. */
export const pushAsked = (): boolean => { try { return localStorage.getItem(ASKED) === '1'; } catch { return false; } };
/** "Not now" is an answer. Remember it so the card never comes back on its own. */
export const markPushAsked = (): void => { try { localStorage.setItem(ASKED, '1'); } catch { /* private mode */ } };

async function call(op: string, payload: Record<string, unknown> = {}) {
  if (!supabase) return null;
  try { const { data } = await supabase.functions.invoke('push', { body: { op, ...payload } }); return data; }
  catch { return null; }
}

/**
 * Ask, subscribe, register. Must be called from a real gesture: browsers refuse the permission
 * prompt otherwise, and a refused prompt counts as a "no" the player never actually said.
 *
 * Returns true only if a subscription now exists on the server.
 */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  try { localStorage.setItem(ASKED, '1'); } catch { /* private mode: we may ask again, which is fine */ }
  try {
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,                                  // required by Chrome, and honest: every push here shows
      applicationServerKey: keyBytes(VAPID) as BufferSource,
    });
    const res = await call('subscribe', { sub: sub.toJSON(), lang: i18n.lang });
    const ok = !!(res && res.ok);
    if (ok) store.set({ pushOn: true });
    return ok;
  } catch { return false; }
}

/** Turn it off from this device: drop the browser subscription and the row behind it. */
export async function disablePush(): Promise<void> {
  store.set({ pushOn: false });
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await call('unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    else await call('unsubscribe');
  } catch { /* the row is gone or was never there */ }
}

/**
 * Called once the player is signed in (guest or Google) and the app is up.
 *
 * Two jobs, and only for someone who already said yes: refresh the subscription (endpoints rotate,
 * and the row carries the language, which may have changed since), and tell the server we are here
 * — which is what lets a friend's phone say "they are online". Never asks for permission.
 */
export async function pushOnline(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription()
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) as BufferSource });
    store.set({ pushOn: true });
    await call('subscribe', { sub: sub.toJSON(), lang: i18n.lang });
    await call('online');
  } catch { /* nothing here is worth interrupting a game for */ }
}
