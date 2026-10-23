// Hasil S-12 dikembalikan ke layar asal (`kembali=`, docs/07 §7.1): layar asal (S-10/S-11) membuka
// /lokasi lewat openLocationHref, S-12 menyimpan pilihan di sessionStorage lalu kembali, dan layar
// asal mengambilnya sekali (takeLocationPick) untuk PATCH receipt (S-10) atau W18 (S-11).
export interface PickedLocation {
  store: { id: string; name: string; channel: 'offline' | 'online'; is_private: boolean };
  /** null = "Tidak tahu cabangnya" (U-14, D-28). */
  branch: { id: string; name: string; status: 'open' | 'closed'; kind?: string; is_private?: boolean } | null;
}

export type LocationMode = 'manual' | 'koreksi' | 'sesi';

const KEY = 'priceatlas:location-pick';
const OPEN_KEY = 'priceatlas:location-open';
const TTL_MS = 30 * 60_000;

type Stored = PickedLocation & { target: string; at: number };

/** URL S-12. `target` menandai siapa yang menunggu hasil (mis. "receipt:<id>", "items:<capture>"). */
export function openLocationHref(mode: LocationMode, target: string, back: string): string {
  try {
    sessionStorage.setItem(OPEN_KEY, JSON.stringify({ target, at: Date.now() }));
  } catch {
    // tanpa sessionStorage: S-12 memakai router.replace(kembali).
  }
  return `/lokasi?${new URLSearchParams({ mode, untuk: target, kembali: back }).toString()}`;
}

/** Dibuka dari layar asal di dokumen ini (bisa `router.back()`), bukan tautan langsung. */
export function openedFromApp(target: string): boolean {
  try {
    const raw = sessionStorage.getItem(OPEN_KEY);
    if (!raw) return false;
    const v = JSON.parse(raw) as { target: string; at: number };
    return v.target === target && Date.now() - v.at < TTL_MS;
  } catch {
    return false;
  }
}

export function completeLocationPick(target: string, picked: PickedLocation): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...picked, target, at: Date.now() } satisfies Stored));
    sessionStorage.removeItem(OPEN_KEY);
  } catch {
    // abaikan
  }
}

/** Ambil hasil untuk target ini (sekali). */
export function takeLocationPick(target: string): PickedLocation | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    if (v.target !== target || Date.now() - v.at > TTL_MS) return null;
    sessionStorage.removeItem(KEY);
    return { store: v.store, branch: v.branch };
  } catch {
    return null;
  }
}

/** Hanya path relatif di app ini (tidak membuka redirect ke situs lain). */
export function safeBack(raw: string | null | undefined, fallback = '/unggahan'): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : fallback;
}
