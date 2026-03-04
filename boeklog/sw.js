const CACHE_NAME = 'boeklog-v10';
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
    const url = e.request.url;

    // NEVER cache external API calls - let them go straight through
    if (url.includes('api.anthropic.com') ||
        url.includes('openlibrary.org') ||
        url.includes('api.github.com')) {
        return;
    }

    // Cache-first strategy for local assets only
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
