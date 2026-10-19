// Tools AI (docs/05 §6, D-05, D-57). Belum disambungkan ke Claude (Tahap 6).
// Prinsip:
//   * Setiap tool memetakan ke RPC BACA di §3, dipanggil dengan JWT user. RLS membatasi
//     data; tool tidak menambahkan filter household.
//   * Parameter divalidasi zod. Teks bebas hanya `kata_kunci` (≤ 100 karakter), diteruskan
//     sebagai parameter RPC, tidak pernah disisipkan ke query. Tidak ada SQL bebas.
//   * Tidak ada tool tulis.
//   * Setiap output memuat jumlah_data, tanggal_terakhir, dan layar (tautan layar sumber, U-18).
import { z } from 'zod';
import {
  BASE_UNIT,
  ProductCardSchema,
  ProductDetailSchema,
  PriceTrendSchema,
  CompareSizesRowSchema,
  WhereCheaperRowSchema,
  PriceRecordViewSchema,
  parseRpcError,
  pctVs,
  round,
  unitPrice,
  type ProductCard,
  type RpcClient,
  type RpcError,
} from '@priceatlas/contracts';

const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'harus UUID');

/** RPC yang boleh dipanggil tools (semua baca, D-57). */
export const TOOL_RPCS = [
  'search_products', 'get_product_detail', 'get_product_cards', 'price_trend', 'compare_sizes',
  'where_cheaper', 'price_history', 'get_client_config',
] as const;

export class ToolError extends Error {
  constructor(
    readonly kode: string,
    message: string,
    readonly rpc?: RpcError,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

async function call<T>(client: RpcClient, fn: (typeof TOOL_RPCS)[number], args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const e = parseRpcError(error);
    throw new ToolError(e.code ?? e.sqlstate ?? 'RPC_ERROR', e.code === 'NOT_FOUND' ? 'Data tidak ditemukan.' : e.hint ?? e.message, e);
  }
  return schema.parse(data);
}

// ---------------------------------------------------------------------------
// Format bersama
// ---------------------------------------------------------------------------
type Lite = ProductCard['product'];

function ukuran(p: Lite): string {
  if (p.sale_mode === 'weight') return `per ${p.content_unit}`;
  const size = `${p.content_size} ${p.content_unit}`;
  return p.pack_count > 1 ? `${p.pack_count} × ${size}` : size;
}

function produk(p: Lite) {
  return { id: p.id, nama: p.name, varian: p.variant, merek: p.brand_name, ukuran: ukuran(p), privat: p.is_private };
}

function label(basis: string, program: string | null | undefined): string {
  return basis === 'member' ? `member${program ? ` (${program})` : ''}` : basis;
}

const NO_BRANCH = 'cabang tidak diketahui';

function pricePoint(pp: NonNullable<NonNullable<ProductCard['summary']>['best_all']> | null, base: string) {
  if (!pp) return null;
  return {
    harga: pp.effective_price,
    label: label(pp.price_basis, pp.member_program_name),
    per_satuan: round(pp.unit_price, 2),
    satuan: base,
    toko: pp.store.name,
    cabang: pp.branch?.name ?? NO_BRANCH,
    tanggal: pp.date,
  };
}

const DIRECTION = { up: 'naik', down: 'turun', flat: 'stabil' } as const;

// ---------------------------------------------------------------------------
// Definisi tools
// ---------------------------------------------------------------------------
export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: S;
  handler(client: RpcClient, input: z.infer<S>): Promise<unknown>;
}

function tool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

