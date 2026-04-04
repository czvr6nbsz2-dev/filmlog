const CACHE_NAME = 'filmlog-v8';
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './manifest.json',
];
const JS_ASSETS = [
    './js/app.js',
    './js/db.js',
    './js/omdb.js',
    './js/tmdb.js',
    './js/github-sync.js',
    './js/pdf.js',
    './js/csv.js',
    './js/recommendations.js',
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll([...STATIC_ASSETS, ...JS_ASSETS]))
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
    const isLocal = url.startsWith(self.location.origin);

    if (!isLocal) {
        // External requests (OMDb, TMDB, Anthropic, GitHub) bypass SW
        return;
    }

    const path = new URL(url).pathname;
    const isJS = path.endsWith('.js');

    if (isJS) {
        // JS files: network-first so updates are picked up immediately
        e.respondWith(
            fetch(e.request)
                .then(res => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                    return res;
                })
                .catch(() => caches.match(e.request))
        );
    } else {
        // Static assets (HTML, CSS, manifest): cache-first for offline support
        e.respondWith(
            caches.match(e.request).then(cached => cached || fetch(e.request))
        );
    }
});
