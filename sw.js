/* Service worker — Estudio Eléctrico
 * Subir CACHE_VERSION en cada cambio de archivos del app shell para que el celular reciba la versión nueva.
 */
const CACHE_VERSION = 'v2';
const SHELL_CACHE = 'aee-shell-' + CACHE_VERSION;
const DATA_CACHE = 'aee-data-' + CACHE_VERSION;

const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'img/simbolos/denryokuryoukei.svg', 'img/simbolos/haisenyou-shadanki.svg', 'img/simbolos/kaiheiki.svg', 'img/simbolos/rouden-shadanki.svg', 'img/simbolos/tenmetsuki-3ro.svg', 'img/simbolos/tenmetsuki-4ro.svg', 'img/simbolos/tenmetsuki-a.svg', 'img/simbolos/tenmetsuki-d.svg', 'img/simbolos/tenmetsuki-h.svg', 'img/simbolos/tenmetsuki-l.svg', 'img/simbolos/tenmetsuki-ras.svg', 'img/simbolos/tenmetsuki-t.svg', 'img/simbolos/tenmetsuki.svg'];
const DATA = ['data/exams.json', 'data/denko2-kanbetsu.json'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    const data = await caches.open(DATA_CACHE);
    await data.addAll(DATA);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('aee-') && k !== SHELL_CACHE && k !== DATA_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // enlaces externos: red normal

  // data/*.json → stale-while-revalidate (contenido nuevo sin subir versión)
  if (url.pathname.includes('/data/')) {
    event.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })());
    return;
  }

  // Navegación → index.html desde caché si no hay red
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => (await caches.match('index.html')) || caches.match('./')));
    return;
  }

  // Resto del app shell → cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok) (await caches.open(SHELL_CACHE)).put(req, res.clone());
    return res;
  })());
});
