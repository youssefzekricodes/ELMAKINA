import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { CONSENT_REGIONS, DEFAULT_ADSENSE_CLIENT, DEFAULT_GA_ID, isAdsClient, isGaId, resolveId } from './src/lib/google';


const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * One id per build, baked into the bundle AND written to dist/version.json.
 *
 * The running app compares the two: same id means it is current, a different id means a newer
 * build is live and this tab is stale (see lib/update.ts). The commit sha is used when git is
 * available so two builds of identical source share an id; otherwise the clock decides.
 */
const buildId = (() => {
  try { return execSync('git rev-parse --short HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return String(Date.now()); }
})();

// Google's verification crawlers (AdSense site review, GA's "tag detected" check) read the raw
// HTML — they do not boot the React app. Tags injected at runtime from lib/analytics.ts and
// lib/ads.ts are therefore invisible to them, and both products report "not detected" even when
// the tags load perfectly in a real browser. So the loaders are emitted into index.html at build
// time. PRODUCTION ONLY: `npm run dev` keeps a clean HTML shell and contacts Google not at all.
// These ids are duplicated in lib/analytics.ts, lib/ads.ts, public/ads.txt and the meta tag in
// index.html — change one, change all.
// The loader ALONE is not enough: gtag.js configures itself from whatever is already in dataLayer
// when it initialises. With the config arriving later (on React mount) it comes up as an empty GTM
// container and never sends a hit — verified. Hence the inline bootstrap, exactly like Google's
// snippet, with our two additions: consent defaults, and send_page_view:false because the app
// reports one page_view per screen itself (see lib/analytics.ts sendPageView).
const googleTags = (gaId: string, adsClient: string): any[] => [
  { tag: 'script', injectTo: 'head', attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${gaId}` } },
  {
    tag: 'script',
    injectTo: 'head',
    children: [
      'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}',
      `window.__mekinaGA=${JSON.stringify(gaId)};`,
      "gtag('consent','default',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted'});",
      `gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',region:${JSON.stringify(CONSENT_REGIONS)},wait_for_update:500});`,
      "gtag('js',new Date());",
      `gtag('config',${JSON.stringify(gaId)},{send_page_view:false});`,
    ].join(''),
  },
  { tag: 'script', injectTo: 'head', attrs: { async: true, crossorigin: 'anonymous', 'data-ad-frequency-hint': '60s', src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}` } },
];

// The client is a static Vite + React app that talks to Supabase directly (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// from the repo-root .env). `npm run build` writes client/dist — host it on any static host.
const envDir = path.resolve(here, '..');

export default defineConfig(({ command, mode }) => {
  // loadEnv, not process.env: Vite reads .env itself, so process.env would have been empty here and
  // the HTML shell could silently disagree with what lib/analytics.ts resolved at runtime.
  const env = loadEnv(mode, envDir, '');
  const gaId = resolveId(env.VITE_GA_ID, DEFAULT_GA_ID, isGaId);
  const adsClient = resolveId(env.VITE_ADSENSE_CLIENT, DEFAULT_ADSENSE_CLIENT, isAdsClient);
  return {
  root: here,
  envDir,
  plugins: [
    react(),
    tailwindcss(),
    {
      // version.json must never be cached, so it is emitted as a plain asset and served with the
      // no-store fetch on the client side; Netlify's default HTML rule does not cover it.
      name: 'mekina-version',
      apply: 'build' as const,
      closeBundle() {
        try {
          const out = path.resolve(here, 'dist', 'version.json');
          fs.writeFileSync(out, JSON.stringify({ build: buildId, at: new Date().toISOString() }) + '\n');
          // sw.js is copied verbatim from publicDir, so its cache name is stamped here
          const sw = path.resolve(here, 'dist', 'sw.js');
          if (fs.existsSync(sw)) fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').split('__BUILD_ID__').join(buildId));
        } catch { /* a missing version file just means no update prompt */ }
      },
    },
    {
      name: 'mekina-google-tags',
      transformIndexHtml: {
        order: 'pre' as const,
        handler: () => (command === 'build' ? googleTags(gaId, adsClient) : []),
      },
    },
  ],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  publicDir: path.resolve(here, '..', 'public'), // img/ + assets/ are copied next to the bundle
  build: {
    outDir: path.resolve(here, 'dist'),
    emptyOutDir: true,
    // Keep CSS compatible with older mobile browsers: without this the minifier rewrites media
    // queries to range syntax ((width<=760px)), which pre-16.4 Safari/webviews ignore entirely —
    // every phone style silently drops and the desktop layout renders on mobile.
    cssTarget: 'safari14',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split heavy vendor libs into their own long-cache chunks so the app bundle stays small.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          // Sentry is imported dynamically and must STAY dynamic. Naming it here would fold it into
          // vendor, which every page load fetches — measured at +476 KB raw / +156 KB gzipped on the
          // critical path, for a library the game never needs in order to run.
          if (id.includes('@sentry')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('@heroui')) return 'heroui';
          return 'vendor';
        },
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 8000 },
  };
});
