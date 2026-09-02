/* Which shell the app is running in.
 *
 * Web and app ship the SAME game code; what differs is what is allowed to load beside it. One
 * difference is not cosmetic: AdSense's terms forbid its code inside an application, so an AdSense
 * loader in the Play/App Store build risks the whole publisher account — including the website's
 * revenue, which is the part that already works. AdMob is the app-side product for the same job.
 *
 * So the answer is gated twice, because one gate is easy to forget:
 *
 *   BUILD TIME — VITE_PLATFORM=native tells vite.config.ts to leave the AdSense loader AND the
 *                google-adsense-account meta tag out of the HTML shell. A build made this way is
 *                structurally incapable of loading AdSense; there is no code path to get it wrong.
 *   RUNTIME    — isNative() is also true whenever Capacitor's bridge is present, so even a bundle
 *                built for the web refuses to load AdSense if it somehow boots inside the app.
 *
 * Belt and braces, because the expensive mistake only runs in one direction: AdSense-in-an-app
 * costs an account, while an over-cautious web build merely shows no ad.
 */

/** Decided by the build. Safe to use for anything that must be settled before the app boots. */
export const NATIVE_BUILD = import.meta.env.VITE_PLATFORM === 'native';

/**
 * Are we inside a native shell right now?
 *
 * A function rather than a const because the Capacitor half is a RUNTIME fact: the bridge defines
 * window.Capacitor before our bundle evaluates, but depending on that ordering to be true forever
 * is the kind of assumption that breaks quietly and expensively. Reading it per call costs nothing.
 */
export function isNative(): boolean {
  if (NATIVE_BUILD) return true;
  const cap = (globalThis as any).Capacitor;
  if (!cap) return false;
  return typeof cap.isNativePlatform === 'function' ? !!cap.isNativePlatform() : !!cap.isNative;
}

/** 'ios' | 'android' | 'web' — which store build this is, for anything that differs per platform
 *  (ad unit ids, push registration). Falls back to 'web' whenever the bridge is not there. */
export function platformName(): 'ios' | 'android' | 'web' {
  const cap = (globalThis as any).Capacitor;
  const p = cap && typeof cap.getPlatform === 'function' ? cap.getPlatform() : 'web';
  return p === 'ios' || p === 'android' ? p : 'web';
}
