// bump this string whenever any cached file changes, to invalidate old caches
const CACHE_VERSION = "fx-life-v7";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./analyze.js",
  "./manifest.webmanifest",
  "./libs/chart.umd.min.js",
  "./libs/tesseract.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first, falling back to network, and opportunistically caching whatever the
// network returns (this also covers Tesseract's own runtime fetches for its worker
// script, wasm core, and language data — those are cross-origin requests made by the
// page, but a service worker still sees and can cache them, which is what lets OCR
// keep working offline after the first successful run).
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              try { cache.put(event.request, copy); } catch (e) { /* opaque cross-origin responses etc. */ }
            });
          }
          return response;
        })
        .catch(() => cached); // offline and not cached: nothing more we can do
      return cached || fetchPromise;
    })
  );
});
