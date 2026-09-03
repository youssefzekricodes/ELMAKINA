/* Google AdMob — the APP provider.
 *
 * The ad does not render inside our HTML. This calls the plugin, the plugin calls Google's native
 * Mobile Ads SDK, and the OS draws the ad as a native view ON TOP of the WebView. That is why the
 * app can carry ads at all: Google sees a genuine native integration, identical to what a fully
 * native game does, and no AdSense code goes anywhere near the store build.
 *
 * Only ever selected in a native build — ads/index.ts folds that choice at compile time, so this
 * module is dropped from the web bundle entirely along with the plugin it imports.
 *
 * NOT CONFIGURED HERE, because it is native config rather than JavaScript: the AdMob APPLICATION
 * id (ADMOB_APP_ID in lib/google.ts) must be in AndroidManifest.xml and Info.plist, or the SDK
 * refuses to initialise and every request fails.
 */

import { TEST_INTERSTITIAL, isAdUnit } from '../google';
import { isNative, platformName } from '../platform';
import type { AdProvider, BreakType } from './provider';

const ENV: Record<string, string> = {
  android: (import.meta.env.VITE_ADMOB_INTERSTITIAL_ANDROID as string | undefined) || '',
  ios: (import.meta.env.VITE_ADMOB_INTERSTITIAL_IOS as string | undefined) || '',
};
const ENV_REWARDED: Record<string, string> = {
  android: (import.meta.env.VITE_ADMOB_REWARDED_ANDROID as string | undefined) || '',
  ios: (import.meta.env.VITE_ADMOB_REWARDED_IOS as string | undefined) || '',
};
/** Google's public rewarded test units — same rules as TEST_INTERSTITIAL in lib/google.ts. */
const TEST_REWARDED: Record<'android' | 'ios', string> = {
  android: 'ca-app-pub-3940256099942544/5224354917',
  ios: 'ca-app-pub-3940256099942544/1712485313',
};

/**
 * Which unit to ask for, or '' when ads are simply off.
 *
 * No unit configured returns '' and the whole ad system stays dark — that is the "works before the
 * ad units exist" path, and it is the default.
 *
 * Setting the env var to the literal `test` selects Google's public test unit instead. That is
 * deliberately an EXPLICIT opt-in rather than "whenever this is a debug build": the first version
 * of this keyed off import.meta.env.PROD, and since every native build goes through `vite build`
 * that flag is always true — the test units folded out of the bundle and no APK could ever show an
 * ad. Tying an ad decision to the bundler's mode was the mistake; a value you have to type is
 * something you cannot get by accident in either direction.
 *
 * Always use `test` while developing. Requesting live ads from a build you are clicking through
 * yourself is invalid traffic, and AdMob suspends accounts for it.
 */
function unit(): string {
  const p = platformName();
  if (p === 'web') return '';
  const live = (ENV[p] || '').trim();
  if (isAdUnit(live)) return live;
  if (live.toLowerCase() === 'test') return TEST_INTERSTITIAL[p];
  return '';
}

/** Same resolution for the rewarded unit; 'test' on the interstitial var covers this one too, so a
 *  dev build does not need two switches to exercise both formats. */
function rewardedUnit(): string {
  const p = platformName();
  if (p === 'web') return '';
  const live = (ENV_REWARDED[p] || '').trim();
  if (isAdUnit(live)) return live;
  if (live.toLowerCase() === 'test' || (ENV[p] || '').trim().toLowerCase() === 'test') return TEST_REWARDED[p];
  return '';
}

/**
 * The plugin, loaded on demand.
 *
 * It MUST stay a dynamic import. @capacitor-community/admob calls registerPlugin() at module scope,
 * which is a side effect the bundler cannot prove away — a static import therefore survives
 * tree-shaking even in a web build that never selects this provider, and it measured at +13 KB raw
 * / +4 KB gzipped on the vendor chunk every player downloads. Exactly the Sentry problem documented
 * in vite.config.ts, and it needs the same second half: @capacitor is excluded from manualChunks,
 * or naming it there would fold this straight back into the eager vendor chunk.
 *
 * Nothing synchronous needs it. configured() and ready() answer from the platform and a local flag,
 * so the caller's user-activation path never waits on this.
 */
let sdk: Promise<typeof import('@capacitor-community/admob')> | null = null;
const plugin = () => (sdk ||= import('@capacitor-community/admob'));

/** Set to a device id to make the REAL ad units serve test creatives on that device only. */
const TEST_DEVICE = ((import.meta.env.VITE_ADMOB_TEST_DEVICE as string | undefined) || '').trim();

let loaded = false;    // an interstitial is prepared and can be shown right now
let starting = false;  // the init handshake has run once
let npa = false;       // request NON-personalised ads (see consent below)

/** Preload the next interstitial. AdMob has no "show one now" — an ad must be prepared first,
 *  which is also what keeps the break instant instead of a spinner over the game. */
async function preload(): Promise<void> {
  const adId = unit();
  if (!adId) return;
  try {
    const { AdMob } = await plugin();
    await AdMob.prepareInterstitial({
      adId,
      npa,
      // The game runs edge-to-edge with the system bars hidden; without this the interstitial
      // brings them back for its duration and the screen visibly jumps twice per ad.
      immersiveMode: true,
    });
    loaded = true;
  } catch {
    loaded = false;      // no fill, no network, bad unit id — all the same to the player
  }
}

