// Klien Supabase untuk browser: JWT user, RLS berlaku. Tidak pernah memakai service role (D-61).
// Satu instance per tab (docs/07 §3.4).
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function createSupabaseBrowserClient(): SupabaseClient {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

export function getSupabaseBrowserClient(): SupabaseClient {
  client ??= createSupabaseBrowserClient();
  return client;
}
