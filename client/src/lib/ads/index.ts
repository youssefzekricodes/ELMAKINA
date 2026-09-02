/* Between-games interstitials — the placement policy, one copy, every platform.
 *
 * WHERE ads appear is the part that decides whether the app survives review. Both stores reject on
 * placement, not on network: an ad during play, on launch, or glued over a button is what gets you
 * pulled. So the rules live here, above the provider, and a new network cannot quietly relax them.
 *
 * Placements are the two moments with no server clock running: before a solo game, and on the
 * end-of-game screen. Never during play — `start_game` starts the 60s first-turn timer server-side,
 * so an ad in the online lobby→game handshake would silently eat the first player's turn.
 *
 * THE CONTRACT: `adBreak()` always resolves. No publisher id, blocked by an ad blocker, no fill,
 * script error, a provider that hangs — the promise still settles and the game continues. Gameplay
 * never waits on an ad.
 *
 * The network behind it is chosen by the runtime: H5 Games Ads in a browser, AdMob in a native
 * shell. See lib/platform.ts for why that split is not optional.
 */

import { admob } from './admob';
import { h5 } from './h5';
import type { AdProvider, BreakType } from './provider';

export type { BreakType };

// Our own policy on top of whatever frequency capping the network does.
const FIRST_GAMES_FREE = 2;      // never interrupt someone's first couple of games
const MIN_GAP_MS = 3 * 60_000;   // and at most one ad every few minutes
const MAX_AD_MS = 60_000;        // hard ceiling once a break is running, whatever the provider does

const KEY_GAMES = 'mekina.games';
const KEY_LAST = 'mekina.lastAd';
const num = (k: string) => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
const put = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } };

// Which network, decided by the BUILD. Vite replaces `import.meta.env.VITE_PLATFORM` with a string
// literal, so this comparison folds to a constant and the bundler drops the branch it did not take
// — a native bundle ends up with no AdSense loader in it at all, not even as unreachable code.
//
// The runtime half of the guard has not gone anywhere: h5.configured() calls isNative() itself, so
// a web bundle that somehow boots inside the app still refuses to load AdSense. The safety net is
// in the provider, which is where it belongs; the picker only has to be right about the build.
let picked: AdProvider | null = null;
const provider = (): AdProvider => (picked ||= import.meta.env.VITE_PLATFORM === 'native' ? admob : h5);

/** Count a finished/started game — drives the "first games are ad-free" rule. */
export function countGame() { put(KEY_GAMES, num(KEY_GAMES) + 1); }

/** Is the ad system on at all? False means no network is ever contacted. */
export function adsEnabled(): boolean { return provider().configured(); }

/** Start fetching/preloading early so the first break is not the thing that loads it. */
export function initAds() { if (adsEnabled()) provider().init(); }

/** Whether the next `adBreak()` would actually show something. Callers use this to keep work that
 *  needs the click's user activation (fullscreen!) synchronous when no ad is coming. */
export function adDue(): boolean { return due() && provider().ready(); }

function due(): boolean {
  if (!adsEnabled()) return false;
  if (num(KEY_GAMES) < FIRST_GAMES_FREE) return false;
  return Date.now() - num(KEY_LAST) >= MIN_GAP_MS;
}

/**
 * Show an interstitial if one is due and available, then resolve.
 *
 * The cooldown is stamped only when a break actually RAN. A provider that could not show anything
 * must not burn the gap, or a publisher with no fill would ask once and then stay silent for the
 * rest of the session.
 */
export function adBreak(type: BreakType): Promise<void> {
  if (!due()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    let ceiling: any = null;
    const done = () => { if (settled) return; settled = true; clearTimeout(ceiling); resolve(); };
    // The contract's last line of defence. Providers settle their own promises; this exists so that
    // a network SDK which never calls back cannot leave a player staring at a dead button.
    ceiling = setTimeout(done, MAX_AD_MS);
    provider().show(type).then((ran) => { if (ran) put(KEY_LAST, Date.now()); done(); }, done);
  });
}
