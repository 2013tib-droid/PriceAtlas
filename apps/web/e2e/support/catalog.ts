// Helper e2e M5 (Node, BUKAN kode klien): produk privat + record harga untuk alur merge/split lewat
// service role (sisi test saja, D-61). Migration, RPC, dan logika worker tidak diubah.
import { householdOf } from './captures';
import { jakartaDate } from './seed';
import { admin } from './supabase';

const AEON = '20000000-0000-0000-0000-000000000001';
const AEON_BSD = '30000000-0000-0000-0000-000000000001';

/** Produk PRIBADI household user + satu harga label (mis. "Milo 200 gr" yang dobel dengan katalog). */
export async function seedPrivateProduct(
  userId: string,
  p: { name: string; size: number; unit: string; price: number },
): Promise<string> {
  const db = admin();
  const hh = await householdOf(userId);
  const { data, error } = await db
    .from('product')
    .insert({ household_id: hh, name: p.name, content_size: p.size, content_unit: p.unit })
    .select('id')
    .single();
  if (error) throw error;
  const id = data.id as string;
  const { error: e2 } = await db.from('price_record').insert({
    household_id: hh,
    product_id: id,
    store_id: AEON,
    branch_id: AEON_BSD,
    source_type: 'price_label',
    transaction_date: jakartaDate(2),
    normal_price: p.price,
    effective_price: p.price,
    price_basis: 'normal',
  });
  if (e2) throw e2;
  return id;
}

/** Record harga produk milik household (untuk memeriksa hasil merge/split dari sisi server). */
export async function recordsOf(userId: string, productId: string): Promise<{ id: string }[]> {
  const hh = await householdOf(userId);
  const { data, error } = await admin()
    .from('price_record')
    .select('id')
    .eq('household_id', hh)
    .eq('product_id', productId);
  if (error) throw error;
  return data as { id: string }[];
}
