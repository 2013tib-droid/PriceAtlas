// Keluar dan hapus akun (docs/07 §3.5, §8.2; docs/05 §7.6; D-76, D-81, Q-61). Logika tanpa React
// supaya diuji unit (L5a): peringatan antrean, teks konfirmasi, pemetaan respons route hapus akun,
// dan pemetaan error W14/W15/W16.
import { ACCOUNT_DELETE_CONFIRMATION } from '@priceatlas/contracts';
import { ERROR_COPY, fill, GENERIC_COPY, ROUTE_ERROR_COPY, SETTINGS_COPY as C } from '@/lib/copy/id';
import { errorCopy, toAppError } from '@/lib/data/errors';
import type { OutboxItem } from '@/lib/offline/outbox-store';

/** Foto di antrean yang belum terdaftar (W1 belum sukses) dan akan ikut terhapus saat keluar (Q-61). */
export function unsentPhotoCount(items: readonly Pick<OutboxItem, 'state' | 'parts'>[]): number {
  return items.filter((i) => i.state !== 'submitted').reduce((n, i) => n + Math.max(1, i.parts.length), 0);
}

/** "3 foto belum terunggah dan akan dihapus. Tetap keluar?" (Q-61); null jika antrean kosong. */
export function signOutWarning(n: number): string | null {
  return n > 0 ? fill(C.signOut.warning, { n }) : null;
}

/** Teks konfirmasi harus persis `HAPUS AKUN` (spasi di tepi diabaikan); route memeriksa nilai yang sama. */
export function isDeleteConfirmed(text: string): boolean {
  return text.trim().replace(/\s+/g, ' ') === ACCOUNT_DELETE_CONFIRMATION;
}

export type DeleteOutcome = { kind: 'done' } | { kind: 'reauth'; message: string } | { kind: 'retry'; message: string };

/** Respons `POST /api/account/delete` (202 / 401 REAUTH_REQUIRED / 500 DELETE_FAILED|DELETE_INCOMPLETE). */
export function deleteOutcome(status: number, body: unknown): DeleteOutcome {
  if (status === 202) return { kind: 'done' };
  const code = (body as { error?: unknown } | null)?.error;
  if (status === 401 || code === 'REAUTH_REQUIRED')
    return { kind: 'reauth', message: ERROR_COPY.REAUTH_REQUIRED.message };
  if (code === 'DELETE_FAILED' || code === 'DELETE_INCOMPLETE')
    return { kind: 'retry', message: ROUTE_ERROR_COPY[code].message };
  return { kind: 'retry', message: GENERIC_COPY.unknown.message };
}

/** W16 di S-00c / S-19b: INVALID_STATE = program dihentikan (§8.2). */
export function membershipError(e: unknown): string {
  return errorCopy(e, 'S-19b').message;
}

/** W14 / W15 di S-19c: INVALID_STATE (W15 saat mati), FORBIDDEN / 42501 (bukan owner). */
export function shareError(e: unknown): string {
  const err = toAppError(e);
  if (err.code === 'FORBIDDEN' || err.rpc?.sqlstate === '42501') return ERROR_COPY.FORBIDDEN.message;
  return errorCopy(e, 'S-19c').message;
}
