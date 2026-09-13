/* ЦеЗошит — service worker (офлайн-кэш) */
const CACHE = 'sovezoshit-v2';
const ASSETS = [
  './', './index.html', './shared/ui/style.css', './manifest.webmanifest',
  './util.js', './style.css',
  './shared/util.js', './shared/ai/ai.js',
  './shared/core/doc.js', './shared/core/history.js', './shared/core/render.js',
  './shared/tools/tools.js', './shared/tools/insert.js',
  './shared/ui/storage.js', './shared/ui/app.js', './shared/ui/topbar.js',
  './shared/ui/toolbar.js', './shared/ui/pagesbar.js', './shared/ui/modals.js', './shared/ui/start.js',
  './shared/collab/collab.js', './shared/collab/collab-ui.js', './shared/collab/poll.js',
  './transport.js', './shared/vendor/qrcode.js',
  './icons/icon.svg', './icons/icon-maskable.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // fonts и vendor — cache-first; остальное — network-first с fallback в кэш
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const cp = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
        return res;
      }))
    );
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const cp = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, cp));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
  );
});
