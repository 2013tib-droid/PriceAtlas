// Logika form alat anotasi (docs/08 §4.2, §4.3), JS murni tanpa DOM: dipakai index.html di browser
// dan diuji vitest. Setiap field punya "path"; field yang belum disentuh/ditandai diperiksa tetap
// "belum diperiksa" (mitigasi bias pra-isi, §4.2), dan truth baru boleh disimpan TERVERIFIKASI jika
// semua field sudah diperiksa.

export const LINE_TYPES = ['product', 'discount', 'void', 'non_product', 'tax', 'other'];
export const PAYMENT_METHODS = ['', 'cash', 'debit', 'credit', 'qris', 'ewallet', 'other'];

export const HEADER_FIELDS = [
  { path: 'store_hint.name', label: 'Toko (jaringan)', type: 'text' },
  { path: 'store_hint.branch_name', label: 'Cabang', type: 'text' },
  { path: 'header.transaction_date', label: 'Tanggal (YYYY-MM-DD)', type: 'date' },
  { path: 'header.transaction_time', label: 'Jam (HH:MM)', type: 'time' },
  { path: 'header.total_amount', label: 'Total (Rp)', type: 'rupiah' },
  { path: 'header.subtotal_amount', label: 'Subtotal (Rp)', type: 'rupiah' },
  { path: 'header.payment_method', label: 'Metode bayar', type: 'payment' },
];

export const LINE_FIELDS = [
  { key: 'line_type', label: 'Jenis', type: 'line_type' },
  { key: 'raw_text', label: 'Teks item (persis tercetak, Q-28)', type: 'text' },
  { key: 'quantity', label: 'Qty / berat kg', type: 'number' },
  { key: 'unit_amount', label: 'Harga satuan / per kg', type: 'rupiah' },
  { key: 'line_amount', label: 'Nominal baris', type: 'rupiah' },
  { key: 'applies_to_line_no', label: 'Menempel ke baris', type: 'int' },
  { key: 'barcode', label: 'Barcode', type: 'text' },
];

export const ITEM_FIELDS = [
  { key: 'raw_text', label: 'Nama produk (tercetak)', type: 'text' },
  { key: 'barcode', label: 'Barcode', type: 'text' },
  { key: 'normal_price', label: 'Harga normal', type: 'rupiah' },
  { key: 'promo_price', label: 'Harga promo', type: 'rupiah' },
  { key: 'promo_min_qty', label: 'Promo min. qty', type: 'int' },
  { key: 'promo_valid_from', label: 'Promo dari', type: 'date' },
  { key: 'promo_valid_until', label: 'Promo s/d', type: 'date' },
  { key: 'member_price', label: 'Harga member', type: 'rupiah' },
  { key: 'member_program_name', label: 'Program member', type: 'text' },
  { key: 'listing_title', label: 'Judul listing', type: 'text' },
  { key: 'seller_name', label: 'Seller', type: 'text' },
  { key: 'shipping_fee', label: 'Ongkir', type: 'rupiah' },
  { key: 'image_position', label: 'Gambar ke-', type: 'int' },
];

export function blankExpected(kind) {
  if (kind === 'receipt') {
    return {
      kind: 'receipt',
      store_hint: { name: null, branch_name: null },
      header: { transaction_date: null, transaction_time: null, total_amount: null, subtotal_amount: null, payment_method: null, currency: 'IDR', field_confidence: {} },
      pii: {},
      lines: [],
      adjustments: [],
    };
  }
  return { kind, store_hint: { name: null, branch_name: null }, items: [] };
}

export function blankLine(no) {
  return { line_no: no, line_type: 'product', raw_text: '', quantity: null, unit_amount: null, line_amount: 0, applies_to_line_no: null, barcode: null };
}

export function blankItem() {
  return { raw_text: '', normal_price: null, promo_price: null, promo_min_qty: null, promo_valid_from: null, promo_valid_until: null, member_price: null, member_program_name: null, listing_title: null, seller_name: null, shipping_fee: null, image_position: 1, field_confidence: {} };
}

/** "Rp45.000", "45.000", "-5.000", "1.234,5" → angka; kosong → null; tidak valid → NaN. */
export function parseRupiah(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const neg = /^-|^\(.*\)$/.test(s);
  const body = s.replace(/[()\s]/g, '').replace(/^-/, '').replace(/^rp\.?/i, '');
  if (!/^\d[\d.,]*$/.test(body)) return NaN;
  const [int, frac] = body.split(',');
  const n = Number(`${int.replace(/\./g, '')}${frac ? `.${frac}` : ''}`);
  return neg ? -n : n;
}

