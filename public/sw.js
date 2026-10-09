// public/sw.js
const STATIC_CACHE = 'yassal-static-v1';
const MEDIA_CACHE = 'yassal-library-media-v1';

const APP_SHELL = [
  '/',
  '/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('[SW] Précache app shell impossible :', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== MEDIA_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  const { type, url } = event.data || {};
  if (!url) return;

  if (type === 'CACHE_MEDIA') {
    event.waitUntil(
      caches.open(MEDIA_CACHE).then((cache) =>
        fetch(url, { mode: 'cors' })
          .then((response) => {
            if (response && response.ok) {
              return cache.put(url, response.clone());
            }
          })
          .catch((err) => console.warn('[SW] Mise en cache impossible pour', url, err))
      )
    );
  }

  if (type === 'REMOVE_MEDIA') {
    event.waitUntil(
      caches.open(MEDIA_CACHE).then((cache) => cache.delete(url))
    );
  }
});

function isMediaRequest(url) {
  return /\.(mp3|m4a|wav|webm|ogg|opus|jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (isMediaRequest(request.url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const clone = response.clone();
              caches.open(MEDIA_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached); // hors-ligne et absent du cache
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/index.html'))
      )
  );
});
