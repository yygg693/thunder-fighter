/* =====================================================================
 * 打飞机 · Fighter Shooter — Service Worker
 * 缓存应用外壳，实现离线可玩（仅在 http(s) 部署时激活）
 * ===================================================================== */
const CACHE = 'djfe-v1';
const ASSETS = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'icon.svg',
  'src/core.js',
  'src/entities.js',
  'src/game.js',
  'src/main.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 缓存优先，缺席时回源并顺手缓存
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        if (res && res.ok && req.url.indexOf('http') === 0) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit)
    )
  );
});
