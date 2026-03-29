const CACHE_NAME = "gpc-card-v1";
const CARD_URLS = ["/card"];

// Only cache the card page HTML — never cache JS/CSS bundles.
// Next.js JS/CSS filenames include content hashes, so stale cache = broken app.
const CACHEABLE = (url) => {
  const { pathname } = new URL(url);
  return pathname === "/card";
};

// Install: cache card page shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CARD_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for card page and static assets
self.addEventListener("fetch", (event) => {
  // Skip non-http(s) requests (chrome-extension://, etc.)
  if (!event.request.url.startsWith("http")) return;

  const url = new URL(event.request.url);

  // Network-first for API calls
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first only for the card page HTML — everything else goes straight to network
  if (!CACHEABLE(event.request.url)) {
    return; // Let browser handle it normally
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
      return cached || fetched;
    })
  );
});
