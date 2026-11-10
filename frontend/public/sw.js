const CACHE_NAME = 'mileage-v4';
const ASSETS = [
  '/',
  '/index.html',
  '/gauge.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only this origin's own GETs. A request the worker re-issues with fetch() is held to
  // the worker's own Content-Security-Policy, whose connect-src is 'self' — so routing
  // map tiles and web fonts through here blocked every one of them. Left alone, the
  // browser loads them under the page's img-src and font-src instead.
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network first, falling back to the cache when offline.
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
