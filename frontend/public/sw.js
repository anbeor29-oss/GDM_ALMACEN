/*
 * Service worker de GDM NEXO — mínimo y seguro para no servir bundles viejos.
 *
 *  · Navegaciones (abrir una pantalla): NETWORK-FIRST. Siempre baja el HTML
 *    fresco cuando hay red; si no hay, sirve el último que cachó (para que el
 *    kiosco de la tableta abra aunque el wifi se caiga un momento).
 *  · Estáticos con hash de Vite (/assets/...): cache-first (el nombre cambia en
 *    cada build, así que nunca queda viejo).
 *  · Todo lo demás —API (otro origen), CDN de face-api, etc.— pasa de largo.
 *
 * Existe sobre todo para que la app sea INSTALABLE como PWA en tabletas/celulares.
 */
const CACHE = 'gdm-nexo-v1';
const SHELL = '/checador/kiosco';

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return; // API y CDNs pasan de largo

  // Navegación → red primero, caché de respaldo.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        const c = r.clone();
        caches.open(CACHE).then((k) => k.put(SHELL, c)).catch(() => {});
        return r;
      } catch {
        return (await caches.match(req)) || (await caches.match(SHELL)) || Response.error();
      }
    })());
    return;
  }

  // Estáticos con hash de Vite → caché primero.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) { const c = r.clone(); caches.open(CACHE).then((k) => k.put(req, c)).catch(() => {}); }
      return r;
    })());
  }
});