const cariHargaTerbaik = tool({
  name: 'cari_harga_terbaik',
  description:
    'Harga termurah produk dari histori pribadi user: terbaik 90 hari (utama) dan sepanjang masa (pembanding), ' +
    'dengan label promo/normal/member, toko, dan cabang. Isi salah satu: kata_kunci atau produk_id. ' +
    'Jika hasil lebih dari satu, tanyakan ke user produk mana yang dimaksud.',
  inputSchema: z
    .object({
      kata_kunci: z.string().trim().min(2).max(100).optional(),
      produk_id: Uuid.optional(),
      batas: z.number().int().min(1).max(10).default(5),
    })
    .strict()
    .refine((x) => (x.kata_kunci == null) !== (x.produk_id == null), 'Isi salah satu: kata_kunci atau produk_id'),
  async handler(client, input) {
    let cards: ProductCard[];
    if (input.produk_id) {
      const d = await call(client, 'get_product_detail', { p_product_id: input.produk_id }, ProductDetailSchema);
      cards = [d.card];
    } else {
      cards = await call(client, 'search_products', { p_query: input.kata_kunci, p_limit: input.batas }, z.array(ProductCardSchema));
    }
    return cards.slice(0, input.batas).map((c) => {
      const base = c.product.base_unit;
      return {
        produk: produk(c.product),
        terbaik_90_hari: pricePoint(c.summary?.best_90d ?? null, base),
        terbaik_sepanjang_masa: pricePoint(c.summary?.best_all ?? null, base),
        harga_member_tidak_dihitung: c.hints.member_not_counted
          ? { harga: c.hints.member_not_counted.member_price, program: c.hints.member_not_counted.program_name }
          : null,
        jumlah_data: c.summary?.record_count ?? 0,
        tanggal_terakhir: c.summary?.last_transaction_date ?? null,
        layar: { id: 'S-03', produk_id: c.product.id },
      };
    });
  },
});

const trenHarga = tool({
  name: 'tren_harga',
  description:
    'Apakah harga produk naik atau turun: rata-rata harga per satuan 30 hari terakhir vs 30 hari sebelumnya. ' +
    'arah = null berarti data belum cukup; sebutkan jumlah data dan tanggal data terakhir.',
  inputSchema: z.object({ produk_id: Uuid, hanya_normal: z.boolean().default(false) }).strict(),
  async handler(client, input) {
    const t = await call(client, 'price_trend', { p_product_id: input.produk_id, p_normal_only: input.hanya_normal }, PriceTrendSchema);
    return {
      arah: t.direction ? DIRECTION[t.direction] : null,
      persen: t.pct,
      rata2_30_hari: t.cur_avg == null ? null : round(t.cur_avg, 2),
      rata2_30_hari_sebelumnya: t.prev_avg == null ? null : round(t.prev_avg, 2),
      data_jendela_ini: t.cur_n,
      data_jendela_sebelumnya: t.prev_n,
      minimal_data_per_jendela: t.min_records_per_window,
      hanya_harga_normal: input.hanya_normal,
      label: t.label,
      jumlah_data: t.record_count,
      tanggal_terakhir: t.last_date,
      layar: { id: 'S-03', produk_id: input.produk_id },
    };
  },
});

const hargaPerSatuan = tool({
  name: 'harga_per_satuan',
  description:
    'Harga per satuan dasar (per gram/ml/pcs/meter) produk dari histori pribadi. Jika harga_rak diisi, hitung ' +
    'harga per satuannya dan bandingkan dengan harga terbaik 90 hari (tanpa menyimpan apa pun).',
  inputSchema: z.object({ produk_id: Uuid, harga_rak: z.number().positive().max(1e9).optional() }).strict(),
  async handler(client, input) {
    const d = await call(client, 'get_product_detail', { p_product_id: input.produk_id }, ProductDetailSchema);
    const p = d.card.product;
    const s = d.card.summary;
    const best = s?.best_90d?.unit_price ?? null;
    const out: Record<string, unknown> = {
      produk: produk(p),
      satuan_dasar: BASE_UNIT[p.dimension],
      terbaik_90_hari_per_satuan: best == null ? null : round(best, 2),
      terakhir_per_satuan: s ? round(s.last_unit_price, 2) : null,
      jumlah_data: s?.record_count ?? 0,
      tanggal_terakhir: s?.last_transaction_date ?? null,
      layar: { id: 'S-03b', produk_id: p.id },
    };
    if (input.harga_rak != null) {
      const cfg = await call(client, 'get_client_config', {}, z.record(z.string(), z.unknown()));
      const threshold = Number(cfg.near_best_threshold_pct ?? 5);
      const rak = unitPrice(p, input.harga_rak);
      out.harga_rak_per_satuan = round(rak, 2);
      if (best != null) {
        out.selisih_persen_vs_terbaik = pctVs(rak, best);
        out.mendekati_terbaik = (out.selisih_persen_vs_terbaik as number) <= threshold;
      }
    }
    return out;
  },
});

