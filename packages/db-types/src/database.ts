// Tipe database hasil `supabase gen types typescript --local --schema public`
// (docs/05 §1.5). BELUM dibangkitkan di Tahap 4b: butuh Supabase CLI + Docker (mode B),
// yang tidak tersedia di lingkungan build ini. Jalankan:
//   pnpm --filter @priceatlas/db-types gen
// setelah `supabase start` (lihat docs/06-local-dev.md). Sampai saat itu, kontrak
// input/output RPC yang dipakai kode ada di @priceatlas/contracts (zod).
export type Database = Record<string, never>;
