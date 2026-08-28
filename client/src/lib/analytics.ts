/* Google Analytics 4 — how many people play and where from.
 *
 * Two rules this file exists to enforce:
 *   1. Without VITE_GA_ID every function here is a no-op and NOTHING is requested from Google.
 *      That is the state every local dev and preview build runs in.
 *   2. No personal data ever leaves the app. Names, room codes and above all the signed-in
 *      account's email address are never passed to `track()` — only counts and enum-ish values.
 *
 * Country and user counts need no code beyond the page_view below: GA4 derives them from the
 * request IP. They show up under Reports → User attributes → Demographic details, and live under
 * Reports → Realtime.
 */

const GA_ID = ((import.meta.env.VITE_GA_ID as string | undefined) || '').trim();
// Guard against a placeholder being left in .env — a real id looks like G-XXXXXXXXXX.
export const analyticsConfigured = /^G-[A-Z0-9]{6,}$/i.test(GA_ID);

type Params = Record<string, string | number | boolean | undefined>;

// Created lazily: with no measurement id this file must not touch `window` at all.
function gtag(...args: any[]) {
  const w = window as any;
  (w.dataLayer = w.dataLayer || []).push(args);
}

let started = false;

// Where consent is required before anything may be stored. Everywhere else the global default
// applies. Google's certified CMP (AdSense → Privacy & messaging) updates these by itself once it
// is on the page; `setConsent` below is the hook if a hand-rolled banner is ever preferred.
const CONSENT_REGIONS = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV',
  'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', // EU
  'IS', 'LI', 'NO', 'GB', 'CH',                                      // EEA + UK + Switzerland
];

/**
 * Queue the consent defaults and load the tag. Commands pushed before the script arrives are
 * replayed by it, so ordering here is what matters, not timing.
 *
 * Consent Mode v2: granted by default, then DENIED for the EEA/UK/CH until their CMP says
 * otherwise. Under denial GA still counts visits and countries — cookielessly — it just cannot
 * recognise a returning player.
 */
export function initAnalytics() {
  if (started || !analyticsConfigured) return;
  started = true;
  gtag('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    region: CONSENT_REGIONS,
    wait_for_update: 500,
  });
  gtag('js', new Date());
  // send_page_view: false — this is one HTML page with screens in a store, so the automatic
  // page_view would fire exactly once. sendPageView() below reports the screens instead.
  gtag('config', GA_ID, { send_page_view: false, anonymize_ip: true });

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
}

/** Called by the consent banner once the visitor has chosen. */
export function setConsent(granted: boolean) {
  if (!analyticsConfigured) return;
  const v = granted ? 'granted' : 'denied';
  gtag('consent', 'update', { ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v });
}

/** One "page" per screen: /home, /lobby, /game, /leaderboard, /friends. */
export function sendPageView(path: string) {
  if (!analyticsConfigured) return;
  gtag('event', 'page_view', { page_path: path, page_title: `ELMEKINA ${path}`, page_location: location.origin + path });
}

/** A named event. Keep params to counts and fixed vocabularies — never names, codes or emails. */
export function track(name: string, params: Params = {}) {
  if (!analyticsConfigured) return;
  gtag('event', name, params);
}
