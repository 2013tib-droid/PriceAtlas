// Satuan tampilan harga per satuan (U-20, wireframe §5.3): satuan dasar dimensi (g, ml, pcs, m);
// produk timbang per `content_unit` sebagai angka utama (Rp45.000/kg).
import { UNITS, type UnitCode } from '@priceatlas/contracts';

export interface UnitProduct {
  sale_mode: 'unit' | 'weight';
  content_unit: string;
  base_unit: string;
}

export function displayUnitPrice(product: UnitProduct, baseUnitPrice: number): { value: number; unit: string } {
  if (product.sale_mode === 'weight') {
    const f = UNITS[product.content_unit as UnitCode]?.toBaseFactor ?? 1;
    return { value: baseUnitPrice * f, unit: product.content_unit };
  }
  return { value: baseUnitPrice, unit: product.base_unit };
}

/** Kata satuan untuk "Paling hemat per gram", "per ml". */
export const PER_UNIT_WORD: Record<string, string> = {
  g: 'per gram',
  ml: 'per ml',
  pcs: 'per buah',
  m: 'per meter',
};
