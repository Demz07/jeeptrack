const CACHE_NAME = "jeeptrack-v2";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/driver.html",
  "/passenger.html",
  "/styles/main.css",
  "/js/firebase-init.js",
  "/js/app.js",
  "/js/driver.js",
  "/js/passenger.js",
  "/js/helpers.js",
  "/js/icons.js",
  "/js/destinations.js",
  "/manifest.json",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/favicon.png",
  "/assets/icons/favicon.ico"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.hostname.includes("firebase") || url.hostname.includes("gstatic")) {
    return;
  }

  if (url.hostname.includes("unpkg") || url.hostname.includes("leaflet")) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            return res;
          })
      )
    );
    return;
  }

  if (PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