/**
 * Consent, via Google's User Messaging Platform.
 *
 * Required before serving in the EEA/UK: Google mandates a certified CMP and UMP is theirs. The web
 * side does the same job through Consent Mode v2 in lib/analytics.ts.
 *
 * Returns whether to request ads at all. Note the middle ground — when consent cannot be
 * ESTABLISHED (the form fails to load, or is required but unavailable) this does not give up and it
 * does not barge ahead either: it sets `npa`, so the request goes out for non-personalised ads,
 * which needs no consent. Failing closed would cost every region's revenue over one region's
 * hiccup; failing open would serve personalised ads to someone who never agreed.
 */
async function consent(): Promise<boolean> {
  try {
    const { AdMob, AdmobConsentStatus } = await plugin();
    const info = await AdMob.requestConsentInfo();
    if (info.status === AdmobConsentStatus.REQUIRED) {
      if (info.isConsentFormAvailable) {
        const after = await AdMob.showConsentForm();
        npa = !after.canRequestAds;
        return true;
      }
      npa = true;            // required, but there is no form to show
      return true;
    }
    // canRequestAds is the SDK's own verdict and outranks the status string.
    if (!info.canRequestAds) { npa = true; }
    return true;
  } catch {
    npa = true;
    return true;
  }
}

async function start(): Promise<void> {
  try {
    // iOS App Tracking Transparency is deliberately NOT requested here. AdMob.requestTrackingAuthorization()
    // exists and would raise personalised-ad revenue, but calling it without NSUserTrackingUsageDescription
    // in Info.plist crashes the app on launch — and there is no iOS project yet to put that key in.
    // Wire it when the iOS platform is added, before the first TestFlight build, not after.

    // Registering THIS device as a test device — a different thing from the test ad units above,
    // solving a different problem.
    //
    // Test units prove the code path works. They cannot prove YOUR ad unit works, because they are
    // Google's units, not yours: a wrong unit id, one that has not activated yet, or an app id that
    // does not match all look identical to success. A registered test device closes that gap — the
    // REAL unit is requested, so the whole configuration is exercised end to end, but Google returns
    // a test creative. Clicks cost nothing and count as nothing, which is the point, because
    // clicking your own live ads is invalid traffic and AdMob suspends accounts for it.
    //
    // The id is printed by the SDK on first run; see VITE_ADMOB_TEST_DEVICE in .env.example.
    const { AdMob } = await plugin();
    await AdMob.initialize(TEST_DEVICE
      ? { initializeForTesting: true, testingDevices: [TEST_DEVICE] }
      : { initializeForTesting: false });
    if (await consent()) await preload();
  } catch { /* leave loaded false; every break then resolves instantly */ }
}

export const admob: AdProvider = {
  name: 'admob',

  configured: () => isNative() && isAdUnit(unit()),

  init() {
    if (starting || !admob.configured()) return;
    starting = true;
    void start();
  },

  ready: () => loaded,

  /**
   * One rewarded video, prepared on demand rather than preloaded: rewarded moments are rare (a
   * streak at risk, an end screen) and holding a loaded video for minutes wastes the fill.
   * 'earned' is taken from the SDK's Rewarded event, not from showRewardVideoAd resolving —
   * resolving only means the video opened; the event fires when the watch actually completed.
   */
  async showRewarded() {
    const adId = rewardedUnit();
    if (!adId) return 'unavailable' as const;
    try {
      const { AdMob, RewardAdPluginEvents } = await plugin();
      let earned = false;
      const sub = await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => { earned = true; });
      try {
        await AdMob.prepareRewardVideoAd({ adId, npa });
        await new Promise<void>((resolve) => {
          let over = false;
          const finish = () => { if (!over) { over = true; resolve(); } };
          AdMob.addListener(RewardAdPluginEvents.Dismissed, finish).then((d: any) => setTimeout(() => d.remove(), 90_000));
          AdMob.showRewardVideoAd().catch(finish);
          setTimeout(finish, 90_000);   // a video is ~30s; a minute and a half means something hung
        });
      } finally {
        sub.remove();
      }
      return earned ? ('earned' as const) : ('dismissed' as const);
    } catch {
      return 'unavailable' as const;
    }
  },

  async show(_type: BreakType) {
    // AdMob has no break-type vocabulary — an interstitial is an interstitial. The distinction
    // still matters upstream, where it names the placement, so the parameter stays in the shape.
    if (!loaded) return false;
    loaded = false;                       // consumed either way; never show the same object twice
    try {
      const { AdMob, InterstitialAdPluginEvents } = await plugin();
      // showInterstitial() resolves when the ad OPENS, not when it closes. Treating that as "done"
      // let the caller start the game — and its 60s first-turn clock — while the ad still covered
      // the screen; the player came back to a hand already in progress. The break is over only on
      // the Dismissed event (or FailedToShow, which means there was nothing to wait out).
      await new Promise<void>((resolve) => {
        let over = false;
        const finish = () => { if (!over) { over = true; resolve(); } };
        AdMob.addListener(InterstitialAdPluginEvents.Dismissed, finish).then((h: any) => setTimeout(() => h.remove(), 90_000));
        AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, finish).then((h: any) => setTimeout(() => h.remove(), 90_000));
        AdMob.showInterstitial().catch(finish);
        setTimeout(finish, 90_000);       // an interstitial is seconds; a minute and a half means something hung
      });
      void preload();                     // get the next one ready while they are back in the game
      return true;
    } catch {
      void preload();
      return false;
    }
  },
};
