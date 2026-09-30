// tetris — service worker
// Cache-first for the small static bundle so the game works offline.

const CACHE = 'tetris-v1.5.6-zh-offline-5';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/base.css',
  'css/themes.css',
  'css/game.css',
  'js/app.js',
  'js/engine.js',
  'js/idiom-manager.js',
  'js/renderer.js',
  'js/line-clear-effect.js',
  'js/reward-overlay.js',
  'js/input.js',
  'js/background.js',
  'js/sound.js',
  'js/scoreboard.js',
  'js/storage.js',
  'assets/favicon.svg',
  'assets/music.mp3',
];

// The first page fetches JSON before SW control. Cache it during installation
// too, so its very first offline refresh retains the full list. JSON failure
// must not prevent the game shell from installing and using its fallback.
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(path => new Request(new URL(path, self.location.href), { cache: 'reload' })));
    try {
      const response = await fetch('data/idioms.json', {
        cache: 'reload', signal: AbortSignal.timeout(5000),
      });
      if (response.ok) await cache.put('data/idioms.json', response);
    } catch { /* Optional data: IdiomManager handles the playable fallback. */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only handle same-origin
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // Finish the write within the response lifetime; never persist errors.
      if (res.ok) {
        try { await cache.put(req, res.clone()); } catch { /* Network response is still usable. */ }
      }
      return res;
    } catch {
      // HTML fallback is for navigation only, never for missing JSON/modules.
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
