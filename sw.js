const CACHE_NAME = 'opositest-v3';
const ASSETS = [
    './',
    './index.html',
    './css/variables.css',
    './css/base.css',
    './css/components.css',
    './css/layout.css',
    './js/db.js',
    './js/store.js',
    './js/parser.js',
    './js/app.js',
    './data/questions.json',
    './data/temario.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            if (response) return response;
            return fetch(event.request).then((fetchResponse) => {
                if (!fetchResponse || fetchResponse.status !== 200) return fetchResponse;
                const responseClone = fetchResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                return fetchResponse;
            });
        }).catch(() => {
            if (event.request.headers.get('accept').includes('text/html')) {
                return caches.match('./index.html');
            }
        })
    );
});
