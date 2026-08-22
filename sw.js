// KBIS Fee Portal — service worker
// Strategy:
//  - HTML pages: NETWORK-FIRST. Always try to fetch the latest version first;
//    only fall back to the cached copy if there's no internet. This is what
//    makes updates show up immediately for everyone on the next visit,
//    instead of getting stuck on whatever was cached at install time.
//  - CSS/JS/images: CACHE-FIRST (with a version bump below to bust old
//    caches on this deploy). These change less often and cache-first makes
//    the app feel instant.
//  - Firestore/Auth/Google traffic: NEVER cached, always live.

const CACHE_NAME = 'kbis-fee-portal-shell-v2'; // bumped: v1 -> v2 clears everyone's stale cache

const SHELL_FILES = [
  'index.html',
  'parent-dashboard.html',
  'admin-dashboard.html',
  'legacy-lookup.html',
  'css/style.css',
  'js/auth.js',
  'js/firebase-config.js',
  'js/pwa-install.js',
  'assets/logo.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting(); // activate this new version immediately, don't wait for old tabs to close
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim(); // take control of any already-open tabs right away
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Firestore/Auth/Google API traffic — always live.
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('google.com')
  ) {
    return;
  }

  const isHtmlRequest =
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') || '').includes('text/html');

  if (isHtmlRequest) {
    // NETWORK-FIRST for pages: always get the newest version when online.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request)) // offline fallback only
    );
    return;
  }

  // CACHE-FIRST for static assets (css/js/images).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (event.request.method === 'GET' && response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});

