const VERSION = 'optipress-v1';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest', '/optipress.svg', '/favicon.svg', '/banner.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('optipress-') && !key.startsWith(VERSION)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          void caches.open(RUNTIME_CACHE).then(cache => cache.put('/index.html', copy));
          return response;
        })
        .catch(async () => {
          return (await caches.match(request)) || (await caches.match('/index.html')) || (await caches.match('/')) || Response.error();
        })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(async cached => {
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        void caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    })
  );
});
