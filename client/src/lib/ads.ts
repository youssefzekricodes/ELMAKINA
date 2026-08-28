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

const CLIENT = ((import.meta.env.VITE_ADSENSE_CLIENT as string | undefined) || '').trim();
export const adsConfigured = /^ca-pub-\d{10,}$/.test(CLIENT);

// Our own policy on top of Google's frequency capping.
const FIRST_GAMES_FREE = 2;      // never interrupt someone's first couple of games
const MIN_GAP_MS = 3 * 60_000;   // and at most one ad every few minutes
const NO_AD_TIMEOUT = 6000;      // if nothing has happened by now, the script is blocked or dead
const MAX_AD_MS = 60_000;        // hard ceiling once an ad IS showing, in case adBreakDone never fires

const KEY_GAMES = 'mekina.games';
const KEY_LAST = 'mekina.lastAd';
const num = (k: string) => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
const put = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } };

/** Count a finished/started game — drives the "first games are ad-free" rule. */
export function countGame() { put(KEY_GAMES, num(KEY_GAMES) + 1); }

let loading: Promise<void> | null = null;
let blocked = false;   // the script never arrived, or arrived without installing the real API
let shim: any = null;  // our placeholder; if it is still in place, the real adBreak never loaded
function load(): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve) => {
    // The Placement API is queued through adsbygoogle, so adConfig/adBreak work before the script
    // itself has arrived. This shim is the pattern Google documents.
    const w = window as any;
    w.adsbygoogle = w.adsbygoogle || [];
    if (!w.adBreak) { shim = (o: any) => w.adsbygoogle.push(o); w.adBreak = w.adConfig = shim; }
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
    try { w.adConfig({ preloadAdBreaks: 'on', sound: 'off' }); } catch { /* ignore */ }
  });
  return loading;
}

/** Start fetching the ad script early so the first break is not the thing that loads it. */
export function initAds() { if (adsConfigured) load(); }

/** Whether the next `adBreak()` would actually try to show something. Callers use this to keep
 *  work that needs the click's user activation (fullscreen!) synchronous when no ad is coming. */
export function adDue(): boolean { return due(); }

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
      // Some blockers serve an empty 200 instead of failing: the script "loads" but never replaces
      // our shim. Either way there is nothing to show, so don't make the player wait.
      if (blocked || (window as any).adBreak === shim) { blocked = true; return done(); }
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