const bandingkanUkuran = tool({
  name: 'bandingkan_ukuran',
  description:
    'Bandingkan harga per satuan antar ukuran dalam satu Product Group (mis. 200 g vs 500 g). Perbandingan ' +
    'hanya dalam dimensi dan mata uang yang sama. Isi product_group_id atau produk_id.',
  inputSchema: z
    .object({ product_group_id: Uuid.optional(), produk_id: Uuid.optional(), jendela: z.enum(['90d', 'all']).default('90d') })
    .strict()
    .refine((x) => x.product_group_id != null || x.produk_id != null, 'Isi product_group_id atau produk_id'),
  async handler(client, input) {
    let groupId = input.product_group_id ?? null;
    let groupName: string | null = null;
    if (!groupId) {
      const d = await call(client, 'get_product_detail', { p_product_id: input.produk_id }, ProductDetailSchema);
      groupId = d.card.group?.id ?? null;
      groupName = d.card.group?.name ?? null;
      if (!groupId) throw new ToolError('NO_GROUP', 'Produk ini belum masuk Product Group, jadi tidak ada ukuran lain untuk dibandingkan.');
    }
    const rows = await call(client, 'compare_sizes', { p_group_id: groupId, p_window: input.jendela }, z.array(CompareSizesRowSchema));
    if (!groupName && rows[0]) {
      const cards = await call(client, 'get_product_cards', { p_ids: [rows[0].product.id] }, z.array(ProductCardSchema));
      groupName = cards[0]?.group?.name ?? null;
    }
    const groups = new Map<string, typeof rows>();
    for (const r of rows) groups.set(`${r.dimension}|${r.currency}`, [...(groups.get(`${r.dimension}|${r.currency}`) ?? []), r]);
    const withData = rows.filter((r) => r.has_data);
    return {
      group: { id: groupId, nama: groupName },
      jendela: input.jendela,
      per_dimensi: [...groups.values()].map((g) => ({
        dimensi: g[0]!.dimension,
        mata_uang: g[0]!.currency,
        satuan: BASE_UNIT[g[0]!.product.dimension],
        baris: g.filter((r) => r.has_data).map((r) => ({
          produk: produk(r.product),
          per_satuan: r.unit_price == null ? null : round(r.unit_price, 2),
          harga: r.effective_price,
          harga_per_isi: r.per_pack_price,
          peringkat: r.rank,
          selisih_persen: r.pct_vs_best,
          toko: r.store?.name ?? null,
          tanggal: r.date,
        })),
        tanpa_data: g.filter((r) => !r.has_data).map((r) => produk(r.product)),
      })),
      jumlah_data: withData.length,
      tanggal_terakhir: withData.map((r) => r.last_transaction_date).filter(Boolean).sort().at(-1) ?? null,
      layar: { id: 'S-04', product_group_id: groupId },
    };
  },
});

