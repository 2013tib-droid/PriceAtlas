// Konverter deterministik LLM → kontrak `parsed` (docs/08 §5.3, F-108, F-109, F-120).
// Confidence akhir per field/baris = min(confidence model, batas dari cek). Setiap cek yang
// menurunkan confidence dicatat di `flags` (masuk raw_ai_output.meta, dipakai harness §4.7).
// Hasil tetap divalidasi ParsedOutputSchema di pipeline (gerbang akhir).
import type {
  CaptureKind,
  ParsedObservation,
  ParsedObservationItem,
  ParsedOutput,
  ParsedReceipt,
  ParsedReceiptLine,
} from '@priceatlas/contracts';
import { PermanentError } from '../pipeline/types.ts';
import type { LlmObservation, LlmObservationItem, LlmOutput, LlmReceipt } from './llm-schema.ts';

/** Batas confidence per cek (§5.3). */
export const CAPS = {
  unattached: 0.5,
  arithmetic: 0.6,
  total: 0.7,
  date: 0.5,
  seam: 0.6,
  labelPrice: 0.6,
  rounded: 0.8,
  invalid: 0.6,
} as const;

/** Toleransi qty × harga satuan = nominal (rupiah): biasa ± Rp1, timbang ± Rp50. */
export const ARITHMETIC_TOLERANCE = { unit: 1, weighed: 50 } as const;
/** Tanggal masuk akal: [unggah − 400 hari, unggah + 1 hari]. */
export const DATE_WINDOW_DAYS = { before: 400, after: 1 } as const;

export interface ConvertContext {
  kind: CaptureKind;
  uploadedAt: Date;
  imageCount: number;
}

export interface ConvertResult {
  output: ParsedOutput;
  /** Transkripsi (PII sudah disamarkan model) → processing_run.raw_ocr_text. */
  rawText: string;
  flags: string[];
}

const NOT_A_RECEIPT = 'Gambar ini sepertinya bukan struk atau label harga.';
const UNSUPPORTED = 'Format gambar ini belum didukung.';
const BLURRY = 'Gambar buram atau tidak terbaca. Coba foto ulang.';

export function convertOutput(llm: LlmOutput, ctx: ConvertContext): ConvertResult {
  if (ctx.kind === 'receipt') return convertReceipt(llm as LlmReceipt, ctx);
  return convertObservation(llm as LlmObservation, ctx);
}

// ---------------------------------------------------------------- bantuan umum