export function parseValue(type, raw) {
  const s = String(raw ?? '').trim();
  if (type === 'rupiah') return parseRupiah(s);
  if (type === 'number') return s ? Number(s.replace(',', '.')) : null;
  if (type === 'int') return s ? Number.parseInt(s, 10) : null;
  if (type === 'date') return s ? (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : NaN) : null;
  if (type === 'time') return s ? (/^\d{2}:\d{2}(:\d{2})?$/.test(s) ? s : NaN) : null;
  return s ? s : null;
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null) o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
  return obj;
}

/** Semua path field yang wajib diperiksa untuk `expected` ini (urutan tampilan). */
export function fieldPaths(expected) {
  if (!expected) return [];
  if (expected.kind === 'receipt') {
    return [
      ...HEADER_FIELDS.map((f) => f.path),
      ...expected.lines.flatMap((_, i) => LINE_FIELDS.map((f) => `lines.${i}.${f.key}`)),
    ];
  }
  return ['store_hint.name', ...expected.items.flatMap((_, i) => ITEM_FIELDS.map((f) => `items.${i}.${f.key}`))];
}

export function uncheckedPaths(expected, checked) {
  const set = checked instanceof Set ? checked : new Set(checked);
  return fieldPaths(expected).filter((p) => !set.has(p));
}

/** Nilai tidak valid (NaN) di form. */
export function invalidPaths(expected) {
  return fieldPaths(expected).filter((p) => Number.isNaN(getPath(expected, p)));
}

/** Tambah baris (struk) di akhir. */
export function addLine(expected) {
  expected.lines.push(blankLine(expected.lines.length + 1));
  return expected;
}

/**
 * Hapus baris i: line_no dinomori ulang 1..n, applies_to_line_no ikut digeser; yang menunjuk baris
 * terhapus dikosongkan. Path yang sudah diperiksa digeser oleh pemanggil lewat `shiftChecked`.
 */
export function removeLine(expected, i) {
  const removedNo = expected.lines[i].line_no;
  expected.lines.splice(i, 1);
  expected.lines.forEach((l, k) => {
    l.line_no = k + 1;
    if (l.applies_to_line_no == null) return;
    if (l.applies_to_line_no === removedNo) l.applies_to_line_no = null;
    else if (l.applies_to_line_no > removedNo) l.applies_to_line_no -= 1;
  });
  return expected;
}

/** Geser tanda "diperiksa" setelah baris/item `i` dihapus dari koleksi `coll` (lines/items). */
export function shiftChecked(checked, coll, i) {
  const out = new Set();
  for (const p of checked) {
    const m = p.match(new RegExp(`^${coll}\\.(\\d+)\\.(.+)$`));
    if (!m) out.add(p);
    else if (Number(m[1]) < i) out.add(p);
    else if (Number(m[1]) > i) out.add(`${coll}.${Number(m[1]) - 1}.${m[2]}`);
  }
  return out;
}

/** Anotasi per baris → kunci line_no (struk) atau nomor item 1-based. */
export function cleanAnnotations(ann) {
  const lines = {};
  for (const [k, v] of Object.entries(ann.lines || {})) {
    const flags = {};
    for (const f of ['weighed', 'member_discount', 'unreadable']) if (v && v[f]) flags[f] = true;
    if (Object.keys(flags).length) lines[k] = flags;
  }
  return {
    lines,
    transcript_pii: (ann.transcript_pii || []).map((s) => String(s).trim()).filter(Boolean),
    notes: ann.notes ? String(ann.notes) : null,
  };
}

/** Isi PUT /api/truth/:id. `complete` hanya jika semua field diperiksa dan tidak ada nilai tidak valid. */
export function truthPayload(state) {
  const unreadable = state.unreadable === true;
  const complete = unreadable || (uncheckedPaths(state.expected, state.checked).length === 0 && invalidPaths(state.expected).length === 0);
  return {
    expected: unreadable ? null : state.expected,
    annotations: cleanAnnotations(state.annotations),
    store_category: state.store_category,
    conditions: state.conditions,
    complete,
  };
}
