// Content-Security-Policy (docs/07 §11.6, ditunda dari M0 ke M2 bersama unggahan). Dibangun saat
// build dari NEXT_PUBLIC_SUPABASE_URL:
//   connect-src  'self' + Supabase (REST/RPC, Auth, Storage upload)
//   img-src      'self' blob: data: + Supabase (signed URL Storage, pratinjau foto lokal blob:)
//   worker-src   'self' blob: (service worker, worker kompresi)
// Skrip inline bootstrap Next butuh 'unsafe-inline': nonce memerlukan render dinamis per request,
// bertentangan dengan shell statis yang di-precache (D-79). Lihat F-44.
export function buildCsp(supabaseUrl: string | undefined, dev = false): string {
  let supabase = '';
  try {
    supabase = supabaseUrl ? new URL(supabaseUrl).origin : '';
  } catch {
    supabase = '';
  }
  const src = (...xs: string[]) => xs.filter(Boolean).join(' ');
  return [
    `default-src 'self'`,
    `script-src ${src("'self'", "'unsafe-inline'", dev ? "'unsafe-eval'" : '')}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src ${src("'self'", 'blob:', 'data:', supabase)}`,
    `font-src 'self' data:`,
    `connect-src ${src("'self'", supabase, dev ? 'ws:' : '')}`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}
