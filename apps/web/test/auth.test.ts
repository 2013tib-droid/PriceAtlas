// proxy.ts, /auth/callback (klien tiruan, docs/07 §11.2), ?next aman, dan pesan OTP.
import { describe, expect, it, vi } from 'vitest';
import { handleAuthCallback } from '@/lib/auth/callback';
import { authErrorMessage } from '@/lib/auth/otp-errors';
import { decideRedirect, isDocumentNavigation, isPublicPath } from '@/lib/auth/proxy-rules';
import { safeNext } from '@/lib/auth/redirect';
import { AUTH_COPY } from '@/lib/copy/id';

describe('safeNext (open redirect)', () => {
  it.each([
    ['/unggahan', '/unggahan'],
    ['/produk?id=1', '/produk?id=1'],
    [null, '/'],
    ['https://jahat.example', '/'],
    ['//jahat.example', '/'],
    ['/\\jahat.example', '/'],
    ['/masuk', '/'],
    ['/auth/callback', '/'],
  ])('%s → %s', (input, out) => expect(safeNext(input)).toBe(out));
});

describe('proxy.ts', () => {
  const nav = new Headers({ 'sec-fetch-mode': 'navigate' });
  it('hanya navigasi dokumen yang dialihkan', () => {
    expect(isDocumentNavigation(nav)).toBe(true);
    // Precache service worker / fetch biasa: shell statis apa adanya (tanpa data user).
    expect(isDocumentNavigation(new Headers({ 'sec-fetch-mode': 'same-origin' }))).toBe(false);
    expect(isDocumentNavigation(new Headers({ 'sec-fetch-mode': 'cors', rsc: '1' }))).toBe(false);
    expect(isDocumentNavigation(new Headers({ rsc: '1' }))).toBe(false);
    expect(isDocumentNavigation(new Headers())).toBe(true);
  });

  it('route publik', () => {
    for (const p of ['/masuk', '/offline', '/auth/callback', '/api/account/delete', '/serwist/sw.js'])
      expect(isPublicPath(p), p).toBe(true);
    for (const p of ['/', '/unggahan', '/saya', '/masukan']) expect(isPublicPath(p), p).toBe(false);
  });

  it('belum login → /masuk?next=…', () => {
    expect(decideRedirect({ pathname: '/unggahan', search: '?x=1', signedIn: false, navigation: true })).toEqual({
      redirect: '/masuk?next=%2Funggahan%3Fx%3D1',
    });
    expect(decideRedirect({ pathname: '/', search: '', signedIn: false, navigation: false })).toBeNull();
    expect(decideRedirect({ pathname: '/masuk', search: '', signedIn: false, navigation: true })).toBeNull();
    expect(decideRedirect({ pathname: '/offline', search: '', signedIn: false, navigation: true })).toBeNull();
  });

  it('sudah login membuka /masuk → tujuan aman', () => {
    expect(decideRedirect({ pathname: '/masuk', search: '?next=%2Fsaya', signedIn: true, navigation: true })).toEqual({
      redirect: '/saya',
    });
    expect(
      decideRedirect({ pathname: '/masuk', search: '?next=%2F%2Fjahat', signedIn: true, navigation: true }),
    ).toEqual({ redirect: '/' });
    expect(decideRedirect({ pathname: '/saya', search: '', signedIn: true, navigation: true })).toBeNull();
  });
});

describe('/auth/callback (PKCE Google)', () => {
  const origin = 'http://localhost:3000';
  it('tukar code → ke next', async () => {
    const exchange = vi.fn(async () => ({ error: null }));
    const to = await handleAuthCallback(new URL(`${origin}/auth/callback?code=abc&next=%2Fsaya`), {
      exchangeCodeForSession: exchange,
    });
    expect(exchange).toHaveBeenCalledWith('abc');
    expect(to.href).toBe(`${origin}/saya`);
  });
  it('gagal tukar → /masuk?error=callback (next dipertahankan)', async () => {
    const to = await handleAuthCallback(new URL(`${origin}/auth/callback?code=abc&next=%2Fsaya`), {
      exchangeCodeForSession: async () => ({ error: new Error('invalid grant') }),
    });
    expect(to.pathname).toBe('/masuk');
    expect(to.searchParams.get('error')).toBe('callback');
    expect(to.searchParams.get('next')).toBe('/saya');
  });
  it('tanpa code (user membatalkan) → /masuk?error=callback, tanpa memanggil Auth', async () => {
    const exchange = vi.fn();
    const to = await handleAuthCallback(new URL(`${origin}/auth/callback?error=access_denied`), {
      exchangeCodeForSession: exchange,
    });
    expect(exchange).not.toHaveBeenCalled();
    expect(to.search).toBe('?error=callback');
  });
  it('next berbahaya diabaikan', async () => {
    const to = await handleAuthCallback(new URL(`${origin}/auth/callback?code=a&next=https%3A%2F%2Fjahat.example`), {
      exchangeCodeForSession: async () => ({ error: null }),
    });
    expect(to.href).toBe(`${origin}/`);
  });
});

describe('pesan error OTP (§8.2)', () => {
  const sentAt = Date.parse('2026-10-19T10:00:00Z');
  it('otp_expired dalam 10 menit = kode salah; setelahnya = kedaluwarsa', () => {
    const e = { code: 'otp_expired', status: 403 };
    expect(authErrorMessage(e, { step: 'verify', sentAt, now: sentAt + 60_000 })).toBe(AUTH_COPY.codeWrong);
    expect(authErrorMessage(e, { step: 'verify', sentAt, now: sentAt + 11 * 60_000 })).toBe(AUTH_COPY.codeExpired);
  });
  it('rate limit', () => {
    expect(authErrorMessage({ code: 'over_email_send_rate_limit', status: 429 }, { step: 'send' })).toBe(
      AUTH_COPY.rateLimited,
    );
    expect(authErrorMessage({ status: 429 }, { step: 'verify' })).toBe(AUTH_COPY.rateLimited);
  });
  it('jaringan', () => {
    expect(authErrorMessage(new TypeError('Failed to fetch'), { step: 'send' })).toBe(AUTH_COPY.offline);
  });
  it('email tidak valid', () => {
    expect(authErrorMessage({ code: 'email_address_invalid', status: 400 }, { step: 'send' })).toBe(
      AUTH_COPY.emailInvalid,
    );
  });
});
