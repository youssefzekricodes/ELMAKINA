/* One source of truth for the Google integration.
   Imported by lib/analytics.ts, lib/ads.ts AND vite.config.ts (which bakes the same values into the
   HTML shell), so the runtime and the shell can never disagree. Plain data + pure functions, no
   browser or Vite APIs: the build loads this in Node.

   Two other copies of these ids exist and must be changed by hand if they ever rotate:
   public/ads.txt, and the google-adsense-account meta tag in client/index.html. */

/** Both ids are public by design: they ship in the bundle and Google hands them to you to paste
    into public HTML. Keeping them here rather than in a host env var removes a deployment step
    that fails silently when forgotten. */
export const DEFAULT_GA_ID = 'G-GG2JZYRN9T';
export const DEFAULT_ADSENSE_CLIENT = 'ca-pub-4626982618627963';

export const isGaId = (v: string) => /^G-[A-Z0-9]{6,}$/i.test(v);
export const isAdsClient = (v: string) => /^ca-pub-\d{10,}$/.test(v);

/**
 * Resolve an id from an optional override.
 *
 * A MALFORMED override is ignored rather than obeyed. This is not defensive padding: a stray
 * `VITE_GA_ID=BFCD6JJEB3` (a verification code pasted into the wrong variable) beat the correct
 * default and silently switched every page_view and event off, while the HTML shell kept
 * measuring — so the property looked half-alive and nothing said why.
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
