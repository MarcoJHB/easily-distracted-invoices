// Lets the app open without a connection. Only the app's own files are cached;
// your data never goes through here (it's kept in localStorage and on GitHub).
const CACHE = 'edg-app-v3';
const FILES = [
  './', 'index.html', 'manifest.webmanifest',
  'css/styles.css', 'css/invoice.css',
  'js/app.js', 'js/store.js', 'js/github.js', 'js/rates.js', 'js/invoice.js', 'js/invoice-actions.js',
  'js/ui.js', 'js/util.js', 'js/signature.js',
  'js/view-invoices.js', 'js/view-editor.js', 'js/view-clients.js', 'js/view-settings.js', 'js/view-revenue.js', 'js/revenue.js',
  'vendor/html2pdf.bundle.min.js', 'assets/logo.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first (so updates show up straight away), cache when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
