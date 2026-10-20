// Ukuran file untuk peringatan antrean (D-81): "52 MB", "1,4 MB", "850 kB".
const ONE = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const INT = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) return `${INT.format(mb)} MB`;
  if (mb >= 1) return `${ONE.format(mb)} MB`;
  return `${INT.format(Math.max(1, bytes / 1024))} kB`;
}
