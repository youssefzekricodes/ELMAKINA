/* ELMAKINA service worker — makes the app installable + offline-capable for PWA Builder packaging.
   IMPORTANT: it only ever touches SAME-ORIGIN GET requests. Supabase (functions + Realtime), the
   WebRTC signalling, and TURN traffic are cross-origin / non-GET / WebSocket and pass straight to the
   network untouched — the live game and voice must never be cached. Bump CACHE to ship a new shell. */
const CACHE = 'mekina-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/img/pwa-192.png', '/img/pwa-512.png', '/img/favicon.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                                  // never cache POSTs (Supabase fn invokes)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                   // never touch supabase.co / TURN / any cross-origin

  // App shell: network-first so online players always get the latest build; cached index when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  // Hashed static assets (js/css/fonts/images): cache-first, then fill the cache on first hit.
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    } catch (err) {
      return cached || Response.error();
    }
  })());
});
