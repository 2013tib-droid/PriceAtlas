// S-15 mode edit (`/produk/edit?id=`, docs/07 §7.3, docs/05 §3.3 S-15): REST PATCH produk privat
// sendiri dengan filter updated_at (0 baris = STALE_WRITE). Skema form DITURUNKAN dari
// CreatePrivateProductInput kontrak (field + aturan ukuran yang sama dengan S-15 baru, §4.2), lalu nilai
// form diubah ke kolom `product` yang berubah saja. Mengubah ukuran membuat trigger
// `product_size_changed` menghitung ulang harga per satuan semua record (job recompute_unit_price).
// Logika tanpa React supaya diuji unit (L5a).
import { CreatePrivateProductInput } from '@priceatlas/contracts';
import { z } from 'zod';
import { parseDecimal } from '@/lib/confirm/product-form';
import { NEW_PRODUCT_COPY as C } from '@/lib/copy/id';
import type { ProductRow } from '@/lib/data/rest-schemas';

const P = CreatePrivateProductInput.shape.p_product.shape;

export const productEditSchema = z
  .object({
    name: P.name.trim().min(1, C.errors.name),
    variant: z.string(),
    category_id: z.string(),
    brand_id: z.string(),
    product_group_id: z.string(),
    sale_mode: P.sale_mode.unwrap(),
    pack_count: z.string(),
    content_size: z.string(),
    content_unit: P.content_unit.min(1, C.errors.unit),
  })
  .superRefine((v, ctx) => {
    if (v.sale_mode !== 'unit') return;
    const size = parseDecimal(v.content_size);
    // Aturan kontrak yang sama dengan W8 (content_size positif, pack_count bilangan bulat ≥ 1).
    if (!P.content_size.safeParse(size).success || size == null)
      ctx.addIssue({ code: 'custom', path: ['content_size'], message: C.errors.size });
    if (!P.pack_count.safeParse(Number(v.pack_count)).success)
      ctx.addIssue({ code: 'custom', path: ['pack_count'], message: C.errors.packCount });
  });

export type ProductEditValues = z.input<typeof productEditSchema>;

/** Kolom `product` yang boleh diubah dari S-15 edit (PATCH produk privat, RLS). */
export type ProductPatch = Partial<
  Pick<
    ProductRow,
    | 'name'
    | 'variant'
    | 'category_id'
    | 'brand_id'
    | 'product_group_id'
    | 'sale_mode'
    | 'pack_count'
    | 'content_size'
    | 'content_unit'
    | 'status'
  >
>;

export function editFormFrom(row: ProductRow): ProductEditValues {
  return {
    name: row.name,
    variant: row.variant ?? '',
    category_id: row.category_id ?? '',
    brand_id: row.brand_id ?? '',
    product_group_id: row.product_group_id ?? '',
    sale_mode: row.sale_mode,
    pack_count: String(row.pack_count),
    content_size: row.content_size == null ? '' : String(row.content_size).replace('.', ','),
    content_unit: row.content_unit,
  };
}

/** Nilai form → kolom yang berubah (produk timbang: pack_count 1, content_size null). */
export function toProductPatch(v: ProductEditValues, row: ProductRow): ProductPatch {
  const unit = v.sale_mode === 'unit';
  const next: ProductPatch = {
    name: v.name.trim(),
    variant: v.variant.trim() || null,
    category_id: v.category_id || null,
    brand_id: v.brand_id || null,
    product_group_id: v.product_group_id || null,
    sale_mode: v.sale_mode,
    pack_count: unit ? Math.max(1, Math.trunc(Number(v.pack_count) || 1)) : 1,
    content_size: unit ? parseDecimal(v.content_size) : null,
    content_unit: v.content_unit,
  };
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(next)) if (val !== row[k as keyof ProductRow]) out[k] = val;
  return out as ProductPatch;
}

/** Ukuran berubah → "Harga per satuan semua data produk ini akan dihitung ulang" (wireframe S-15). */
export function sizeChanged(patch: ProductPatch): boolean {
  return ['sale_mode', 'pack_count', 'content_size', 'content_unit'].some((k) => k in patch);
}

/**
 * STALE_WRITE (PATCH 0 baris): isian dibentuk ulang dari baris terbaru, lalu perubahan user yang masih
 * berbeda dari baris terbaru diterapkan lagi (sama dengan S-16).
 */
export function reapplyProductEdits(
  latest: ProductRow,
  userValues: ProductEditValues,
  original: ProductRow,
): { values: ProductEditValues; changed: (keyof ProductEditValues)[] } {
  const base = editFormFrom(latest);
  const before = editFormFrom(original);
  const values = { ...base };
  const changed: (keyof ProductEditValues)[] = [];
  for (const k of Object.keys(base) as (keyof ProductEditValues)[]) {
    if (userValues[k] !== before[k] && userValues[k] !== base[k]) {
      (values as Record<string, unknown>)[k] = userValues[k];
      changed.push(k);
    }
  }
  return { values, changed };
}

/** Produk yang bisa diedit/diarsipkan dari UI: privat milik sendiri dan aktif (D-29, D-30, D-38). */
export function canEditProduct(row: Pick<ProductRow, 'household_id' | 'status'>): boolean {
  return row.household_id != null && row.status === 'active';
}
