// Next 16 proxy (pengganti middleware, D-79): menyegarkan cookie sesi Supabase lalu
// mengalihkan navigasi tanpa sesi ke /masuk. Bukan otorisasi (RLS yang menolak).
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { decideRedirect, isDocumentNavigation } from '@/lib/auth/proxy-rules';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getClaims() memverifikasi JWT dan menyegarkan token jika perlu (pola @supabase/ssr).
  const { data } = await supabase.auth.getClaims();
  const decision = decideRedirect({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    signedIn: Boolean(data?.claims?.sub),
    navigation: isDocumentNavigation(request.headers),
  });
  if (!decision) return response;

  const target = NextResponse.redirect(new URL(decision.redirect, request.url));
  for (const c of response.cookies.getAll()) target.cookies.set(c);
  return target;
}

export const config = {
  // Kecuali aset, service worker, manifest, ikon, callback, dan API (docs/07 §3.5).
  matcher: [
    '/((?!_next/static|_next/image|serwist/|auth/callback|api/|manifest.webmanifest|icons/|favicon.ico|icon.svg|apple-icon|robots.txt).*)',
  ],
};
