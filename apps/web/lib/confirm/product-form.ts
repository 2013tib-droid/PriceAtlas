// Skema form S-15 (docs/07 §4.2): DITURUNKAN dari CreatePrivateProductInput kontrak, ditambah pesan
// Indonesia. Nilai form (string dari input) diubah ke p_product W8 lalu divalidasi skema kontrak yang
// sama dengan rpcCall; isu kontrak dipetakan ke field form. Server tetap penentu (constraint + RPC).
import { CreatePrivateProductInput, UNITS, unitPrice, type RpcInput, type UnitCode } from '@priceatlas/contracts';
import { z } from 'zod';
import { NEW_PRODUCT_COPY as C } from '@/lib/copy/id';

const P = CreatePrivateProductInput.shape.p_product.shape;

/** Satuan dari kontrak (salinan public.unit). Timbang: satuan harga (per kg, per liter, …). */
export const UNIT_OPTIONS = Object.keys(UNITS) as UnitCode[];
export const WEIGHT_UNIT_OPTIONS: UnitCode[] = ['kg', 'g', 'l', 'ml', 'm'];

export const GTIN_RE = /^[0-9]{8,14}$/;

export const productFormSchema = z
  .object({
    name: z.string().trim().min(1, C.errors.name),
    variant: z.string(),
    brand: z.string(),
    groupMode: z.enum(['same', 'existing', 'new']),
    groupId: z.string(),
    groupName: z.string(),
    category_id: z.string(),
    sale_mode: P.sale_mode.unwrap(),
    pack_count: z.string(),
    content_size: z.string(),
    content_unit: P.content_unit.min(1, C.errors.unit),
    barcodes: z.array(z.object({ code: z.string() })),
  })
  .superRefine((v, ctx) => {
    if (v.sale_mode === 'unit') {
      const size = parseDecimal(v.content_size);
      if (size == null || size <= 0) ctx.addIssue({ code: 'custom', path: ['content_size'], message: C.errors.size });
      const n = Number(v.pack_count);
      if (!Number.isInteger(n) || n < 1)
        ctx.addIssue({ code: 'custom', path: ['pack_count'], message: C.errors.packCount });
    }
    v.barcodes.forEach((b, i) => {
      if (b.code.trim() && !GTIN_RE.test(b.code.trim()))
        ctx.addIssue({ code: 'custom', path: ['barcodes', i, 'code'], message: C.errors.barcode });
    });
    if (v.groupMode === 'new' && !v.groupName.trim())
      ctx.addIssue({ code: 'custom', path: ['groupName'], message: C.errors.groupName });
    if (v.groupMode === 'existing' && !v.groupId)
      ctx.addIssue({ code: 'custom', path: ['groupId'], message: C.errors.groupPick });
    // Validasi kontrak yang sama dengan rpcCall (isu yang lolos aturan di atas → field terkait).
    const parsed = CreatePrivateProductInput.safeParse({ p_product: toProductInput(v) });
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[1] ?? 'name');
        if (!['name', 'content_size', 'content_unit', 'pack_count', 'barcodes'].includes(field)) continue;
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: C.errors[field === 'barcodes' ? 'barcode' : field === 'name' ? 'name' : 'size'],
        });
      }
  });

export type ProductFormValues = z.input<typeof productFormSchema>;

/** "1,5" atau "1.5" → 1.5; kosong/bukan angka → null. */
export function parseDecimal(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function defaultProductForm(init: { name?: string; barcode?: string } = {}): ProductFormValues {
  return {
    name: init.name ?? '',
    variant: '',
    brand: '',
    groupMode: 'same',
    groupId: '',
    groupName: '',
    category_id: '',
    sale_mode: 'unit',
    pack_count: '1',
    content_size: '',
    content_unit: 'g',
    barcodes: [{ code: init.barcode ?? '' }],
  };
}

type ProductInput = RpcInput<'create_private_product'>['p_product'];

/** Nilai form → p_product W8 (docs/05 §3.3 S-15). */
export function toProductInput(v: ProductFormValues, id?: string): ProductInput {
  const unit = v.sale_mode === 'unit';
  const out: ProductInput = {
    name: v.name.trim(),
    variant: v.variant.trim() || null,
    sale_mode: v.sale_mode,
    pack_count: unit ? Math.max(1, Math.trunc(Number(v.pack_count) || 1)) : 1,
    content_size: unit ? parseDecimal(v.content_size) : null,
    content_unit: v.content_unit,
    category_id: v.category_id || null,
    barcodes: v.barcodes
      .map((b) => b.code.trim())
      .filter(Boolean)
      .map((code) => ({ code, code_type: 'gtin' as const })),
  };
  if (id) out.id = id;
  if (v.brand.trim()) out.brand = { new: v.brand.trim() };
  out.group =
    v.groupMode === 'existing' && v.groupId
      ? { id: v.groupId }
      : v.groupMode === 'new' && v.groupName.trim()
        ? { new: v.groupName.trim() }
        : 'same_as_name';
  return out;
}

/** Pratinjau harga per satuan dengan unitPrice() kontrak (rumus = SQL), mis. Rp10.000 → Rp50/g. */
export function previewUnitPrice(v: ProductFormValues, price: number): number | null {
  try {
    const size = parseDecimal(v.content_size);
    return unitPrice(
      {
        sale_mode: v.sale_mode,
        pack_count: v.sale_mode === 'unit' ? Math.max(1, Number(v.pack_count) || 1) : 1,
        content_size: v.sale_mode === 'unit' ? size : null,
        content_unit: v.content_unit,
      },
      price,
    );
  } catch {
    return null;
  }
}