const lebihHematDiMana = tool({
  name: 'lebih_hemat_di_mana',
  description:
    'Di toko/cabang mana user lebih hemat membeli produk atau Product Group: harga per satuan termurah dan ' +
    'rata-rata per toko dan cabang, dipisah per dimensi dan mata uang. jendela_hari null = sepanjang masa.',
  inputSchema: z
    .object({
      produk_id: Uuid.optional(),
      product_group_id: Uuid.optional(),
      jendela_hari: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).default(90),
    })
    .strict()
    .refine((x) => (x.produk_id == null) !== (x.product_group_id == null), 'Isi salah satu: produk_id atau product_group_id'),
  async handler(client, input) {
    const rows = await call(
      client,
      'where_cheaper',
      { p_product_id: input.produk_id ?? null, p_group_id: input.product_group_id ?? null, p_window_days: input.jendela_hari },
      z.array(WhereCheaperRowSchema),
    );
    const groups = new Map<string, typeof rows>();
    for (const r of rows) groups.set(`${r.dimension}|${r.currency}`, [...(groups.get(`${r.dimension}|${r.currency}`) ?? []), r]);
    return {
      jendela_hari: input.jendela_hari,
      per_dimensi: [...groups.values()].map((g) => ({
        dimensi: g[0]!.dimension,
        mata_uang: g[0]!.currency,
        toko: g.map((r) => {
          const catatan = [r.is_online ? 'harga belum termasuk ongkir' : null, r.n === 1 ? 'baru 1 data' : null].filter(Boolean);
          return {
            toko: r.store.name,
            cabang: r.branch?.name ?? NO_BRANCH,
            cabang_pengganti: r.successor_branch?.name ?? null,
            termurah_per_satuan: round(r.min_unit_price, 2),
            rata2_per_satuan: round(r.avg_unit_price, 2),
            jumlah_data: r.n,
            tanggal_terakhir: r.last_date,
            online: r.is_online,
            ...(catatan.length ? { catatan: catatan.join('; ') } : {}),
          };
        }),
      })),
      jumlah_data: rows.reduce((a, r) => a + r.n, 0),
      tanggal_terakhir: rows.map((r) => r.last_date).sort().at(-1) ?? null,
      layar: { id: 'S-05', produk_id: input.produk_id ?? null, product_group_id: input.product_group_id ?? null },
    };
  },
});

const historiHarga = tool({
  name: 'histori_harga',
  description: 'Daftar histori harga produk (terbaru dulu), opsional per toko. Pendukung jawaban lain.',
  inputSchema: z.object({ produk_id: Uuid, toko_id: Uuid.optional(), batas: z.number().int().min(1).max(50).default(20) }).strict(),
  async handler(client, input) {
    const rows = await call(
      client,
      'price_history',
      { p_product_id: input.produk_id, p_store_id: input.toko_id ?? null, p_limit: input.batas },
      z.array(PriceRecordViewSchema),
    );
    return {
      riwayat: rows.map((r) => ({
        tanggal: r.transaction_date,
        sumber: r.source_type,
        toko: r.store_name,
        cabang: r.branch_name ?? NO_BRANCH,
        harga_efektif: r.effective_price,
        label: label(r.price_basis, r.member_program_name),
        per_satuan: round(r.unit_price, 2),
        kuantitas: r.quantity,
        bundle: r.is_bundle,
        member_tidak_dihitung: r.member_not_counted,
      })),
      jumlah_data: rows.length,
      tanggal_terakhir: rows[0]?.transaction_date ?? null,
      layar: { id: 'S-03', produk_id: input.produk_id },
    };
  },
});

export const TOOLS = [cariHargaTerbaik, trenHarga, hargaPerSatuan, bandingkanUkuran, lebihHematDiMana, historiHarga] as const;

export interface ToolRegistryEntry {
  name: string;
  description: string;
  /** JSON Schema dari zod, siap dipakai sebagai input_schema tool Claude (Tahap 6). */
  inputSchema: Record<string, unknown>;
  handler(client: RpcClient, input: unknown): Promise<unknown>;
}

export const registry: ToolRegistryEntry[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: z.toJSONSchema(t.inputSchema, { io: 'input' }) as Record<string, unknown>,
  handler: (client, input) => (t.handler as (c: RpcClient, i: unknown) => Promise<unknown>)(client, (t.inputSchema as z.ZodType).parse(input)),
}));

export type ToolResult = { ok: true; output: unknown } | { ok: false; error: { kode: string; pesan: string } };

/** Jalankan tool dengan validasi input; error dikembalikan sebagai data (untuk tool_result). */
export async function runTool(client: RpcClient, name: string, input: unknown): Promise<ToolResult> {
  const t = registry.find((x) => x.name === name);
  if (!t) return { ok: false, error: { kode: 'UNKNOWN_TOOL', pesan: `Tool ${name} tidak ada.` } };
  try {
    return { ok: true, output: await t.handler(client, input) };
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: { kode: 'INVALID_INPUT', pesan: e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') } };
    }
    if (e instanceof ToolError) return { ok: false, error: { kode: e.kode, pesan: e.message } };
    throw e;
  }
}
