// Aturan service worker (D-81, docs/07 §5.2): REST/Storage/Auth/API tidak pernah di-cache.
import { describe, expect, it } from 'vitest';
import { SHELL_ROUTES, shellCacheKey, shouldHandleNavigation, versionOf } from '@/lib/offline/sw-rules';

describe('service worker', () => {
  it('menangani navigasi shell same-origin', () => {
    for (const p of ['/', '/unggahan', '/produk', '/masuk']) {
      expect(shouldHandleNavigation({ mode: 'navigate', sameOrigin: true, pathname: p }), p).toBe(true);
    }
  });

  it('tidak pernah menangani Supabase (origin lain), /api, /auth, /serwist', () => {
    expect(
      shouldHandleNavigation({ mode: 'navigate', sameOrigin: false, pathname: '/rest/v1/rpc/get_my_context' }),
    ).toBe(false);
    expect(
      shouldHandleNavigation({ mode: 'cors', sameOrigin: false, pathname: '/storage/v1/object/sign/captures/x' }),
    ).toBe(false);
    expect(shouldHandleNavigation({ mode: 'cors', sameOrigin: false, pathname: '/auth/v1/token' })).toBe(false);
    for (const p of ['/api/account/delete', '/auth/callback', '/serwist/sw.js']) {
      expect(shouldHandleNavigation({ mode: 'navigate', sameOrigin: true, pathname: p }), p).toBe(false);
    }
  });

  it('bukan navigasi (fetch data, aset) tidak ditangani runtime cache', () => {
    expect(shouldHandleNavigation({ mode: 'cors', sameOrigin: true, pathname: '/' })).toBe(false);
  });

  it('kunci cache shell tanpa query', () => {
    expect(shellCacheKey('https://app.example/produk?id=1')).toBe('https://app.example/produk');
  });

  it('shell offline mencakup tab utama, cari + detail produk (§7.1), /masuk, dan /offline', () => {
    expect(SHELL_ROUTES).toEqual([
      '/',
      '/cari',
      '/produk',
      '/unggahan',
      '/unggahan/detail',
      '/kamera',
      '/belanja',
      '/saya',
      '/selamat-datang',
      '/masuk',
      '/offline',
    ]);
  });

  it('versi berubah jika daftar precache berubah', () => {
    expect(versionOf([{ url: '/a.js' }])).not.toBe(versionOf([{ url: '/b.js' }]));
    expect(versionOf([{ url: '/a.js' }])).toBe(versionOf([{ url: '/a.js' }]));
  });
});
