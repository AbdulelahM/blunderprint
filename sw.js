// Kish service worker: keeps the app's files on the device so it opens offline.
// VERSION changes on every build, which is how a new version gets noticed.
const VERSION = 'f43b516f18ec';
const CACHE = 'bp-' + VERSION;
const FONT_CACHE = 'bp-fonts';
const CORE = [
  './', './index.html', './app.js', './core.js', './sync.js', './chess.js',
  './stockfish-19-lite-single.js', './stockfish-19-lite-single.wasm',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
];
const LAZY = ['./stockfish-19-asm.js'];   // slow fallback engine: cached the first time it is used

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))));
  // No skipWaiting here: the page shows an update bar and the user decides when to switch.
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('bp-') && k !== CACHE && k !== FONT_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Fonts: use the saved copy, refresh it in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT_CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;          // Lichess, Chess.com: always the network
  // App files: saved copy first, so it opens instantly and offline.
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r.ok && LAZY.some(p => url.pathname.endsWith(p.slice(1)))) c.put(req, r.clone());
      return r;
    } catch (err) {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
