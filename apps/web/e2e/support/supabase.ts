// Helper e2e (Node, BUKAN kode klien): service role hanya dipakai test untuk membuat user dan
// mengambil kode OTP (docs/07 §11.2). Env dari `supabase status -o env`.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

export function hasSupabase(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function admin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY belum diisi (supabase status -o env)');
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Kode OTP 6 digit terbaru lewat admin generateLink (tanpa membaca email). */
export async function generateEmailOtp(email: string): Promise<string> {
  return (await generateEmailOtpForUser(email)).otp;
}

/** Sama dengan generateEmailOtp, ditambah id user (untuk menyiapkan data household-nya). */
export async function generateEmailOtpForUser(email: string): Promise<{ otp: string; userId: string }> {
  const { data, error } = await admin().auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const otp = data.properties?.email_otp;
  if (!otp || !/^\d{6}$/.test(otp)) throw new Error(`email_otp tidak berbentuk 6 digit: ${otp}`);
  return { otp, userId: data.user.id };
}

export interface MailpitMessage {
  ID: string;
  Subject: string;
  HTML: string;
  Text: string;
}

/** Email terbaru untuk alamat ini di Mailpit (F-18). Menunggu sampai muncul. */
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

export function codeFrom(message: MailpitMessage): string {
  const m = /\b(\d{6})\b/.exec(message.Text || message.HTML);
  if (!m) throw new Error('Kode 6 digit tidak ada di email');
  return m[1]!;
}
