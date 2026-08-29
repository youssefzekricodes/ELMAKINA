/* Between-games interstitials, via Google's H5 Games Ads (the Ad Placement API).
 *
 * Why this and not a display unit inside our own modal: the Placement API is Google's product for
 * exactly this moment. It preloads, renders its own compliant countdown and dismiss control, and
 * enforces its own frequency caps. Wrapping a plain display unit in a home-made modal is the
 * classic way to earn an AdSense policy strike.
 *
 * THE CONTRACT: `adBreak()` always resolves. No publisher id, blocked by an ad blocker, no fill,
 * script error — the promise still settles and the game continues. Gameplay never waits on an ad.
 *
 * Placements are the two moments with no server clock running: before a solo game, and on the
 * end-of-game screen. Never during play — `start_game` starts the 60s first-turn timer server-side,
 * so an ad in the online lobby→game handshake would silently eat the first player's turn.
 */

import { DEFAULT_ADSENSE_CLIENT, isAdsClient, resolveId } from './google';

// Production always has a publisher id; dev builds stay ad-free unless VITE_ADSENSE_CLIENT is set,
// so local play never touches Google. A malformed override is ignored, not obeyed.
const override = (import.meta.env.VITE_ADSENSE_CLIENT as string | undefined) || '';
const CLIENT = import.meta.env.PROD ? resolveId(override, DEFAULT_ADSENSE_CLIENT, isAdsClient) : (isAdsClient(override.trim()) ? override.trim() : '');
export const adsConfigured = isAdsClient(CLIENT);

// Our own policy on top of Google's frequency capping.
const FIRST_GAMES_FREE = 2;      // never interrupt someone's first couple of games
const MIN_GAP_MS = 3 * 60_000;   // and at most one ad every few minutes
const NO_AD_TIMEOUT = 3000;      // backstop only: with the readiness gate below this rarely fires
const MAX_AD_MS = 60_000;        // hard ceiling once an ad IS showing, in case adBreakDone never fires

const KEY_GAMES = 'mekina.games';
const KEY_LAST = 'mekina.lastAd';
const num = (k: string) => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
const put = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } };

/** Count a finished/started game — drives the "first games are ad-free" rule. */
export function countGame() { put(KEY_GAMES, num(KEY_GAMES) + 1); }

let loading: Promise<void> | null = null;
let blocked = false;   // the script never arrived, or arrived without taking over adsbygoogle
let ready = false;     // the Placement API answered onReady — it is actually cleared to serve
function load(): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve) => {
    // The Placement API is queued through adsbygoogle, so adConfig/adBreak work before the script
    // itself has arrived. This shim is the pattern Google documents.
    const w = window as any;
    w.adsbygoogle = w.adsbygoogle || [];
    // NB: adsbygoogle.js never replaces adBreak/adConfig — these stay ours for good. What it does
    // replace is `window.adsbygoogle`: the plain array becomes an object with `loaded: true`, which
    // is the only reliable "the real script is running" signal. See the check in adBreak().
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
      s.dataset.adClient = CLIENT;
      s.dataset.adFrequencyHint = '60s';
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CLIENT)}`;
      s.onload = () => resolve();
      // An ad blocker usually errors the request outright. Recording it means blocked players never
      // wait out the timeout below — the break resolves instantly, every time.
      s.onerror = () => { blocked = true; resolve(); };
      document.head.appendChild(s);
    }
    // onReady is the only honest "this account can serve H5 game ads" signal. Until AdSense has
    // approved the site and enabled H5 Games Ads, the script loads and is completely inert: adBreak
    // fires no callbacks at all, not even adBreakDone. Verified against the live publisher id.
    try { w.adConfig({ preloadAdBreaks: 'on', sound: 'off', onReady: () => { ready = true; } }); } catch { /* ignore */ }
  });
  return loading;
}

/** Start fetching the ad script early so the first break is not the thing that loads it. */
export function initAds() { if (adsConfigured) load(); }

/** Whether the next `adBreak()` would actually try to show something. Callers use this to keep
 *  work that needs the click's user activation (fullscreen!) synchronous when no ad is coming. */
export function adDue(): boolean { return ready && !blocked && due(); }

function due(): boolean {
  if (!adsConfigured) return false;
  if (num(KEY_GAMES) < FIRST_GAMES_FREE) return false;
  return Date.now() - num(KEY_LAST) >= MIN_GAP_MS;
}

/**
 * Show an interstitial if one is due and available, then resolve.
 * `type` is the Placement API's break type: 'start' before a game, 'next' between games.
 */
export function adBreak(type: 'start' | 'next'): Promise<void> {
  if (!due()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; resolve(); };
    // Only wait open-endedly once an ad is actually on screen; otherwise a blocked script would
    // hang the button forever.
    let timer: any = setTimeout(done, NO_AD_TIMEOUT);
    // An ad is on screen: drop the short escape hatch, but keep a hard ceiling so a broken creative
    // can never leave the player staring at a dead button.
    const holdTimer = () => { clearTimeout(timer); timer = setTimeout(done, MAX_AD_MS); };

    load().then(() => {
      // Some blockers serve an empty 200 instead of failing, so onload is not proof of anything.
      // adsbygoogle.loaded is: only the real script sets it. Either way there is nothing to show,
      // so don't make the player wait out the timeout.
      const ab = (window as any).adsbygoogle;
      if (blocked || !(ab && ab.loaded)) { blocked = true; return done(); }
      // Loaded but inert (not approved yet, or no H5 entitlement): never make a player wait for an
      // ad that is never coming. This is the state until the AdSense review clears.
      if (!ready) return done();
      try {
        (window as any).adBreak({
          type,
          name: type === 'start' ? 'game-start' : 'between-games',
          beforeAd: holdTimer,          // an ad is showing: stop the escape hatch
          // Called whether or not an ad showed. Stamping either way keeps us from re-asking on
          // every end screen when there is simply no fill.
          adBreakDone: () => { clearTimeout(timer); put(KEY_LAST, Date.now()); done(); },
        });
      } catch { done(); }
    }).catch(done);
  });
}
