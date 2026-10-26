// Ajakan pasang ke layar utama di iOS + `navigator.storage.persist()` (D-81, Q-62, P-04, §5.8).
// iOS menghapus IndexedDB situs yang tidak dibuka 7 hari kecuali dipasang ke layar utama; iOS juga
// tidak punya `beforeinstallprompt`, jadi petunjuk manual ditampilkan sekali setelah foto pertama.
// Android/desktop memakai prompt bawaan browser (tanpa ajakan dari app).

/** Status di `prefs` (💾 per perangkat, ikut terhapus saat Keluar). */
export type InstallPromptPref = 'pending' | 'dismissed' | 'not_needed';

export interface InstallEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** `navigator.standalone` (Safari iOS) atau `display-mode: standalone`. */
  standalone: boolean;
}

/** iPhone/iPod/iPad, termasuk iPadOS yang mengaku "Macintosh" dengan layar sentuh. */
export function isIos(env: Pick<InstallEnv, 'userAgent' | 'maxTouchPoints'>): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true;
  return /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1;
}

/** Status awal saat foto pertama tercatat: ajakan hanya di iOS yang belum dipasang. */
export function firstPhotoPref(env: InstallEnv): InstallPromptPref {
  return isIos(env) && !env.standalone ? 'pending' : 'not_needed';
}

/** Ajakan tampil jika status 'pending' dan app belum berjalan sebagai PWA terpasang. */
export function shouldShowInstallPrompt(pref: InstallPromptPref | null, env: InstallEnv): boolean {
  return pref === 'pending' && isIos(env) && !env.standalone;
}

export function readInstallEnv(): InstallEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  let displayStandalone = false;
  try {
    displayStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  } catch {
    // matchMedia tidak ada (jsdom lama): anggap tidak terpasang.
  }
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone === true || displayStandalone,
  };
}

/** Minta penyimpanan persisten (P-04). Gagal/tidak didukung = diabaikan. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
