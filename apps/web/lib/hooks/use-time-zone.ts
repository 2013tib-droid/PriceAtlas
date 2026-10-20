'use client';
import { useMyContext } from '@/lib/auth/context';

/** Zona household dari R1 (P-16). Cadangan Asia/Jakarta (D-68) selama R1 belum termuat. */
export function useTimeZone(): string {
  return useMyContext().data?.household.timezone ?? 'Asia/Jakarta';
}
