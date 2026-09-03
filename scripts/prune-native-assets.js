'use strict';
/**
 * Drop web-only files from the native app bundles  (runs automatically after `cap sync`)
 *
 * `cap sync` copies client/dist wholesale into the native projects, which is right for the game
 * but wrong for everything around it. A PWA manifest, a service worker, install icons, Apple's
 * startup images, a social preview card and four crawler text files all exist to serve a WEBSITE.
 * Inside a store app nothing can ever read them — the launcher icon comes from the native project,
 * the splash from the native project, and no crawler will ever fetch a file out of an APK.
 *
 * They are not harmless: they are megabytes of download on the install, which is the number that
 * decides whether someone on a Tunisian mobile connection finishes installing.
 *
 * privacy/ deliberately STAYS. Home.tsx links to it and a reachable privacy policy is a hard
 * Play requirement — deleting it to save 6 KB would fail review.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// Every path is relative to the copied web root inside each native project.
const WEB_ONLY = [
  'img/splash',            // apple-touch-startup-image; native launch screens come from the platform
  'img/pwa-192.png',       // "add to home screen" icons — the app already has a launcher icon
  'img/pwa-512.png',
  'img/pwa-maskable-512.png',
  'img/apple-touch-icon.png',
  'img/favicon.png',
  'img/og-image.png',      // social sharing card
  'manifest.webmanifest',  // PWA install manifest
  'sw.js',                 // service worker, deliberately never registered natively (see main.tsx)
  'ads.txt',               // authorised sellers — crawlers read these at the DOMAIN root
  'app-ads.txt',
  'robots.txt',
  'sitemap.xml',
];

const ROOTS = [
  path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public'),
  path.join(root, 'ios', 'App', 'App', 'public'),
];

const bytes = (p) => {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, f) => n + bytes(path.join(p, f)), 0);
};

let freed = 0;
let touched = 0;
for (const base of ROOTS) {
  if (!fs.existsSync(base)) continue;   // that platform simply is not added yet
  touched++;
  for (const rel of WEB_ONLY) {
    const target = path.join(base, rel);
    if (!fs.existsSync(target)) continue;
    freed += bytes(target);
    fs.rmSync(target, { recursive: true, force: true });
  }
}

if (touched) console.log(`✔ pruned web-only assets from ${touched} native project(s) — ${(freed / 1048576).toFixed(1)} MB`);
