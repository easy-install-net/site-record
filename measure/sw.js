const CACHE_NAME = 'site-measure-pro-v8.5';
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
                PRECACHE_URLS.map((url) =>
                    fetch(url.startsWith('http') ? new Request(url, { mode: 'no-cors' }) : url)
                        .then((res) => res && cache.put(url, res))
                        .catch(() => {})
                )
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
    const req = e.request, url = req.url;
    if (req.method !== 'GET' || url.includes('firestore.googleapis.com') || url.includes('identitytoolkit.googleapis.com') || url.includes('securetoken.googleapis.com')) return;

    if (req.mode === 'navigate' || url.endsWith('/index.html') || url.endsWith('/measure/')) {
        e.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            try {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), 3000);
                const fresh = await fetch(req, { signal: ctrl.signal });
                clearTimeout(t);
                if (fresh && fresh.ok) {
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
                const clone = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            }
            return res;
        }).catch(() => cached))
    );
});
