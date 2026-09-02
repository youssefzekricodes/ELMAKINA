/* One source of truth for the Google integration.
   Imported by lib/analytics.ts, lib/ads.ts AND vite.config.ts (which bakes the same values into the
   HTML shell), so the runtime and the shell can never disagree. Plain data + pure functions, no
   browser or Vite APIs: the build loads this in Node.

   Two other copies of these ids exist and must be changed by hand if they ever rotate:
   public/ads.txt, and the google-adsense-account meta tag in client/index.html. */

/** Both ids are public by design: they ship in the bundle and Google hands them to you to paste
    into public HTML. Keeping them here rather than in a host env var removes a deployment step
    that fails silently when forgotten. */
export const DEFAULT_GA_ID = 'G-BFCD6JJEB3'; // GA4 stream for https://elmekina.com (stream id 15523183832)
export const DEFAULT_ADSENSE_CLIENT = 'ca-pub-4626982618627963';

export const isGaId = (v: string) => /^G-[A-Z0-9]{6,}$/i.test(v);
export const isAdsClient = (v: string) => /^ca-pub-\d{10,}$/.test(v);

/**
 * Resolve an id from an optional override.
 *
 * A MALFORMED override is ignored rather than obeyed. This is not defensive padding: a real
 * `VITE_GA_ID=BFCD6JJEB3` — the measurement id with its `G-` prefix dropped — beat the default,
 * failed validation and silently switched every page_view and event off, while the HTML shell kept
 * measuring. The property looked half-alive and nothing said why.
 */
export function resolveId(override: string | undefined, fallback: string, valid: (v: string) => boolean): string {
  const v = (override || '').trim();
  if (valid(v)) return v;
  if (v && typeof console !== 'undefined') console.warn(`[google] ignoring malformed id ${JSON.stringify(v)}; using ${fallback}`);
  return fallback;
}

/** Where consent is legally required before anything may be stored; granted everywhere else. */
export const CONSENT_REGIONS = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV',
  'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', // EU
  'IS', 'LI', 'NO', 'GB', 'CH',                                      // EEA + UK + Switzerland
];

/* ── AdMob (app builds only) ───────────────────────────────────────────────────
   AdSense's counterpart for applications. Different id shape, different account, and the two must
   never be mixed: AdSense code inside an app breaks its terms, and AdMob has no meaning in a
   browser. See lib/platform.ts. */

/** Ad unit: ca-app-pub-<16 digits>/<10 digits>. Note the SLASH — the tilde form
 *  (ca-app-pub-…~…) is the *application* id that belongs in the native manifest, not here. Pasting
 *  the app id where a unit id goes is the single most common AdMob setup mistake: it validates by
 *  eye, and then simply never fills. */
export const isAdUnit = (v: string) => /^ca-app-pub-\d{10,}\/\d{6,}$/.test(v);

/** Google's own public test units. They always fill, on any account, and they are the ONLY safe
 *  way to exercise the ad path during development: requesting live ads from a build you are
 *  clicking through yourself is invalid traffic, and AdMob suspends accounts for it. */
export const TEST_INTERSTITIAL = {
  android: 'ca-app-pub-3940256099942544/1033173712',
  ios: 'ca-app-pub-3940256099942544/4411468910',
};

/**
 * AdMob APPLICATION ids — one per store. Note the shared 16 digits with the AdSense publisher id
 * above: AdMob reused the same account, so both products pay out through one AdSense profile.
 *
 * Public by design, like every other id in this file — they ship inside the app binary.
 *
 * These are NOT ad units and lib/ads/admob.ts never reads them. They belong in native config,
 * AndroidManifest.xml and Info.plist, which the Capacitor shell generates. Without them the Mobile
 * Ads SDK refuses to initialise and every request fails. Recorded here so the native files have one
 * place to be checked against, in the same spirit as the ads.txt / meta tag note at the top.
 */
export const ADMOB_APP_ID = {
  android: 'ca-app-pub-4626982618627963~6035406752',
  ios: 'ca-app-pub-4626982618627963~5542301362',
};

/** The TILDE form: an application id, not a unit id. Exists so the scaffold can refuse to paste an
 *  app id where isAdUnit() is wanted, and vice versa — they differ by one character. */
export const isAdAppId = (v: string) => /^ca-app-pub-\d{10,}~\d{6,}$/.test(v);
