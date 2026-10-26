// Onboarding S-00b → S-00c (docs/07 §3.5 "pertama kali? /selamat-datang : tujuan semula", wireframe
// S-00b/S-00c). Status "sudah dilihat" disimpan di perangkat (💾 prefs `onboarded`, per user).
// Semua login (OTP dan Google) melewati /selamat-datang?next=…; layar itu langsung meneruskan ke
// tujuan jika status sudah ada, sehingga Google (lewat /auth/callback) ikut tanpa logika server.
import { safeNext } from '@/lib/auth/redirect';

export const WELCOME_PATH = '/selamat-datang';
export const WELCOME_MEMBER_PATH = '/selamat-datang/member';

/** Tujuan setelah login: selalu lewat S-00b (yang meneruskan jika sudah onboarded). */
export function welcomeHref(next: string | null | undefined): string {
  const target = safeNext(next);
  return target === '/' ? WELCOME_PATH : `${WELCOME_PATH}?next=${encodeURIComponent(target)}`;
}

/** S-00b "Mulai" → S-00c dengan tujuan yang sama. */
export function memberStepHref(next: string | null | undefined): string {
  const target = safeNext(next);
  return target === '/' ? WELCOME_MEMBER_PATH : `${WELCOME_MEMBER_PATH}?next=${encodeURIComponent(target)}`;
}

/** Tujuan akhir onboarding (Lewati / Simpan & lanjut / sudah onboarded). Tidak pernah kembali ke onboarding. */
export function afterOnboarding(next: string | null | undefined): string {
  const target = safeNext(next);
  return target.startsWith(WELCOME_PATH) ? '/' : target;
}
