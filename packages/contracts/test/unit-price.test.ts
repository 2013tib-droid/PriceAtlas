import { describe, expect, it } from 'vitest';
import { BASE_UNIT, UNITS, pctVs, round, unitPrice } from '../src/index.ts';

describe('unitPrice (§5.4, D-17)', () => {
  it('Rp19.500 / 200 g = Rp97,5/g', () => {
    expect(unitPrice({ sale_mode: 'unit', pack_count: 1, content_size: 200, content_unit: 'g' }, 19500)).toBe(97.5);
  });
  it('multipack 10 × 35 g, Rp21.000 → Rp60/g', () => {
    expect(unitPrice({ sale_mode: 'unit', pack_count: 10, content_size: 35, content_unit: 'g' }, 21000)).toBe(60);
  });
  it('produk timbang Rp45.000/kg → Rp45/g', () => {
    expect(unitPrice({ sale_mode: 'weight', pack_count: 1, content_size: null, content_unit: 'kg' }, 45000)).toBe(45);
  });
  it('liter → per ml', () => {
    expect(unitPrice({ sale_mode: 'unit', pack_count: 1, content_size: 1.5, content_unit: 'l' }, 18000)).toBe(12);
  });
  it('presisi 6 desimal seperti numeric(18,6)', () => {
    expect(unitPrice({ sale_mode: 'unit', pack_count: 1, content_size: 180, content_unit: 'ml' }, 6000)).toBe(33.333333);
  });
  it('kemasan tanpa ukuran ditolak', () => {
    expect(() => unitPrice({ sale_mode: 'unit', pack_count: 1, content_size: null, content_unit: 'g' }, 1)).toThrow();
  });
  it('satuan tidak dikenal ditolak', () => {
    expect(() => unitPrice({ sale_mode: 'unit', pack_count: 1, content_size: 1, content_unit: 'ons' }, 1)).toThrow();
  });
  it('satuan dasar per dimensi', () => {
    expect(BASE_UNIT[UNITS.kg.dimension]).toBe('g');
    expect(BASE_UNIT[UNITS.l.dimension]).toBe('ml');
  });
  it('pembulatan half-away-from-zero', () => {
    expect(round(2.675, 2)).toBe(2.68);
    expect(round(-2.675, 2)).toBe(-2.68);
    expect(pctVs(95, 90)).toBe(5.6);
  });
});
