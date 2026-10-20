// PKCE Google (D-79, docs/07 §3.5). Tidak memakai service role; tidak menulis data.
import { NextResponse } from 'next/server';
import { handleAuthCallback } from '@/lib/auth/callback';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const target = await handleAuthCallback(new URL(request.url), supabase.auth);
  return NextResponse.redirect(target);
}
