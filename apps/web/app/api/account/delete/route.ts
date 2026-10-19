// POST /api/account/delete (docs/05 §7.6). Server-only, memakai SUPABASE_SERVICE_ROLE_KEY.
import { NextResponse } from 'next/server';
import { deleteAccount } from '@/lib/account/delete';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  const result = await deleteAccount(
    {
      async getUser() {
        // getUser() memverifikasi JWT ke server Auth (bukan sekadar membaca cookie).
        const { data, error } = await supabase.auth.getUser();
        return error || !data.user ? null : { id: data.user.id, last_sign_in_at: data.user.last_sign_in_at ?? null };
      },
      async beginDeletion(userId) {
        const { error } = await admin.rpc('begin_account_deletion', { p_user_id: userId });
        if (error) throw new Error(error.message);
      },
      async deleteAuthUser(userId) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw new Error(error.message);
      },
    },
    body,
  );
  return NextResponse.json(result.body, { status: result.status });
}
