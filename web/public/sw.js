// OWLIM STOCK 매매도우미 — Service Worker
// 정책:
//   /api/*           → network-only (캐싱 X, 항상 최신)
//   /assets/*, /*.png, manifest 등 → cache-first (Vite hashed → 새 버전마다 새 파일)
//   /                → network-first → fallback to cache (SPA shell)

const CACHE_NAME = 'owlim-stock-v3';
const APP_SHELL = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  // 새 SW 즉시 활성화 — 옛 캐시 대기 안 함
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // API는 항상 네트워크
  if (url.pathname.startsWith('/api/')) return;

  // Vite-hashed assets (/assets/*.js, *.css 등) → cache-first
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
            return res;
          }),
      ),
    );
    return;
  }

  // SPA navigation → network-only (항상 최신 index.html)
  if (event.request.mode === 'navigate' || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .catch(() => new Response('offline', { status: 503 })),
    );
  }
});
