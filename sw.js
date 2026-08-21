// KBIS Fee Portal — service worker
// Caches only the static "app shell" (HTML/CSS/JS/icons) so the app opens
// instantly and still loads its interface offline. Fee data itself is
// NEVER cached here — that always comes fresh from Firestore, so a parent
// never sees a stale balance.

const CACHE_NAME = 'kbis-fee-portal-shell-v1';

const SHELL_FILES = [
  'index.html',
  'parent-dashboard.html',
  'admin-dashboard.html',
  'legacy-lookup.html',
  'css/style.css',
  'js/auth.js',
  'js/firebase-config.js',
  'assets/logo.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {
      // If a file 404s during install (e.g. legacy-lookup.html was deleted),
      // don't fail the whole install — just skip caching that one file.
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Firestore/Auth/Google API traffic — always go to network,
  // this is what keeps fee balances and login state accurate and live.
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('google.com')
  ) {
    return; // let the browser handle it normally, no interception
  }

  // App shell files: cache-first, so the app opens instantly and works offline.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Only cache successful, same-origin GET responses.
        if (event.request.method === 'GET' && response.ok && url.origin === self.location.origin) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      }).catch(() => cached); // offline and not cached: nothing we can do for this file
    })
  );
});
