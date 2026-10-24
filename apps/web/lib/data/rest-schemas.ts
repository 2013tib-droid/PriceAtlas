// Skema baris REST (tanpa import klien Supabase, dipakai juga fixture test).
import { z } from 'zod';

/** Baris "Harga baru masuk" (S-01) dari `price_record_view`. */
export const RecentPriceSchema = z.object({
  id: z.string(),
  product_id: z.string(),
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effective_price: z.number(),
  price_basis: z.enum(['normal', 'promo', 'member']),
  store_name: z.string(),
});
export type RecentPrice = z.infer<typeof RecentPriceSchema>;

/**
 * Baris `product` untuk S-15 edit / S-17 "Pindahkan ke group" (REST PATCH produk privat sendiri,
 * docs/05 §3.2–§3.3): `updated_at` dipakai sebagai filter PATCH (0 baris = STALE_WRITE).
 */
export const PRODUCT_ROW_COLUMNS =
  'id,household_id,name,variant,brand_id,product_group_id,category_id,sale_mode,pack_count,content_size,content_unit,status,updated_at';
export const ProductRowSchema = z.object({
  id: z.string(),
  household_id: z.string().nullable(),
  name: z.string(),
  variant: z.string().nullable(),
  brand_id: z.string().nullable(),
  product_group_id: z.string().nullable(),
  category_id: z.string().nullable(),
  sale_mode: z.enum(['unit', 'weight']),
  pack_count: z.number(),
  content_size: z.number().nullable(),
  content_unit: z.string(),
  status: z.enum(['active', 'merged', 'archived']),
  updated_at: z.string(),
});
export type ProductRow = z.infer<typeof ProductRowSchema>;
