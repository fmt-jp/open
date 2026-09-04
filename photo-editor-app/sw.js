// このアプリはもうService Workerによるキャッシュを使わない。
// 過去にインストールされてしまった古いService Workerが残っている端末のために、
// このファイル自体を「自己解除スイッチ」として機能させ、古いキャッシュを消して制御を手放す。
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      await self.registration.unregister();
      const clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach(client => client.navigate(client.url));
    })()
  );
});
