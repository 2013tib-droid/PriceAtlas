// Tanggal dan waktu (docs/07 §10.3, P-16). "Hari ini" selalu dihitung di zona household
// (R1 household.timezone), bukan zona perangkat.
//   Tanggal transaksi (tipe SQL `date`, string YYYY-MM-DD) TIDAK pernah diubah menjadi Date
//   lalu diformat dengan zona waktu; dibandingkan sebagai tanggal kalender saja.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Tanggal kalender hari ini (YYYY-MM-DD) di zona `timeZone`. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  // en-CA memberi format YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function dayNumber(isoDate: string): number {
  const m = ISO_DATE.exec(isoDate);
  if (!m) throw new Error(`Tanggal tidak valid: ${isoDate}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/** Selisih hari kalender a - b. */
export function daysBetween(a: string, b: string): number {
  return dayNumber(a) - dayNumber(b);
}

const DATE_FMT = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** 12 Okt 2026 — dari string `date`, tanpa geser zona. */
export function formatDateAbsolute(isoDate: string): string {
  return DATE_FMT.format(new Date(dayNumber(isoDate) * 86_400_000));
}

/**
 * Tanggal transaksi: relatif jika < 7 hari dari hari ini di zona household
 * ("hari ini", "kemarin", "3 hari lalu"), selain itu "12 Okt 2026".
 * Tanggal di masa depan (jarang: salah input) ditulis absolut.
 */
export function formatTransactionDate(isoDate: string, timeZone: string, now: Date = new Date()): string {
  const diff = daysBetween(todayInZone(timeZone, now), isoDate);
  if (diff === 0) return 'hari ini';
  if (diff === 1) return 'kemarin';
  if (diff > 1 && diff < 7) return `${diff} hari lalu`;
  return formatDateAbsolute(isoDate);
}

/** 14:05 — jam dari timestamptz di zona household. */
export function formatTime(timestamp: string | Date, timeZone: string): string {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
    .format(d)
    .replace('.', ':');
}

/** "2 menit lalu" untuk timestamptz (waktu unggah). */
export function formatRelativeTime(timestamp: string | Date, now: Date = new Date()): string {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return 'baru saja';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  return `${Math.floor(hr / 24)} hari lalu`;
}

/** Durasi sesi: 1j 12m · 45m */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
}
