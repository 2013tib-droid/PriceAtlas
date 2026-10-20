// GET /auth/callback (PKCE Google, D-79): tukar `code` menjadi cookie sesi, lalu ke `next`.
// Logika dipisah dari Route Handler supaya bisa diuji dengan klien tiruan (docs/07 §11.2).
import { safeNext } from './redirect';

export interface CodeExchanger {
  exchangeCodeForSession(code: string): Promise<{ error: unknown }>;
}

export async function handleAuthCallback(url: URL, auth: CodeExchanger): Promise<URL> {
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));
  const fail = new URL('/masuk', url.origin);
  fail.searchParams.set('error', 'callback');
  if (next !== '/') fail.searchParams.set('next', next);

  // Provider mengembalikan ?error=… (mis. user membatalkan) tanpa code.
  if (!code) return fail;
  const { error } = await auth.exchangeCodeForSession(code);
  return error ? fail : new URL(next, url.origin);
}
