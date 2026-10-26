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

/** Baris `barcode_assignment` (S-15 edit, REST select + insert produk privat sendiri, D-89). */
export const BARCODE_ROW_COLUMNS = 'id,product_id,code,code_type,store_id,valid_from,valid_until';
export const BarcodeRowSchema = z.object({
  id: z.string(),
  product_id: z.string(),
  code: z.string(),
  code_type: z.enum(['gtin', 'plu']),
  store_id: z.string().nullable(),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
export type BarcodeRow = z.infer<typeof BarcodeRowSchema>;

/** Baris `profile` (S-19: REST select/PATCH `display_name`, docs/05 §3.3). */
export const PROFILE_ROW_COLUMNS = 'user_id,display_name,updated_at';
export const ProfileRowSchema = z.object({
  user_id: z.string(),
  display_name: z.string().nullable(),
  updated_at: z.string(),
});
export type ProfileRow = z.infer<typeof ProfileRowSchema>;
