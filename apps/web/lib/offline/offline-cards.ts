// Cache produk offline (D-60, docs/07 §5.6, W-22): kartu R5 `get_offline_cache` disimpan di store
// `offline_cards` (IndexedDB per user, §5.3) dan dicari di klien saat offline. Isi = ProductCard
// (ringkasan harga), bukan isi struk atau detail record (P-13/P-14). Keluar/hapus akun menghapus
// database user; `openUserDb` menolak user yang dikunci (lockUserDb, F-81), sehingga sinkron yang
// masih berjalan tidak membuat ulang database.
import type { ProductCard } from '@priceatlas/contracts';
import { openUserDb } from './db';

/** R5 `p_top`: 50 produk dengan data terbanyak (§5.6). */
export const OFFLINE_TOP = 50;
/** Sinkron ulang saat app dibuka jika sinkron terakhir lebih dari 6 jam (§5.6). */
export const OFFLINE_SYNC_MS = 6 * 60 * 60_000;

/**
 * Normalisasi pencocokan offline (§5.6): seperti `app.normalize_text` (huruf kecil, spasi tunggal)
 * ditambah tanpa diakritik ("Café" = "cafe").
 */
export function normalizeForMatch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Teks yang dicari, sama dengan R3: nama + varian (`product.search_text`) + nama brand. */
export function cardSearchText(card: ProductCard): string {
  const p = card.product;
  return normalizeForMatch([p.name, p.variant ?? '', p.brand_name ?? ''].join(' '));
}

/**
 * Pencocokan kata (§5.6): setiap kata kunci harus ada di teks kartu. Produk arsip/merged disaring
 * (R5 memuat produk arsip yang pernah dibuka; R3 tidak). Urutan seperti R3 (D-53): yang punya data
 * dulu, lalu kata yang cocok di awal kata, lalu nama.
 */
export function matchOfflineCards(cards: readonly ProductCard[], query: string): ProductCard[] {
  const words = normalizeForMatch(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const hits: { card: ProductCard; starts: number; text: string }[] = [];
  for (const card of cards) {
    if (card.product.status !== 'active') continue;
    const text = cardSearchText(card);
    if (!words.every((w) => text.includes(w))) continue;
    const tokens = text.split(' ');
    const starts = words.filter((w) => tokens.some((t) => t.startsWith(w))).length;
    hits.push({ card, starts, text });
  }
  return hits
    .sort(
      (a, b) =>
        Number(b.card.summary != null) - Number(a.card.summary != null) ||
        b.starts - a.starts ||
        a.text.localeCompare(b.text, 'id') ||
        a.card.product.id.localeCompare(b.card.product.id),
    )
    .map((h) => h.card);
}

/** Ganti seluruh isi `offline_cards` dengan hasil R5 terbaru (satu transaksi). */
export async function replaceOfflineCards(userId: string, cards: readonly ProductCard[], syncedAt: number) {
  const db = await openUserDb(userId);
  const tx = db.transaction('offline_cards', 'readwrite');
  await tx.store.clear();
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.product.id)) continue;
    seen.add(card.product.id);
    await tx.store.put({ id: card.product.id, card, synced_at: syncedAt });
  }
  await tx.done;
}

export async function readOfflineCards(userId: string): Promise<ProductCard[]> {
  try {
    const db = await openUserDb(userId);
    return (await db.getAll('offline_cards')).map((r) => r.card as ProductCard);
  } catch {
    // IndexedDB tidak tersedia / user dikunci: tidak ada cache offline.
    return [];
  }
}

/** Kartu tersimpan untuk id ini (urutan id dipertahankan; id tanpa kartu dilewati). */
export async function readOfflineCardsByIds(userId: string, ids: readonly string[]): Promise<ProductCard[]> {
  const byId = new Map((await readOfflineCards(userId)).map((c) => [c.product.id, c]));
  return ids.flatMap((id) => {
    const c = byId.get(id);
    return c ? [c] : [];
  });
}
