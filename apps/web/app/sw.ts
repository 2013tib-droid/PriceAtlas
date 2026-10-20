/// <reference lib="webworker" />
// Service worker (D-81, docs/07 §5.2). Dibangun oleh @serwist/turbopack lewat
// app/serwist/[path]/route.ts → /serwist/sw.js (scope "/").
//
// Aturan cache:
//   /_next/static/*, ikon, manifest   precache (ber-hash, dari daftar build)
//   navigasi ke route shell            network-first (timeout 3 dtk) → cache shell → /offline
//   Supabase (/rest, /storage, /auth), /api, /auth/callback, origin lain
//                                      TIDAK PERNAH di-cache dan tidak ditangani SW (P-14)
// HTML shell tidak memuat data user (D-79), sehingga aman disimpan. Data offline dikelola app
// di IndexedDB (persist TanStack Query, cache R5), bukan oleh service worker.
import { NetworkFirst, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from 'serwist';
import { SHELL_ROUTES, shellCacheKey, shouldHandleNavigation, versionOf } from '@/lib/offline/sw-rules';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const manifest = self.__SW_MANIFEST ?? [];
// Versi shell mengikuti isi daftar precache: build baru → nama cache baru.
const SHELL_CACHE = `shell-${versionOf(manifest)}`;

const serwist = new Serwist({
  precacheEntries: manifest,
  // SW baru menunggu sampai user setuju memuat ulang (banner "Versi baru tersedia", M7, P-12).
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ request, url, sameOrigin }) =>
        shouldHandleNavigation({ mode: request.mode, sameOrigin, pathname: url.pathname }),
      handler: new NetworkFirst({
        cacheName: SHELL_CACHE,
        networkTimeoutSeconds: 3,
        plugins: [
          {
            // Hanya HTML 200 yang disimpan; redirect (mis. ke /masuk) tidak.
            cacheWillUpdate: async ({ response }) =>
              response.status === 200 && !response.redirected && response.type === 'basic' ? response : null,
            // Kunci cache tanpa query (?id=…): shell route statis sama untuk semua id (D-79).
            cacheKeyWillBeUsed: async ({ request }) => shellCacheKey(request.url),
            handlerDidError: async () => (await caches.match('/offline', { cacheName: SHELL_CACHE })) ?? undefined,
          },
        ],
      }),
    },
  ],
});

// Isi cache shell saat install: diambil sebagai fetch biasa (bukan navigasi), sehingga proxy.ts
// tidak mengalihkan ke /masuk dan HTML statis yang tersimpan sama untuk semua user.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(
        SHELL_ROUTES.map(async (path) => {
          const res = await fetch(
            new Request(path, { cache: 'reload', credentials: 'same-origin', redirect: 'manual' }),
          );
          if (res.status === 200) await cache.put(new URL(path, self.location.origin).href, res);
        }),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))),
      ),
  );
});

serwist.addEventListeners();
