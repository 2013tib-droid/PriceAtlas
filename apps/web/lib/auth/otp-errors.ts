// Pesan error Auth di S-00a (docs/07 §8.2 baris "Auth"). GoTrue mengembalikan `otp_expired`
// untuk kode salah MAUPUN kedaluwarsa, jadi keduanya dibedakan dari waktu kirim kode.
import { AUTH_COPY, GENERIC_COPY } from '@/lib/copy/id';
import { isNetworkFailure } from '@/lib/data/errors';

export const OTP_EXPIRY_SECONDS = 600; // supabase/config.toml [auth.email] otp_expiry
export const RESEND_COOLDOWN_SECONDS = 60;

interface AuthErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

export function authErrorMessage(
  e: unknown,
  ctx: { step: 'send' | 'verify'; sentAt?: number | null; now?: number } = { step: 'send' },
): string {
  const err = (e ?? {}) as AuthErrorLike;
  if (isNetworkFailure(e) || err.status === 0) return AUTH_COPY.offline;
  if (err.status === 429 || /rate_limit/.test(err.code ?? '')) return AUTH_COPY.rateLimited;
  if (ctx.step === 'verify') {
    const now = ctx.now ?? Date.now();
    const fresh = ctx.sentAt != null && now - ctx.sentAt < OTP_EXPIRY_SECONDS * 1000;
    if (err.code === 'otp_expired') return fresh ? AUTH_COPY.codeWrong : AUTH_COPY.codeExpired;
    return AUTH_COPY.codeWrong;
  }
  if (err.code === 'email_address_invalid' || err.code === 'validation_failed') return AUTH_COPY.emailInvalid;
  return GENERIC_COPY.unknown.message;
}
