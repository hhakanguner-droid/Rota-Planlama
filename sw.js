/* Rota Defteri — Basit Service Worker
   Yalnızca uygulama kabuğunu (HTML/CSS/JS) önbelleğe alır.
   Harita, hava ve mekân verileri internet bağlantısı gerektirir;
   ancak kayıtlı yolculuklar localStorage'da tutulduğu için
   çevrimdışıyken de görüntülenebilir. */

const CACHE_NAME = 'rota-defteri-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Uygulama kabuğu: önce önbellek, sonra ağ (offline çalışma için)
  if (SHELL_FILES.some((f) => url.endsWith(f.replace('./', '')))) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Dış servisler (harita karoları, API'lar): sadece ağdan al, hata durumunda
  // sayfanın kendi hata yönetimi devreye girer.
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
