// Service worker для PWA. Спочатку мережа, а якщо її немає - збережена копія.
// API, WebSocket і /health не кешуємо: гра все одно потребує сервер.
const CACHE = 'space-duel-v1';
const SKIP = ['/api/', '/ws', '/health', '/ready', '/metrics'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // старі версії кешу видаляємо
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (SKIP.some((p) => url.pathname.startsWith(p))) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? Response.error())),
  );
});
