// Ke mana label harga masuk (D-11, D-28, wireframe S-06/S-12): sesi aktif, atau lokasi manual
// dari S-12 mode manual ("Tidak tahu cabangnya" boleh, U-14). Kamera label `/kamera?jenis=label`
// membawa lokasi manual di URL (`toko`, `cabang`) supaya tetap ada setelah muat ulang.
import { openLocationHref, type PickedLocation } from '@/lib/confirm/location-handoff';

/** Target S-12 (`untuk=`) untuk label tanpa sesi (F-53). */
export const LABEL_TARGET = 'label';
export const LABEL_CAMERA = '/kamera?jenis=label';

export interface ManualLocation {
  storeId: string;
  branchId: string | null;
}

/** Kamera label; dengan lokasi manual jika ada. */
export function labelCameraHref(loc?: ManualLocation | null): string {
  if (!loc) return LABEL_CAMERA;
  const qs = new URLSearchParams({ jenis: 'label', toko: loc.storeId });
  if (loc.branchId) qs.set('cabang', loc.branchId);
  return `/kamera?${qs.toString()}`;
}

export function manualLocationOf(picked: PickedLocation): ManualLocation {
  return { storeId: picked.store.id, branchId: picked.branch?.id ?? null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lokasi manual dari query kamera; id tidak valid diabaikan (tidak dikirim ke W1). */
export function manualLocationFrom(
  params: { get(k: string): string | null } | null | undefined,
): ManualLocation | null {
  const storeId = params?.get('toko') ?? null;
  if (!storeId || !UUID.test(storeId)) return null;
  const branchId = params?.get('cabang') ?? null;
  return { storeId, branchId: branchId && UUID.test(branchId) ? branchId : null };
}

/** S-12 mode manual untuk label tanpa sesi (judul "Label ini dari mana?"). */
export function labelLocationHref(): string {
  return openLocationHref('manual', LABEL_TARGET, LABEL_CAMERA);
}
