// S-20 Tanya, kerangka (docs/07 §9, wireframe S-20, D-57). Tahap 5 hanya bentuk jawaban dan
// tautan ke layar sumber; pengiriman pertanyaan (`POST /api/ask`, packages/ai-tools) di Tahap 6.
// Nama tool sama dengan packages/ai-tools (dicek test M7), tanpa dependensi ke paket itu.
export const ASK_TOOLS = [
  'cari_harga_terbaik',
  'tren_harga',
  'harga_per_satuan',
  'bandingkan_ukuran',
  'lebih_hemat_di_mana',
  'histori_harga',
] as const;
export type AskTool = (typeof ASK_TOOLS)[number];

/** Rujukan layar sumber (bentuk `layar` di keluaran packages/ai-tools). */
export type AskScreenRef =
  | { id: 'S-02'; kata_kunci: string }
  | { id: 'S-03'; produk_id: string }
  | { id: 'S-04'; product_group_id: string }
  | { id: 'S-05'; produk_id?: string | null; product_group_id?: string | null };

export type AskToolRef = { name: AskTool; arg?: string | null };

/** Keadaan balasan S-20 (wireframe): jawaban, di luar kemampuan, data kurang, ambigu, memuat. */
export type AskReply =
  | { kind: 'loading' }
  | { kind: 'coming_soon' }
  | { kind: 'out_of_scope' }
  | { kind: 'answer'; text: string; basis: string; tool: AskToolRef; screen?: AskScreenRef | null }
  | { kind: 'not_enough'; text: string; tool: AskToolRef; screen?: AskScreenRef | null }
  | { kind: 'ambiguous'; options: { label: string; question: string }[] };

export const ASK_MAX_LENGTH = 200;

export function askHref(q?: string | null): string {
  const t = q?.trim();
  return t ? `/tanya?q=${encodeURIComponent(t)}` : '/tanya';
}

/** "bandingkan_ukuran(Milo Original)" (wireframe "Dijawab dengan: …"). */
export function toolLabel(tool: AskToolRef): string {
  return `${tool.name}(${tool.arg ?? ''})`;
}

/** Tautan ke layar sumber; null jika rujukan tidak lengkap. */
export function screenHref(ref: AskScreenRef): string | null {
  switch (ref.id) {
    case 'S-02':
      return ref.kata_kunci.trim() ? `/cari?q=${encodeURIComponent(ref.kata_kunci.trim())}` : null;
    case 'S-03':
      return `/produk?id=${encodeURIComponent(ref.produk_id)}`;
    case 'S-04':
      return `/produk/ukuran?group=${encodeURIComponent(ref.product_group_id)}`;
    case 'S-05':
      if (ref.produk_id) return `/produk/hemat?id=${encodeURIComponent(ref.produk_id)}`;
      if (ref.product_group_id) return `/produk/hemat?group=${encodeURIComponent(ref.product_group_id)}`;
      return null;
  }
}

/** Contoh pertanyaan (chip) digabung dengan kata kunci cari: "milo" + "termurah di mana?". */
export function exampleQuestion(subject: string | null | undefined, example: string): string {
  const s = subject?.trim();
  return s ? `${s} ${example}` : example;
}
