const CACHE_NAME = 'site-measure-pro-v1.0';
const CORE_ASSETS = [
    './',
    './index.html',
    './data.js?v=1.0',
    './cad.js?v=1.0',
    './export.js?v=1.0',
    './app.js?v=1.0',
    './view.html',
    './view.js',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET' || !req.url.startsWith('http')) return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    e.respondWith(
        fetch(req)
            .then((res) => {
                if (res && res.status === 200) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
                }
                return res;
            })
            .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
});
// === END OF sw.js ===