function clamp01(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

class Flags {
  readonly list: string[] = [];
  add(flag: string) {
    if (!this.list.includes(flag)) this.list.push(flag);
  }
}

/** Nominal IDR: bilangan bulat. Pecahan dibulatkan dan confidence dibatasi 0,8. */
function rupiah(n: number | null | undefined, flags: Flags, where: string): { value: number | null; cap: number } {
  if (n == null || !Number.isFinite(n)) return { value: null, cap: 1 };
  if (Number.isInteger(n)) return { value: n, cap: 1 };
  flags.add(`rounded:${where}`);
  return { value: Math.round(n), cap: CAPS.rounded };
}

function trimOrNull(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` (atau `YY-MM-DD` → 20YY) yang valid di kalender; selain itu null. */
export function normalizeDate(s: string | null | undefined): string | null {
  const m = s?.trim().match(/^(\d{2}|\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = m[1]!.length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Tanggal unggah di zona Asia/Jakarta (UTC+7, tanpa DST). */
function jakartaDay(d: Date): number {
  const local = new Date(d.getTime() + 7 * 3_600_000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

export function dateInWindow(iso: string, uploadedAt: Date): boolean {
  const t = Date.parse(`${iso}T00:00:00Z`);
  const up = jakartaDay(uploadedAt);
  return t >= up - DATE_WINDOW_DAYS.before * DAY_MS && t <= up + DATE_WINDOW_DAYS.after * DAY_MS;
}

function normalizeTime(s: string | null | undefined): string | null {
  const m = s?.trim().match(/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const se = m[3] === undefined ? null : Number(m[3]);
  if (h > 23 || mi > 59 || (se !== null && se > 59)) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return se === null ? `${p(h)}:${p(mi)}` : `${p(h)}:${p(mi)}:${p(se)}`;
}

function checkDocument(llm: LlmOutput, kind: CaptureKind) {
  if (llm.document.type !== kind) {
    throw new PermanentError(kind === 'receipt' ? 'not_a_receipt' : 'unsupported', kind === 'receipt' ? NOT_A_RECEIPT : UNSUPPORTED);
  }
  if (!llm.document.readable) throw new PermanentError('blurry', BLURRY);
}

function storeHint(store: LlmOutput['store']) {
  const name = trimOrNull(store.name);
  const branch = trimOrNull(store.branch);
  if (!name && !branch) return undefined;
  return { name, branch_name: branch };
}

// ---------------------------------------------------------------- struk

function convertReceipt(llm: LlmReceipt, ctx: ConvertContext): ConvertResult {
  checkDocument(llm, 'receipt');
  const flags = new Flags();
  const n = llm.lines.length;

  type Draft = ParsedReceiptLine & { cap: number; section: number; model: number };
  const drafts: Draft[] = llm.lines.map((l, i) => {
    const amount = rupiah(l.amount, flags, `line${i + 1}.amount`);
    const unit = rupiah(l.unit_price, flags, `line${i + 1}.unit_price`);
    let cap = Math.min(amount.cap, unit.cap);
    let quantity: number | null = l.quantity == null || !Number.isFinite(l.quantity) ? null : Math.round(l.quantity * 1000) / 1000;
    if (quantity !== null && quantity <= 0) {
      flags.add(`quantity:line${i + 1}`);
      quantity = null;
      cap = Math.min(cap, CAPS.invalid);
    }
    let lineAmount = amount.value ?? 0;
    // Diskon dan void selalu negatif (model kadang membuang tanda minus).
    if ((l.type === 'discount' || l.type === 'void') && lineAmount > 0) lineAmount = -lineAmount;
    const d: Draft = {
      line_no: i + 1,
      line_type: l.type,
      raw_text: l.text.trim(),
      quantity,
      unit_amount: unit.value,
      line_amount: lineAmount,
      applies_to_line_no: null,
      barcode: trimOrNull(l.barcode),
      parse_confidence: null,
      cap,
      section: Number.isFinite(l.section) ? l.section : 1,
      model: clamp01(l.confidence),
    };
    if (l.bundle) d.is_bundle = true;
    if (l.member_discount) d.member_discount = true;
    return d;
  });

  // Penomoran: diskon/void wajib menempel ke baris produk yang ada; selain itu dilepas → `other`.
  llm.lines.forEach((l, i) => {
    const d = drafts[i]!;
    if (l.type !== 'discount' && l.type !== 'void') return;
    const target = l.applies_to;
    const ok = target != null && Number.isInteger(target) && target >= 1 && target <= n && target !== i + 1 && drafts[target - 1]!.line_type === 'product';
    if (ok) {
      d.applies_to_line_no = target;
    } else {
      flags.add(`unattached:line${i + 1}`);
      d.line_type = 'other';
      d.cap = Math.min(d.cap, CAPS.unattached);
      delete d.member_discount;
    }
  });

  // Aritmetika baris: qty × harga satuan = nominal.
  for (const d of drafts) {
    if (d.quantity == null || d.unit_amount == null) continue;
    const weighed = !Number.isInteger(d.quantity);
    const tol = weighed ? ARITHMETIC_TOLERANCE.weighed : ARITHMETIC_TOLERANCE.unit;
    if (Math.abs(d.quantity * d.unit_amount - Math.abs(d.line_amount)) > tol) {
      flags.add(`arithmetic:line${d.line_no}`);
      d.cap = Math.min(d.cap, CAPS.arithmetic);
    }
  }

  // Sambungan bagian (F-120): baris identik berurutan yang melintasi batas bagian.
  for (let i = 0; i + 1 < drafts.length; i++) {
    const a = drafts[i]!;
    const b = drafts[i + 1]!;
    if (b.section > a.section && a.raw_text === b.raw_text && a.line_amount === b.line_amount && a.line_type === b.line_type) {
      flags.add(`seam:line${a.line_no}`);
      a.cap = Math.min(a.cap, CAPS.seam);
      b.cap = Math.min(b.cap, CAPS.seam);
    }
  }

  const lines: ParsedReceiptLine[] = drafts.map(({ cap, section: _s, model, ...line }) => ({
    ...line,
    parse_confidence: round2(Math.min(model, cap)),
  }));

  // Header.
  const total = rupiah(llm.header.total, flags, 'total');
  const subtotal = rupiah(llm.header.subtotal, flags, 'subtotal');
  const conf = llm.header.confidence;
  let totalConf = Math.min(clamp01(conf.total), total.cap);
  if (total.value !== null) {
    const sum = lines.filter((l) => l.line_type !== 'other').reduce((s, l) => s + l.line_amount, 0);
    const vouchers = llm.adjustments.filter((a) => a.kind === 'voucher').reduce((s, a) => s + Math.abs(a.amount ?? 0), 0);
    // Σ baris = total, atau Σ baris − voucher = total (voucher dicetak di bawah sebagai adjustment).
    if (Math.abs(sum - total.value) > 1 && Math.abs(sum - vouchers - total.value) > 1) {
      flags.add('total_mismatch');
      totalConf = Math.min(totalConf, CAPS.total);
    }
  }

  const date = normalizeDate(llm.header.date);
  let dateConf = clamp01(conf.date);
  if (llm.header.date && !date) {
    flags.add('date_invalid');
    dateConf = 0;
  }
  if (date && !dateInWindow(date, ctx.uploadedAt)) {
    flags.add('date_out_of_window');
    dateConf = Math.min(dateConf, CAPS.date);
  }
  const time = normalizeTime(llm.header.time);
  if (llm.header.time && !time) flags.add('time_invalid');

  const hint = storeHint(llm.store);
  const fc: ParsedReceipt['header']['field_confidence'] = {};
  if (hint?.name) fc.store = round2(clamp01(llm.store.confidence));
  if (hint?.branch_name) fc.branch = round2(clamp01(llm.store.confidence));
  if (date) fc.date = round2(dateConf);
  if (time) fc.time = round2(clamp01(conf.time));
  if (total.value !== null) fc.total = round2(totalConf);
  if (subtotal.value !== null) fc.subtotal = round2(Math.min(clamp01(conf.subtotal), subtotal.cap));

  const pii: Record<string, string> = {};
  for (const [k, v] of Object.entries(llm.pii)) {
    const t = trimOrNull(v);
    if (t) pii[k] = t;
  }

  const output: ParsedReceipt = {
    kind: 'receipt',
    ...(hint ? { store_hint: hint } : {}),
    header: {
      transaction_date: date,
      transaction_time: time,
      total_amount: total.value,
      subtotal_amount: subtotal.value,
      payment_method: llm.header.payment_method,
      currency: 'IDR',
      field_confidence: fc,
    },
    pii,
    lines,
    adjustments: llm.adjustments.map((a, i) => ({
      kind: a.kind,
      description: trimOrNull(a.text),
      amount: rupiah(a.amount, flags, `adjustment${i + 1}`).value,
      points: a.points,
    })),
    ...(llm.member && trimOrNull(llm.member.text)
      ? { member_hint: { text: llm.member.text.trim(), program_name: trimOrNull(llm.member.program) } }
      : {}),
  };
  return { output, rawText: llm.transcript, flags: flags.list };
}

// ---------------------------------------------------------------- label dan screenshot

function convertObservation(llm: LlmObservation, ctx: ConvertContext): ConvertResult {
  checkDocument(llm, ctx.kind);
  const flags = new Flags();
  const items = llm.items.map((it, i) => convertItem(it, i + 1, ctx, flags, clamp01(llm.store.confidence)));
  const hint = storeHint(llm.store);
  const output: ParsedObservation = {
    kind: ctx.kind as ParsedObservation['kind'],
    ...(hint ? { store_hint: hint } : {}),
    items,
  };
  return { output, rawText: llm.transcript, flags: flags.list };
}

function convertItem(it: LlmObservationItem, no: number, ctx: ConvertContext, flags: Flags, storeConf: number): ParsedObservationItem {
  let priceCap = 1;
  const price = (v: number | null, name: string): number | null => {
    const r = rupiah(v, flags, `item${no}.${name}`);
    priceCap = Math.min(priceCap, r.cap);
    if (r.value !== null && r.value < 0) {
      flags.add(`negative:item${no}.${name}`);
      priceCap = Math.min(priceCap, CAPS.invalid);
      return null;
    }
    return r.value;
  };
  const normal = price(it.normal_price, 'normal_price');
  const promo = price(it.promo_price, 'promo_price');
  const member = price(it.member_price, 'member_price');

  let from = normalizeDate(it.promo_valid_from);
  let until = normalizeDate(it.promo_valid_until);
  if (promo !== null && normal !== null && promo >= normal) {
    flags.add(`promo_not_lower:item${no}`);
    priceCap = Math.min(priceCap, CAPS.labelPrice);
  }
  if (from && until && from > until) {
    flags.add(`period_reversed:item${no}`);
    priceCap = Math.min(priceCap, CAPS.labelPrice);
  }
  if ((it.promo_valid_from && !from) || (it.promo_valid_until && !until)) flags.add(`period_invalid:item${no}`);
  if (!from) from = null;
  if (!until) until = null;

  let dateConf = clamp01(it.confidence.date);
  const txDate = normalizeDate(it.transaction_date);
  if (txDate && !dateInWindow(txDate, ctx.uploadedAt)) {
    flags.add(`date_out_of_window:item${no}`);
    dateConf = Math.min(dateConf, CAPS.date);
  }

  const minQty = it.promo_min_qty != null && Number.isInteger(it.promo_min_qty) && it.promo_min_qty >= 2 ? it.promo_min_qty : null;
  const url = trimOrNull(it.listing_url);
  const title = trimOrNull(it.listing_title);
  const r = it.region;
  const regionOk = r != null && [r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
  const pos = Number.isInteger(it.image_position) && it.image_position >= 1 && it.image_position <= ctx.imageCount ? it.image_position : null;

  const item: ParsedObservationItem = {
    raw_text: it.text.trim(),
    barcode: trimOrNull(it.barcode),
    normal_price: normal,
    promo_price: promo,
    promo_min_qty: minQty,
    promo_valid_from: from,
    promo_valid_until: until,
    member_price: member,
    member_program_name: trimOrNull(it.member_program),
    seller_name: trimOrNull(it.seller_name),
    seller_ref: trimOrNull(it.seller_ref),
    shipping_fee: price(it.shipping_fee, 'shipping_fee'),
    shop_voucher: price(it.shop_voucher, 'shop_voucher'),
    cashback: price(it.cashback, 'cashback'),
    points: it.points != null && it.points >= 0 ? it.points : null,
    listing_title: title ? title.slice(0, 500) : null,
    listing_url: url && url.startsWith('https://') && url.length <= 2000 ? url : null,
    region: regionOk ? { x: r.x, y: r.y, w: r.w, h: r.h } : null,
    image_position: pos,
    transaction_date: txDate,
    currency: 'IDR',
    field_confidence: {
      product: round2(clamp01(it.confidence.product)),
      price: round2(Math.min(clamp01(it.confidence.price), priceCap)),
      ...(txDate ? { date: round2(dateConf) } : {}),
      ...(storeConf > 0 ? { store: round2(storeConf) } : {}),
    },
  };
  if (it.bundle) item.is_bundle = true;
  return item;
}
