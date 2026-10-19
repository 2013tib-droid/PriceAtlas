// Aturan pengalihan proxy.ts (docs/07 §3.5). Dipisah supaya bisa diuji unit.
// proxy.ts BUKAN otorisasi: RLS yang menolak akses data.

/** Route yang boleh dibuka tanpa sesi (segmen utuh: /masukan bukan /masuk). */
const PUBLIC_SEGMENTS = ['masuk', 'offline', 'auth', 'api', 'serwist'];

export function isPublicPath(pathname: string): boolean {
  const first = pathname.split('/')[1] ?? '';
  return PUBLIC_SEGMENTS.includes(first);
}

/**
 * Hanya navigasi dokumen yang dialihkan. Permintaan lain (precache service worker,
 * prefetch RSC) mendapat shell statis apa adanya: HTML shell tidak memuat data user (P-01),
 * dan penjaga di klien (AppShell) yang mengalihkan.
 */
export function isDocumentNavigation(headers: Headers): boolean {
  const mode = headers.get('sec-fetch-mode');
  if (mode) return mode === 'navigate';
  // Browser lama / alat CLI tanpa Sec-Fetch-*: anggap navigasi kecuali permintaan RSC.
  return !headers.has('rsc') && !headers.has('next-router-prefetch');
}

export type ProxyDecision = { redirect: string } | null;

export function decideRedirect(input: {
  pathname: string;
  search: string;
  signedIn: boolean;
  navigation: boolean;
}): ProxyDecision {
  const { pathname, search, signedIn, navigation } = input;
  if (!navigation) return null;
  if (pathname === '/masuk') {
    if (!signedIn) return null;
    const next = new URLSearchParams(search).get('next');
    return {
      redirect: next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/masuk') ? next : '/',
    };
  }
  if (signedIn || isPublicPath(pathname)) return null;
  return { redirect: `/masuk?next=${encodeURIComponent(pathname + search)}` };
}
