// L5a M1: logika murni (Cek harga rak, keypad, format, pengelompokan hasil, prefs, grafik).
import { describe, expect, it } from 'vitest';
import type { ChartPoint, CompareSizesRow, ProductCard, ProductDetail } from '@priceatlas/contracts';
import { groupBests, groupResults } from '@/components/product/group-header';
import { chartGeometry } from '@/features/product/price-chart';
import { sizeSections } from '@/features/sizes/size-rows';
import { normalizeQuery } from '@/lib/data/queries';
import { formatAge, formatMonthYear, formatQuantity, formatSize } from '@/lib/format';
import { productTitle } from '@/lib/format/product';
import { displayUnitPrice } from '@/lib/format/unit';
import { pushRecentSearch, pushViewed, RECENT_SEARCHES_MAX, VIEWED_MAX } from '@/lib/offline/prefs';
import { checkShelfPrice, keypadInput } from '@/lib/shelf';
import { FIX, fx, ID } from './harness';

const detail = (k: string) => fx<ProductDetail>(k);

describe('Cek harga rak (D-55)', () => {
  const sizes = fx<CompareSizesRow[]>('sizes_milo_90d');
  it('lebih murah / mendekati ≤ 5% / lebih mahal terhadap termurah 90 hari', () => {
    const d = detail('detail_milo200');
    expect(checkShelfPrice({ detail: d, price: 17000, nearPct: 5 })!.best!.verdict).toBe('cheaper');
    expect(checkShelfPrice({ detail: d, price: 18000, nearPct: 5 })!.best!.verdict).toBe('near');
    expect(checkShelfPrice({ detail: d, price: 18900, nearPct: 5 })!.best).toMatchObject({ verdict: 'near', pct: 5 });
    expect(checkShelfPrice({ detail: d, price: 18920, nearPct: 5 })!.best!.verdict).toBe('pricier');
  });
  it('harga terakhir dan ukuran lain yang lebih hemat per satuan (dimensi sama saja)', () => {
    const r = checkShelfPrice({ detail: detail('detail_milo200'), price: 25000, nearPct: 5, sizes })!;
    expect(r.unit).toBe(125);
    expect(r.last!.pct).toBe(28.2);
    expect(r.otherSize!.row.product.id).toBe(ID.milo500);
    expect(Math.round(r.otherSize!.savingPct)).toBe(24);
  });
  it('hanya sepanjang masa: dibandingkan dengan best_all', () => {
    const r = checkShelfPrice({ detail: detail('detail_milo3in1'), price: 30000, nearPct: 5 })!;
    expect(r.best).toMatchObject({ window: 'all', verdict: 'cheaper' });
  });
  it('tanpa data: hanya harga per satuan', () => {
    const r = checkShelfPrice({ detail: detail('detail_milo1kg'), price: 120000, nearPct: 5 })!;
    expect(r).toMatchObject({ unit: 120, best: null, last: null, otherSize: null });
  });
  it('produk timbang: harga per kg', () => {
    expect(checkShelfPrice({ detail: detail('detail_jeruk'), price: 45000, nearPct: 5 })!.unit).toBe(45);
  });
  it('harga 0 tidak dihitung', () => {
    expect(checkShelfPrice({ detail: detail('detail_milo200'), price: 0, nearPct: 5 })).toBeNull();
  });
  it('keypad: digit, 000, hapus, nol di depan, maks 9 digit', () => {
    expect(keypadInput('', '0')).toBe('');
    expect(keypadInput('', '000')).toBe('');
    expect(keypadInput('19', '000')).toBe('19000');
    expect(keypadInput('19000', 'back')).toBe('1900');
    expect(keypadInput('123456789', '1')).toBe('123456789');
    expect(keypadInput('12', 'clear')).toBe('');
    expect(keypadInput('12', 'x')).toBe('12');
  });
});

