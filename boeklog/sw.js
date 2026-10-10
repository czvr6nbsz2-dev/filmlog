const CACHE_NAME = 'boeklog-v14';
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
    console.log('[SW] Installing v14...');
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Cache opened, adding assets');
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    console.log('[SW] Activating v14...');
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
        // Local assets: network-first, so code fixes land immediately.
        // Falls back to the cache when offline. Successful responses are
        // written back to the cache to keep the offline copy fresh.
        e.respondWith(
            fetch(e.request)
                .then(response => {
                    if (response && response.ok && e.request.method === 'GET') {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(e.request))
        );
    } else {
        // External requests (e.g. Open Library, covers): pass through directly.
        e.respondWith(fetch(e.request));
    }
});
