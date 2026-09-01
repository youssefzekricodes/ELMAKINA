/* ELMAKINA service worker — makes the app installable + offline-capable for PWA Builder packaging.
   IMPORTANT: it only ever touches SAME-ORIGIN GET requests. Supabase (functions + Realtime), the
   WebRTC signalling, and TURN traffic are cross-origin / non-GET / WebSocket and pass straight to the
   network untouched — the live game and voice must never be cached. Bump CACHE to ship a new shell. */
/* The cache name carries the build: a new deploy activates a new SW, which drops every cache that
   is not its own on activate (below), so the shell can never outlive the build it came from. */
const CACHE = 'mekina-__BUILD_ID__';
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

/* ── push ───────────────────────────────────────────────────────────────────
   Standard Web Push, no Firebase: the payload is signed and sent by supabase/functions/push and
   arrives here even when the app is closed. Everything is defensive — a malformed payload must
   still raise SOMETHING, because a push event that ends without showing a notification costs the
   site its permission in Chrome. */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'ELMEKINA';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/img/pwa-192.png?v=3',
    badge: '/img/pwa-192.png?v=3',
    tag: d.tag || 'mekina',
    renotify: true,
    vibrate: [40, 30, 40],
    data: { url: d.url || '/' },
  }));
});

/* Tapping one takes you to the table it is about — and reuses the window that is already open
   rather than stacking another copy of the game on top of it. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin !== self.location.origin) continue;
      await c.focus();
      if (url !== '/' && 'navigate' in c) { try { await c.navigate(url); } catch (_) { /* focus is enough */ } }
      return;
    }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                                  // never cache POSTs (Supabase fn invokes)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                   // never touch supabase.co / TURN / any cross-origin

  // Media goes straight to the network, always.
  //
  // An <audio> element does not fetch a file, it asks for byte ranges, and a cache-first handler
  // answers a range request with whatever whole response it has — which the element cannot use.
  // Worse, the lobby track was requested once before the file existed, so the SPA fallback's HTML
  // came back 200 and was cached under that URL; from then on the element was handed a web page to
  // decode and played nothing, in the installed app only, because only the installed app has a
  // service worker in front of it.
  if (req.destination === 'audio' || req.destination === 'video' || req.headers.has('range')) return;

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
      // …and never store a page under an asset's URL. A single-page host answers anything it cannot
      // find with index.html and a 200, so a missing asset does not fail — it poisons the cache with
      // HTML until the next deploy. If it is not a document request, HTML is not the answer.
      const html = (res.headers.get('content-type') || '').includes('text/html');
      if (res && res.status === 200 && res.type === 'basic' && !(html && req.destination !== 'document')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    } catch (err) {
      return cached || Response.error();
    }
  })());
});
