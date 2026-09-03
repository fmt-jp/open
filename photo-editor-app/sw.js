// 最小構成のオフラインキャッシュ。写真データはキャッシュ対象外(常に端末内メモリのみで処理)。
const CACHE = 'photo-hide-v1';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // CDN(exif-js/face-api.js)はブラウザの通常キャッシュに任せる
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
