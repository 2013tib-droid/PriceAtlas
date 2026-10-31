// POST /api/worker/kick — picu worker produksi (GitHub Actions worker.yml, docs/09 §3.3, F-191).
// HANYA server: GITHUB_DISPATCH_TOKEN dibaca di sini dan tidak pernah NEXT_PUBLIC_. Tanpa service role.
import 'server-only';
import { NextResponse } from 'next/server';
import { handleKick, kickConfigFromEnv } from '@/lib/worker/kick-server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const result = await handleKick({
    async getUser() {
      // getUser() memverifikasi JWT ke server Auth (bukan sekadar membaca cookie).
      const { data, error } = await supabase.auth.getUser();
      return error || !data.user ? null : { id: data.user.id };
    },
    config: kickConfigFromEnv(),
  });
  const headers = { 'Cache-Control': 'no-store' };
  if (result.status === 204) return new NextResponse(null, { status: 204, headers });
  return NextResponse.json(result.body, { status: result.status, headers });
}
