// POST /api/ask — Tanya (S-20, docs/08 §10). HANYA server: ANTHROPIC_API_KEY dibaca di sini dan
// tidak pernah NEXT_PUBLIC_. RPC memakai JWT user dari cookie (RLS), tanpa service role.
import 'server-only';
import { NextResponse } from 'next/server';
import type { RpcClient } from '@priceatlas/contracts';
import { askEngineFromEnv, handleAsk } from '@/lib/ask/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const supabase = await createSupabaseServerClient();
  const result = await handleAsk(
    {
      async getUser() {
        // getUser() memverifikasi JWT ke server Auth (bukan sekadar membaca cookie).
        const { data, error } = await supabase.auth.getUser();
        return error || !data.user ? null : { id: data.user.id };
      },
      rpc: supabase as unknown as RpcClient,
      engine: askEngineFromEnv(),
      signal: request.signal,
    },
    body,
  );
  return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
}
