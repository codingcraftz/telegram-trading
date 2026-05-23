// OWLIM — self-destruct SW.
// 옛 캐시 전부 삭제 후 자기 자신 unregister.
// 이후 브라우저가 항상 네트워크에서 fresh 리소스를 가져옴.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((c) => c.navigate(c.url)))
  );
});
