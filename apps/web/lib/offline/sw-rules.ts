// Aturan service worker yang bisa diuji unit (dipakai app/sw.ts, docs/07 §5.2).

/** Route shell yang harus terbuka offline (docs/07 §7.1 kolom "Offline"). */
export const SHELL_ROUTES = ['/', '/cari', '/produk', '/unggahan', '/belanja', '/saya', '/masuk', '/offline'] as const;

/** Path same-origin yang tidak pernah ditangani SW: API, auth callback, SW itu sendiri. */
const NEVER_CACHE_PATH = /^\/(api|auth|serwist)(\/|$)/;

/**
 * SW hanya menangani navigasi dokumen same-origin. Permintaan ke Supabase (REST/RPC, Storage,
 * Auth) selalu origin lain, sehingga tidak pernah lewat cache SW (P-14).
 */
export function shouldHandleNavigation(input: { mode: string; sameOrigin: boolean; pathname: string }): boolean {
  return input.sameOrigin && input.mode === 'navigate' && !NEVER_CACHE_PATH.test(input.pathname);
}

/** Kunci cache shell tanpa query: route statis sama untuk semua id (D-79, /produk?id=). */
export function shellCacheKey(url: string): string {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

/** Hash kecil untuk versi cache shell dari daftar precache. */
export function versionOf(value: unknown): string {
  let h = 0;
  for (const ch of JSON.stringify(value)) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
