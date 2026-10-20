// Membangun dan menyajikan service worker (Serwist untuk Next 16 + Turbopack, D-81, spike M0).
// Hasil: /serwist/sw.js (+ sw.js.map), dibuat statis saat `next build`.
import { createSerwistRoute } from '@serwist/turbopack';

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: 'app/sw.ts',
  // esbuild native sudah ada di workspace (dipakai tsx/vitest); lebih cepat dari esbuild-wasm.
  useNativeEsbuild: true,
  // Skrip klasik (bukan module worker) supaya juga jalan di Firefox; lihat Providers.
  esbuildOptions: { format: 'iife' },
  // Hanya aset build + ikon/manifest. HTML shell diisi saat install (app/sw.ts).
  globPatterns: ['.next/static/**/*.{js,css,woff2,png,svg,ico,webp}', 'public/**/*'],
});
