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

import { CONSENT_REGIONS, DEFAULT_GA_ID, isGaId, resolveId } from './google';

// Production always measures; dev/preview send NOTHING unless VITE_GA_ID is set, so local play
// never pollutes the stats. A malformed override is ignored, not obeyed — see resolveId.
const override = (import.meta.env.VITE_GA_ID as string | undefined) || '';
const GA_ID = import.meta.env.PROD ? resolveId(override, DEFAULT_GA_ID, isGaId) : (isGaId(override.trim()) ? override.trim() : '');
export const analyticsConfigured = isGaId(GA_ID);

type Params = Record<string, string | number | boolean | undefined>;

/**
 * gtag.js only processes commands pushed to dataLayer as the `arguments` object — exactly what
 * Google's own snippet does. Pushing a real array (the obvious `(...args) => dl.push(args)`) is
 * silently ignored: the tag loads, `google_tag_data` appears, and NOTHING is ever measured — no
 * cookie, no hit. Hence the paramless function expression; `arguments` is the whole point.
 * dataLayer is created lazily so that with no measurement id this file never touches `window`.
 */
const gtag: (...args: any[]) => void = function () {
  const w = window as any;
  (w.dataLayer = w.dataLayer || []).push(arguments);
};

let started = false;

// Consent defaults are granted globally and denied in CONSENT_REGIONS until a CMP says otherwise.
// Google's certified CMP (AdSense → Privacy & messaging) updates them by itself once it is on the
// page; `setConsent` below is the hook if a hand-rolled banner is ever preferred.

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
  // Production HTML already carries the whole bootstrap (vite.config.ts → GA_BOOTSTRAP), because
  // gtag.js only configures itself from what is in dataLayer when it loads, and Google's crawlers
  // only read raw HTML. Nothing left to do but send. Dev, or any shell without it, sets up here.
  if ((window as any).__mekinaGA === GA_ID) return;
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
  // (No anonymize_ip: that is a Universal Analytics flag. GA4 always truncates IPs.)
  gtag('config', GA_ID, { send_page_view: false });

  // Production builds already carry the loader in the HTML shell (see the mekina-google-tags plugin
  // in vite.config.ts — Google's crawlers only read raw HTML). Inject it only when it is absent, so
  // a dev run with VITE_GA_ID set still works and we never load gtag.js twice.
  if (!document.querySelector('script[src*="googletagmanager.com/gtag/js"]')) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
    document.head.appendChild(s);
  }
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