describe('format M1 (§10.3)', () => {
  it('ukuran, multipack, timbang; judul tanpa varian ganda', () => {
    const p = { sale_mode: 'unit' as const, pack_count: 10, content_size: 35, content_unit: 'g' };
    expect(formatSize(p)).toBe('10 × 35 g');
    expect(formatSize({ ...p, pack_count: 1, content_size: 0.5, content_unit: 'kg' })).toBe('0,5 kg');
    expect(formatSize({ ...p, sale_mode: 'weight', content_size: null, content_unit: 'kg' })).toBe('per kg');
    expect(productTitle({ ...p, name: 'Milo 3in1', variant: '10 x 35 g' })).toEqual({
      title: 'Milo 3in1',
      size: '10 × 35 g',
    });
    expect(productTitle({ ...p, pack_count: 1, name: 'Teh', variant: 'Melati' }).title).toBe('Teh Melati');
    expect(formatQuantity(0.535, 'kg')).toBe('0,535 kg');
  });
  it('umur data dan bulan-tahun dari string date (tanpa geser zona)', () => {
    const now = new Date('2026-10-20T05:00:00Z');
    expect(formatAge('2026-10-17', 'Asia/Jakarta', now)).toBe('3 hari lalu');
    expect(formatAge('2026-10-05', 'Asia/Jakarta', now)).toBe('15 hari lalu');
    expect(formatAge('2026-05-23', 'Asia/Jakarta', now)).toBe('5 bln lalu');
    expect(formatAge('2024-01-01', 'Asia/Jakarta', now)).toBe('2 thn lalu');
    expect(formatMonthYear('2026-03-01')).toBe('Mar 2026');
  });
  it('satuan tampilan: dasar, atau per content_unit untuk produk timbang (U-20)', () => {
    expect(displayUnitPrice({ sale_mode: 'unit', content_unit: 'kg', base_unit: 'g' }, 14.6)).toEqual({
      value: 14.6,
      unit: 'g',
    });
    expect(displayUnitPrice({ sale_mode: 'weight', content_unit: 'kg', base_unit: 'g' }, 45)).toEqual({
      value: 45000,
      unit: 'kg',
    });
  });
  it('kata kunci dinormalkan seperti app.normalize_text (spasi)', () => {
    expect(normalizeQuery('  milo   3in1 ')).toBe('milo 3in1');
  });
});

describe('pengelompokan (U-03, S-04)', () => {
  it('hasil R3 per Product Group, urutan server; produk tanpa group sendiri', () => {
    const cards = [...fx<ProductCard[]>('search_milo'), ...fx<ProductCard[]>('search_gula')];
    const sections = groupResults(cards);
    expect(sections.map((s) => s.group?.name ?? null)).toEqual(['Milo Original', null]);
    expect(sections[0]!.cards).toHaveLength(5);
  });
  it('termurah per dimensi dari best_by_dimension', () => {
    const bests = groupBests(fx<ProductCard[]>('search_milo'));
    expect(bests.map((b) => [b.dimension, b.size, b.unitPrice])).toEqual([
      ['mass', '200 g', 90],
      ['volume', '180 ml', 33.333333],
    ]);
  });
  it('R11 per dimensi + mata uang', () => {
    expect(sizeSections(fx<CompareSizesRow[]>('sizes_milo_90d')).map((s) => [s.dimension, s.rows.length])).toEqual([
      ['mass', 4],
      ['volume', 1],
    ]);
  });
});

describe('prefs (💾)', () => {
  it('pencarian terakhir: terbaru di depan, tanpa duplikat, maks 8', () => {
    let l: string[] = [];
    for (const q of ['milo', 'indomie', 'MILO', ' m ', ...'abcdefghij'.split('').map((c) => `${c}${c}`)])
      l = pushRecentSearch(l, q);
    expect(l).toHaveLength(RECENT_SEARCHES_MAX);
    expect(l[0]).toBe('jj');
    expect(l.filter((x) => x.toLowerCase() === 'milo')).toHaveLength(0);
    expect(pushRecentSearch(['milo'], 'MILO')).toEqual(['MILO']);
  });
  it('baru dicek: cap 150 (R5 p_viewed_ids)', () => {
    let l: string[] = [];
    for (let i = 0; i < 160; i++) l = pushViewed(l, String(i));
    expect(l).toHaveLength(VIEWED_MAX);
    expect(pushViewed(['a', 'b'], 'b')).toEqual(['b', 'a']);
  });
});

describe('grafik SVG (D-80)', () => {
  it('x menurut hari kalender, y terbalik (harga tinggi di atas), garis termurah', () => {
    const pts = fx<ChartPoint[]>('chart_milo200');
    const g = chartGeometry(pts, 90);
    expect(g.points[0]!.x).toBeLessThan(g.points[g.points.length - 1]!.x);
    const hi = g.points.reduce((a, b) => (b.p.unit_price > a.p.unit_price ? b : a));
    const lo = g.points.reduce((a, b) => (b.p.unit_price < a.p.unit_price ? b : a));
    expect(hi.y).toBeLessThan(lo.y);
    expect(g.bestY).toBe(lo.y);
  });
  it('satu titik: tetap tergambar di tengah', () => {
    const g = chartGeometry([{ date: FIX.today, unit_price: 10, price_basis: 'normal', record_id: ID.milo200 }], null);
    expect(Number.isFinite(g.points[0]!.x) && Number.isFinite(g.points[0]!.y)).toBe(true);
  });
});
