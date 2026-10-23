// Pemetaan error §8.2 untuk S-12 mode sesi (W11) dan S-13 (W12/W13): pesan (lib/copy) + aksi
// layar. Logika tanpa React supaya diuji unit (L5a).
import { ERROR_COPY, SESSION_COPY } from '@/lib/copy/id';
import { errorCopy, toAppError } from '@/lib/data/errors';

export type SessionErrorAction =
  /** BRANCH_CLOSED: pilih cabang lain (daftar cabang dimuat ulang). */
  | { kind: 'pick-other' }
  /** SESSION_NOT_ACTIVE: sesi sudah berakhir → "Mulai sesi baru". */
  | { kind: 'start-new' }
  | { kind: 'reload' }
  | { kind: 'none' };

export function sessionError(e: unknown, screen: 'S-12' | 'S-13'): { message: string; action: SessionErrorAction } {
  const err = toAppError(e);
  if (err.kind === 'network') return { message: SESSION_COPY.needsSignal, action: { kind: 'none' } };
  switch (err.code) {
    case 'BRANCH_CLOSED':
      return { message: ERROR_COPY.BRANCH_CLOSED.message, action: { kind: 'pick-other' } };
    case 'SESSION_NOT_ACTIVE':
      return { message: ERROR_COPY.SESSION_NOT_ACTIVE.message, action: { kind: 'start-new' } };
    case 'NOT_FOUND':
      return {
        message: screen === 'S-13' ? ERROR_COPY.SESSION_NOT_ACTIVE.message : ERROR_COPY.NOT_FOUND.message,
        action: screen === 'S-13' ? { kind: 'start-new' } : { kind: 'reload' },
      };
    default:
      return { message: errorCopy(e, screen).message, action: { kind: 'none' } };
  }
}
