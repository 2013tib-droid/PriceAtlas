// Data harga e2e (docs/07 §11.3 alur 1–2). supabase/seed.sql hanya berisi katalog; histori harga
// milik household user e2e ditambahkan di sini lewat service role (proses test saja, BUKAN kode
// klien, D-61). Migration tidak diubah.
import { admin } from './supabase';

export const P = {
  milo200: '70000000-0000-0000-0000-000000000200',
  milo500: '70000000-0000-0000-0000-000000000500',
} as const;
const AEON = '20000000-0000-0000-0000-000000000001';
const ALFAMART = '20000000-0000-0000-0000-000000000002';
const AEON_BSD = '30000000-0000-0000-0000-000000000001';

/** Tanggal kalender `daysAgo` hari sebelum hari ini di Asia/Jakarta (zona household default). */
export function jakartaDate(daysAgo: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * Milo Original 200 g: 5 data, tren turun (3 data di 30 hari terakhir, 2 di 30 hari sebelumnya),
 * termurah 90 hari Rp18.000 PROMO di Alfamart tanpa cabang (D-28). Milo 500 g: 1 data (tren belum cukup).
 */
export async function seedMiloPrices(userId: string): Promise<void> {
  const db = admin();
  const { data: member, error: e1 } = await db
    .from('household_member')
    .select('household_id')
    .eq('user_id', userId)
    .single();
  if (e1) throw e1;
  const hh = member.household_id as string;
  const row = (
    product: string,
    store: string,
    branch: string | null,
    daysAgo: number,
    normal: number,
    promo: number | null = null,
  ) => ({
    household_id: hh,
    product_id: product,
    store_id: store,
    branch_id: branch,
    source_type: 'price_label',
    transaction_date: jakartaDate(daysAgo),
    normal_price: normal,
    promo_price: promo,
    effective_price: promo ?? normal,
    price_basis: promo ? 'promo' : 'normal',
  });
  const { error: e2 } = await db
    .from('price_record')
    .insert([
      row(P.milo200, AEON, AEON_BSD, 3, 19500),
      row(P.milo200, ALFAMART, null, 10, 19500, 18000),
      row(P.milo200, AEON, AEON_BSD, 20, 20000),
      row(P.milo200, AEON, AEON_BSD, 40, 21000),
      row(P.milo200, AEON, AEON_BSD, 45, 21000),
      row(P.milo500, AEON, AEON_BSD, 5, 47500),
    ]);
  if (e2) throw e2;

  // Ringkasan dihitung antrean pg_cron tiap 10 dtk (D-31, migration 0900). Tunggu sampai siap.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { data } = await db.from('price_summary').select('product_id,record_count').eq('household_id', hh);
    const n = new Map((data ?? []).map((r) => [r.product_id as string, r.record_count as number]));
    if (n.get(P.milo200) === 5 && n.get(P.milo500) === 1) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('price_summary belum diperbarui dalam 60 dtk (pg_cron summary-queue)');
}
