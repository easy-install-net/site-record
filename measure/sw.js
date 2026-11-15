const CACHE_NAME = 'site-measure-pro-v8.4';
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

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await Promise.allSettled(
                PRECACHE_URLS.map(async (url) => {
                    try {
                        const req = url.startsWith('http') ? new Request(url, { mode: 'no-cors' }) : url;
                        const res = await fetch(req);
                        if (res) await cache.put(url, res);
                    } catch (e) {}
                })
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = req.url;
    if (url.includes('firestore.googleapis.com') || url.includes('identitytoolkit.googleapis.com') || url.includes('securetoken.googleapis.com')) {
        return;
    }

    if (req.mode === 'navigate' || url.endsWith('/index.html') || url.endsWith('/measure/')) {
        event.respondWith(
            (async () => {
                const cache = await caches.open(CACHE_NAME);
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 3000);
                    const fresh = await fetch(req, { signal: controller.signal });
                    clearTimeout(timer);
                    if (fresh && fresh.ok) {
                        cache.put('./index.html', fresh.clone());
                        return fresh;
                    }
                } catch (e) {}
                return (await cache.match('./index.html')) || (await cache.match('./')) || fetch(req);
            })()
        );
        return;
    }

    event.respondWith(
        caches.match(req, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((res) => {
                if (res && (res.status === 200 || res.type === 'opaque')) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
                }
                return res;
            }).catch(() => cached);
        })
    );
});
