const CACHE_NAME = 'boeklog-v13';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './js/app.js',
    './js/db.js',
    './js/openlibrary.js',
    './js/github.js',
    './js/pdf.js',
    './js/csv.js',
    './js/recommendations.js',
    './manifest.json',
];

self.addEventListener('install', (e) => {
    console.log('[SW] Installing v13...');
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Cache opened, adding assets');
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    console.log('[SW] Activating v13...');
    e.waitUntil(
        caches.keys().then(keys => {
            console.log('[SW] Found caches:', keys);
            return Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
                console.log('[SW] Deleting old cache:', k);
                return caches.delete(k);
            }));
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const url = e.request.url;
    const isLocal = url.includes(self.location.origin);

    if (isLocal) {
        // Local assets: cache-first
        e.respondWith(
            caches.match(e.request).then(cached => {
                if (cached) {
                    console.log('[SW] Cache hit:', url);
                    return cached;
                }
                console.log('[SW] Cache miss, fetching:', url);
                return fetch(e.request);
            })
        );
    } else {
        // External requests: pass through directly
        console.log('[SW] External request (bypass):', url);
        e.respondWith(fetch(e.request));
    }
});
