/**
 * The native shell.
 *
 * The same game code that runs at elmekina.com, wrapped in an Android/iOS app so it can carry
 * AdMob (which has no browser equivalent) and native push (which a WebView cannot get from the
 * Web Push stack). Nothing about the game changes; only what is allowed to load beside it.
 *
 * NOTE THE ABSENCE OF `server.url`. Pointing the WebView at the live site would make releases
 * instant, and it is the first thing everyone reaches for — but Apple rejects remote-URL wrappers
 * under guideline 4.2 far more often than it passes them, and it would put a network round trip in
 * front of every cold start. The assets are bundled instead, and the backend (Supabase) is shared
 * with the web build, so gameplay stays identical while the shell stays defensible.
 *
 * Build with `npm run build:native`, NOT `npm run build`: the native build is the one that leaves
 * AdSense out of the HTML. See client/src/lib/platform.ts for why that is not optional.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // PERMANENT. Google Play and the App Store both key the listing to this string, and neither lets
  // you change it after the first upload — a different id is a different app, with no path to move
  // installs or reviews across. Now is the only cheap moment to disagree with it.
  appId: 'com.elmekina.game',
  appName: 'ELMEKINA',

  // Where `npm run build:native` writes. Relative to this file, at the repo root.
  webDir: 'client/dist',

  server: {
    // Capacitor's default on Android, stated here because it is load-bearing rather than cosmetic:
    // the scheme is part of the WebView's ORIGIN, and localStorage is keyed by origin. The game
    // keeps a lot there (mekina.games, mekina.lastAd, the profile, the one-shot nudges), so
    // changing this after release would silently orphan every player's local state.
    androidScheme: 'https',
  },

  // Matches theme-color in client/index.html and background_color in the manifest, so the frame
  // behind the WebView is the app's own dark rather than a white flash before first paint.
  android: { backgroundColor: '#0E0B08' },
  ios: { backgroundColor: '#0E0B08' },
};

export default config;
