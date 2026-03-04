const CACHE_NAME = 'boeklog-v7';
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
    // Don't intercept Anthropic API calls - let them go through directly
    if (e.request.url.includes('api.anthropic.com')) {
        return; // Let browser handle normally without service worker
    }

    // Network-first for other API calls, cache-first for assets
    if (e.request.url.includes('openlibrary.org') ||
        e.request.url.includes('api.github.com')) {
        // For API calls: try network first, fall back to cache
        e.respondWith(
            fetch(e.request)
                .catch(() => caches.match(e.request))
                .then(response => {
                    // If both network and cache failed, return error response
                    return response || new Response('Offline - API unavailable', { status: 503 });
                })
        );
    } else {
        // For assets: cache first, fall back to network
        e.respondWith(
            caches.match(e.request).then(cached => cached || fetch(e.request))
        );
    }
});
