// PixelVeil のオフライン対応 Service Worker。
//
// 注意(重要・今後の保守者向け): 以前バージョンではキャッシュの固着により「更新したのに
// 反映されない」という不具合が繰り返し発生した。それを避けるため、この実装は
// stale-while-revalidate 戦略を採用している: キャッシュがあれば即座にそれを返して
// オフラインでも高速に動作させつつ、裏側では必ずネットワークから最新版を取得して
// キャッシュを更新する。そのため「オンラインなら次回アクセス時には自動的に最新化される」。
//
// CACHE 名は中身(ASSETS)を変更するたびに数字を上げること。activate 時に旧キャッシュは
// 自動削除される。skipWaiting/clients.claim により、新しい Service Worker は
// タブを閉じ直さなくても次のナビゲーションから有効になる。
const CACHE = 'pixelveil-v1';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './vendor/exif.js',
  './vendor/face-api.min.js',
  './vendor/weights/tiny_face_detector_model-weights_manifest.json',
  './vendor/weights/tiny_face_detector_model-shard1',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // このアプリは外部オリジンに依存しない設計

  event.respondWith(staleWhileRevalidate(req));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(res => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);

  // キャッシュがあれば即返す(オフライン時も高速)。裏側の networkFetch は
  // await していなくても実行され続け、成功すればキャッシュを更新する。
  if (cached) return cached;

  const fresh = await networkFetch;
  return fresh || new Response('オフラインのため読み込めませんでした', { status: 503, statusText: 'Offline' });
}
