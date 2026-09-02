/* Google H5 Games Ads (the Ad Placement API) — the WEB provider.
 *
 * Why this and not a display unit inside our own modal: the Placement API is Google's product for
 * exactly this moment. It preloads, renders its own compliant countdown and dismiss control, and
 * enforces its own frequency caps. Wrapping a plain display unit in a home-made modal is the
 * classic way to earn an AdSense policy strike.
 *
 * BROWSERS ONLY. AdSense may not run inside an application — see lib/platform.ts for why that
 * matters more than it sounds. configured() enforces it at runtime; the build enforces it again by
 * never emitting the loader into a native shell's HTML.
 */

import { DEFAULT_ADSENSE_CLIENT, isAdsClient, resolveId } from '../google';
import { isNative } from '../platform';
import type { AdProvider, BreakType } from './provider';

// Production always has a publisher id; dev builds stay ad-free unless VITE_ADSENSE_CLIENT is set,
// so local play never touches Google. A malformed override is ignored, not obeyed.
//
// Resolved LAZILY, and memoised — not for tidiness. resolveId() warns on a malformed override, so
// calling it at module scope is a side effect the bundler cannot prove away, and that alone was
// enough to keep this file's publisher id inside the native bundle after everything else in it had
// been shaken out. Deferring the call leaves nothing to run at import, so the module drops whole.
// Verified by grepping dist.
let resolved: string | null = null;
function client(): string {
  if (resolved === null) {
    const override = ((import.meta.env.VITE_ADSENSE_CLIENT as string | undefined) || '').trim();
    resolved = import.meta.env.PROD ? resolveId(override, DEFAULT_ADSENSE_CLIENT, isAdsClient) : (isAdsClient(override) ? override : '');
  }
  return resolved;
}

const NO_AD_TIMEOUT = 3000;   // backstop only: with the readiness gate below this rarely fires

let loading: Promise<void> | null = null;
let blocked = false;   // the script never arrived, or arrived without taking over adsbygoogle
let cleared = false;   // the Placement API answered onReady — it is actually cleared to serve

function load(): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve) => {
    // The Placement API is queued through adsbygoogle, so adConfig/adBreak work before the script
    // itself has arrived. This shim is the pattern Google documents.
    const w = window as any;
    w.adsbygoogle = w.adsbygoogle || [];
    // NB: adsbygoogle.js never replaces adBreak/adConfig — these stay ours for good. What it does
    // replace is `window.adsbygoogle`: the plain array becomes an object with `loaded: true`, which
    // is the only reliable "the real script is running" signal. See the check in show().
    if (!w.adBreak) w.adBreak = w.adConfig = (o: any) => w.adsbygoogle.push(o);
    // Production builds ship the loader in the HTML shell (vite.config.ts / mekina-google-tags),
    // because Google's crawlers only read raw HTML. Reuse it rather than loading a second copy.
    const existing = document.querySelector('script[src*="adsbygoogle.js"]') as HTMLScriptElement | null;
    if (existing) {
      if (w.adsbygoogle && w.adsbygoogle.loaded) resolve();          // already finished
      else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => { blocked = true; resolve(); }, { once: true });
        setTimeout(resolve, 4000);  // it may have loaded before we could listen
      }
    } else {
      const s = document.createElement('script');
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.dataset.adClient = client();
      s.dataset.adFrequencyHint = '60s';
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client())}`;
      s.onload = () => resolve();
      // An ad blocker usually errors the request outright. Recording it means blocked players never
      // wait out the timeout below — the break resolves instantly, every time.
      s.onerror = () => { blocked = true; resolve(); };
      document.head.appendChild(s);
    }
    // onReady is the only honest "this account can serve H5 game ads" signal. Until AdSense has
    // approved the site and enabled H5 Games Ads, the script loads and is completely inert: adBreak
    // fires no callbacks at all, not even adBreakDone. Verified against the live publisher id.
    try { w.adConfig({ preloadAdBreaks: 'on', sound: 'off', onReady: () => { cleared = true; } }); } catch { /* ignore */ }
  });
  return loading;
}

export const h5: AdProvider = {
  name: 'h5',

  // isNative() is the load-bearing half. The id check alone would happily run AdSense inside the
  // app, since the publisher id is the same one either way.
  configured: () => isAdsClient(client()) && !isNative(),

  init() { if (h5.configured()) load(); },

  ready: () => cleared && !blocked,

  show(type: BreakType) {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let ran = false;
      const done = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(ran); };
      // Only wait open-endedly once an ad is actually on screen; otherwise a blocked script would
      // hang the button forever. The open-ended half is bounded by index.ts's hard ceiling.
      let timer: any = setTimeout(done, NO_AD_TIMEOUT);
      // An ad is on screen: drop the short escape hatch.
      const holdTimer = () => { clearTimeout(timer); timer = null; };

      load().then(() => {
        // Some blockers serve an empty 200 instead of failing, so onload is not proof of anything.
        // adsbygoogle.loaded is: only the real script sets it. Either way there is nothing to show,
        // so don't make the player wait out the timeout.
        const ab = (window as any).adsbygoogle;
        if (blocked || !(ab && ab.loaded)) { blocked = true; return done(); }
        // Loaded but inert (not approved yet, or no H5 entitlement): never make a player wait for
        // an ad that is never coming. This is the state until the AdSense review clears.
        if (!cleared) return done();
        try {
          (window as any).adBreak({
            type,
            name: type === 'start' ? 'game-start' : 'between-games',
            beforeAd: holdTimer,          // an ad is showing: stop the escape hatch
            // Called whether or not an ad showed. Reporting it as a real break either way keeps us
            // from re-asking on every end screen when there is simply no fill.
            adBreakDone: () => { ran = true; done(); },
          });
        } catch { done(); }
      }).catch(done);
    });
  },
};
