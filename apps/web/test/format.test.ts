// docs/07 §10.3: formatter + batas tengah malam WIB vs UTC (P-16).
import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  formatDateAbsolute,
  formatDuration,
  formatPercent,
  formatRelativeTime,
  formatRupiah,
  formatTime,
  formatTransactionDate,
  formatUnitPrice,
  spokenUnitPrice,
  todayInZone,
} from '@/lib/format';

describe('Rupiah (P-17)', () => {
  it('Rp19.500 tanpa spasi', () => {
    expect(formatRupiah(19500)).toBe('Rp19.500');
    expect(formatRupiah(1250000)).toBe('Rp1.250.000');
    expect(formatRupiah(0)).toBe('Rp0');
  });
  it('dibulatkan ke rupiah', () => {
    expect(formatRupiah(19499.6)).toBe('Rp19.500');
  });
  it('negatif (baris diskon)', () => {
    expect(formatRupiah(-2000)).toBe('-Rp2.000');
    expect(formatRupiah(-0.4)).toBe('Rp0');
  });
  it('bukan angka', () => {
    expect(formatRupiah(Number.NaN)).toBe('–');
  });
});

describe('harga per satuan', () => {
  it('maks 1 desimal dengan koma', () => {
    expect(formatUnitPrice(97.5, 'g')).toBe('Rp97,5/g');
    expect(formatUnitPrice(97.54, 'g')).toBe('Rp97,5/g');
    expect(formatUnitPrice(12, 'pcs')).toBe('Rp12/pcs');
  });
  it('2 desimal jika < Rp1', () => {
    expect(formatUnitPrice(0.85, 'ml')).toBe('Rp0,85/ml');
    expect(formatUnitPrice(0.5, 'ml')).toBe('Rp0,50/ml');
  });
  it('ribuan untuk produk timbang', () => {
    expect(formatUnitPrice(45000, 'kg')).toBe('Rp45.000/kg');
  });
  it('teks pembaca layar', () => {
    expect(spokenUnitPrice(97.5, 'g')).toBe('97,5 rupiah per gram');
  });
});

describe('persen', () => {
  it('tanpa tanda, dibulatkan', () => {
    expect(formatPercent(4.4)).toBe('4%');
    expect(formatPercent(-12.6)).toBe('13%');
  });
});

describe('tanggal transaksi (zona household)', () => {
  const WIB = 'Asia/Jakarta';

  it('tanggal `date` tidak bergeser zona', () => {
    expect(formatDateAbsolute('2026-10-12')).toBe('12 Okt 2026');
    expect(formatDateAbsolute('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDateAbsolute('2026-12-31')).toBe('31 Des 2026');
  });

  it('relatif < 7 hari, absolut selainnya', () => {
    const now = new Date('2026-10-19T05:00:00Z'); // 12:00 WIB
    expect(formatTransactionDate('2026-10-19', WIB, now)).toBe('hari ini');
    expect(formatTransactionDate('2026-10-18', WIB, now)).toBe('kemarin');
    expect(formatTransactionDate('2026-10-16', WIB, now)).toBe('3 hari lalu');
    expect(formatTransactionDate('2026-10-13', WIB, now)).toBe('6 hari lalu');
    expect(formatTransactionDate('2026-10-12', WIB, now)).toBe('12 Okt 2026');
    expect(formatTransactionDate('2026-10-20', WIB, now)).toBe('20 Okt 2026');
  });

  it('00:30 WIB = 17:30 UTC hari sebelumnya: "hari ini" mengikuti WIB, bukan UTC', () => {
    const now = new Date('2026-10-19T17:30:00Z'); // 20 Okt 00:30 WIB
    expect(todayInZone(WIB, now)).toBe('2026-10-20');
    expect(todayInZone('UTC', now)).toBe('2026-10-19');
    expect(formatTransactionDate('2026-10-20', WIB, now)).toBe('hari ini');
    expect(formatTransactionDate('2026-10-19', WIB, now)).toBe('kemarin');
    // Perangkat dengan zona UTC akan salah satu hari; formatter tidak memakai zona perangkat.
    expect(formatTransactionDate('2026-10-19', 'UTC', now)).toBe('hari ini');
  });

  it('tepat di batas tengah malam WIB (17:00:00Z)', () => {
    expect(todayInZone(WIB, new Date('2026-10-19T16:59:59Z'))).toBe('2026-10-19');
    expect(todayInZone(WIB, new Date('2026-10-19T17:00:00Z'))).toBe('2026-10-20');
  });

  it('pergantian bulan dan tahun', () => {
    expect(daysBetween('2026-03-01', '2026-02-28')).toBe(1);
    expect(daysBetween('2027-01-01', '2026-12-31')).toBe(1);
    expect(formatTransactionDate('2026-12-31', WIB, new Date('2026-12-31T17:10:00Z'))).toBe('kemarin');
  });

  it('tanggal tidak valid ditolak', () => {
    expect(() => formatDateAbsolute('19/10/2026')).toThrow();
  });
});

describe('waktu dan durasi', () => {
  it('jam di zona household', () => {
    expect(formatTime('2026-10-19T07:05:00Z', 'Asia/Jakarta')).toBe('14:05');
    expect(formatTime('2026-10-19T17:30:00Z', 'Asia/Jakarta')).toBe('00:30');
    expect(formatTime('2026-10-19T07:05:00Z', 'Asia/Makassar')).toBe('15:05');
  });
  it('relatif', () => {
    const now = new Date('2026-10-19T10:00:00Z');
    expect(formatRelativeTime('2026-10-19T09:59:30Z', now)).toBe('baru saja');
    expect(formatRelativeTime('2026-10-19T09:58:00Z', now)).toBe('2 menit lalu');
    expect(formatRelativeTime('2026-10-19T07:00:00Z', now)).toBe('3 jam lalu');
    expect(formatRelativeTime('2026-10-17T10:00:00Z', now)).toBe('2 hari lalu');
  });
  it('durasi sesi', () => {
    expect(formatDuration(72 * 60_000)).toBe('1j 12m');
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(-5)).toBe('0m');
  });
});
