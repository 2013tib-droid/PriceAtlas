// Klien service role. HANYA server (import 'server-only'); kunci tidak pernah
// diberi prefix NEXT_PUBLIC_ (§7.7). Dipakai Route Handler operasi bersecret saja (D-61).
import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function createSupabaseAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY belum diisi');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
