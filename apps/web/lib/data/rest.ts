// REST langsung (docs/05 §3.2 daftar "REST langsung", §3.3 S-01). Tipe dari packages/db-types.
// Hanya baca di M1; RLS menyaring household.
import type { Database } from '@priceatlas/db-types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { fromRpcError, toAppError } from './errors';

const VALIDATE_OUTPUT = process.env.NODE_ENV !== 'production';

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

export const RECENT_PRICES_LIMIT = 10;

function client(): SupabaseClient<Database> {
  return getSupabaseBrowserClient() as unknown as SupabaseClient<Database>;
}

/** `price_record_view?select=…&status=eq.active&order=transaction_date.desc,created_at.desc&limit=10` */
export async function fetchRecentPrices(): Promise<RecentPrice[]> {
  let res;
  try {
    res = await client()
      .from('price_record_view')
      .select('id,product_id,transaction_date,effective_price,price_basis,store_name')
      .eq('status', 'active')
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(RECENT_PRICES_LIMIT);
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error) throw fromRpcError(res.error);
  const rows = res.data ?? [];
  if (!VALIDATE_OUTPUT) return rows as RecentPrice[];
  return z.array(RecentPriceSchema).parse(rows);
}

/** Badge "perlu dicek" (S-01): `capture?status=eq.needs_confirmation`, head + count=exact. */
export async function fetchNeedsCheckCount(): Promise<number> {
  let res;
  try {
    res = await client()
      .from('capture')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'needs_confirmation');
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error) throw fromRpcError(res.error);
  return res.count ?? 0;
}
