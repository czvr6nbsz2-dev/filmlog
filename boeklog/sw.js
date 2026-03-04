const CACHE_NAME = 'boeklog-v11';
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
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Only cache local assets - never intercept ANY external calls
    const url = e.request.url;
    const isLocal = !url.includes('://') || url.includes(self.location.origin);

    if (!isLocal) {
        // External requests bypass service worker completely
        return;
    }

    // Local assets only: cache-first
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
