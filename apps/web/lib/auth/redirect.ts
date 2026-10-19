// Tujuan setelah login (?next=). Hanya path internal: mencegah open redirect.
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (next.startsWith('/masuk') || next.startsWith('/auth/')) return fallback;
  return next;
}
