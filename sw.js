/* =====================================================================
 * 打飞机 · Fighter Shooter — Service Worker
 * 缓存应用外壳，实现离线可玩（仅在 http(s) 部署时激活）
 * ===================================================================== */
/* ⚠ 改了 ASSETS 或任何被缓存的文件，**必须**同时把 CACHE 版本号 +1。
 * activate 只删「名字 !== 当前 CACHE」的旧缓存；版本号不变的话，已安装的
 * PWA 会一直吃旧的 index.html —— 新加的 <script> 永远加载不到，3D 会静默
 * 退化成 2D，是最难排查的那类劣化。 */
const CACHE = 'djfe-v1.3.3';
const ASSETS = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'icon.svg',
  'libs/three.min.js',
  'src/core.js',
  'src/entities.js',
  'src/render3d.js',
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
