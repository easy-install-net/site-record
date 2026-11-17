const CACHE_NAME = 'measure-pro-v11.1';

const CORE_ASSETS = [
    './',
    './index.html',
    './app.js?v=11.1',
    './data.js?v=11.1',
    './cad.js?v=11.1',
    './view.html',
    './view.js',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url)))
        )
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // 放行 Firebase 登入與雲端資料庫連線，避免干擾 Google 登入與即時同步
    if (
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('firebaseapp.com') ||
        url.hostname.includes('accounts.google.com')
    ) {
        return;
    }

    // 本機核心網頁與 JS：網絡優先（確保隨時吃到最新版本），無網時自動切換離線快取
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res && res.status === 200) {
                        const copy = res.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() => caches.match(req, { ignoreSearch: true }))
        );
        return;
    }

    // 外部工具庫 (Vue / Tailwind / Firebase SDK / jsPDF)：快取優先，確保離線可用
    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((res) => {
                if (res && res.status === 200) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return res;
            });
        })
    );
});
