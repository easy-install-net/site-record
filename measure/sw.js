const CACHE_NAME = 'site-measure-pro-v9.0';
const PRECACHE_URLS = [
    './',
    './index.html',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/vue/3.4.21/vue.global.prod.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.allSettled(
                PRECACHE_URLS.map(async (url) => {
                    try {
                        const res = await fetch(url.startsWith('http') ? new Request(url, { mode: 'no-cors' }) : url);
                        if (res) await cache.put(url, res);
                    } catch (_) {}
                })
            )
        )
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET' || req.url.includes('googleapis.com')) return;

    if (req.mode === 'navigate' || req.url.endsWith('/index.html') || req.url.endsWith('/measure/')) {
        e.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 3000);
                const fresh = await fetch(req, { signal: ctrl.signal });
                clearTimeout(timer);
                if (fresh?.ok) {
                    cache.put('./index.html', fresh.clone());
                    return fresh;
                }
            } catch (_) {}
            return (await cache.match('./index.html')) || (await cache.match('./')) || fetch(req);
        })());
        return;
    }

    e.respondWith(
        caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req).then((res) => {
            if (res && (res.status === 200 || res.type === 'opaque')) {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((c) => c.put(req, copy));
            }
            return res;
        }).catch(() => cached))
    );
});
