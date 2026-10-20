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
