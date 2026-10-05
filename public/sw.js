/* SBC Prayer Console service worker
   - Versioned cache; bump CACHE_VERSION on each release
   - App shell: cache-first (stale-while-revalidate)
   - /api/*: network-first, cache last good GET responses for offline
   - Never cache POST (or any non-GET)
*/
const CACHE_VERSION = 'spc-v0.2.0';
const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('spc-') && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const d = event.data;
  if (d === 'SKIP_WAITING' || (d && d.type === 'SKIP_WAITING')) self.skipWaiting();
  if (d && d.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', cache: CACHE_VERSION });
  }
});

function apiCacheKey(url) {
  // Normalize: drop ephemeral query noise but keep date/cat
  const u = new URL(url);
  return u.pathname + u.search;
}

async function networkFirstApi(req) {
  const cache = await caches.open(CACHE_VERSION);
  const key = apiCacheKey(req.url);
  try {
    const res = await fetch(req);
    if (res && res.ok && req.method === 'GET') {
      try { await cache.put(key, res.clone()); } catch {}
    }
    return res;
  } catch (e) {
    const cached = await cache.match(key) || await cache.match(req);
    if (cached) {
      const h = new Headers(cached.headers);
      h.set('X-SW-Fallback', '1');
      return new Response(await cached.blob(), { status: cached.status, statusText: cached.statusText, headers: h });
    }
    return new Response(JSON.stringify({ error: 'offline', detail: 'No cached copy of this API response' }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'X-SW-Fallback': '1' }
    });
  }
}

async function shellStrategy(req) {
  const cache = await caches.open(CACHE_VERSION);
  if (req.mode === 'navigate') {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        try { await cache.put('/index.html', res.clone()); } catch {}
      }
      return res;
    } catch {
      return (await cache.match('/index.html')) || (await cache.match('/')) ||
        new Response('<!doctype html><meta charset=utf-8><title>Offline</title><body style="font:18px system-ui;padding:24px"><h1>Offline</h1><p>Open the Prayer Console once online so it can be saved on this device.</p></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  }
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      cache.put(req, copy).catch(() => {});
    }
    return res;
  }).catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Never cache non-GET (POST /api/refresh etc.)
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // OSM tiles etc. — browser/network only

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(req));
    return;
  }
  event.respondWith(shellStrategy(req));
});
