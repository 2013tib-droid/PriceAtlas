// Klien Supabase untuk browser (Tahap 5): JWT user, RLS berlaku. Tidak pernah memakai service role.
import { createBrowserClient } from '@supabase/ssr';

export function createSupabaseBrowserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
