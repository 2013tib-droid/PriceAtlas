// Lingkungan L4: Supabase CLI lokal (`supabase status -o env`).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env ${name} wajib diisi (lihat packages/l4/run.sh)`);
  return v;
}

export const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const ANON_KEY = need('NEXT_PUBLIC_SUPABASE_ANON_KEY');
export const SERVICE_KEY = need('SUPABASE_SERVICE_ROLE_KEY');
export const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };

export function anon(): SupabaseClient {
  return createClient(API_URL, ANON_KEY, noPersist);
}

export function admin(): SupabaseClient {
  return createClient(API_URL, SERVICE_KEY, noPersist);
}

export function uniqueEmail(tag: string): string {
  return `l4-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export interface MailpitMessage {
  ID: string;
  Subject: string;
  HTML: string;
  Text: string;
}

export async function latestEmail(to: string, timeoutMs = 20_000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (res.ok) {
      const body = (await res.json()) as { messages?: { ID: string }[] };
      const id = body.messages?.[0]?.ID;
      if (id) return (await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json()) as MailpitMessage;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Email untuk ${to} tidak muncul di Mailpit`);
}

/** User baru + sesi lewat generateLink (email_otp) → verifyOtp. Mengembalikan klien ber-JWT user. */
export async function signedInUser(tag: string): Promise<{ client: SupabaseClient; userId: string; token: string; email: string }> {
  const email = uniqueEmail(tag);
  const { data, error } = await admin().auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const client = anon();
  const v = await client.auth.verifyOtp({ email, token: data.properties.email_otp, type: 'email' });
  if (v.error || !v.data.session) throw v.error ?? new Error('tanpa sesi');
  return { client, userId: v.data.session.user.id, token: v.data.session.access_token, email };
}
