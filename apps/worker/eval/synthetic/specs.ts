// Daftar gambar sintetis (F-118, Q-72). Nama = nama fixture stub; isi gambar mengikuti `raw_text` /
// `output` fixture JSON yang sudah ada (JSON tidak diubah, pemetaan tetap lewat field `images`).
// Ground truth untuk harness = `output` fixture (struk-buram: tidak terbaca, tanpa truth).
import { labelHtml, listingHtml, receiptHtml } from './templates.ts';

export interface SyntheticSpec {
  name: string;
  kind: 'receipt' | 'price_label' | 'marketplace';
  /** Direktori fixture tujuan, relatif ke root repo. */
  fixtureDir: string;
  html: string;
  conditions: string[];
}

const WORKER = 'apps/worker/test/fixtures';
const WEB = 'apps/web/test/fixtures/worker';

export const SPECS: SyntheticSpec[] = [
  {
    name: 'struk-aeon',
    kind: 'receipt',
    fixtureDir: WORKER,
    conditions: ['skewed'],
    html: receiptHtml(
      {
        header: ['AEON BSD', 'AEON STORE BSD CITY', 'JL. BSD RAYA UTAMA', '15/10/2026 19:02   KS:03'],
        rows: [
          { text: 'MILO ORI 500G', qty: '2 x 45.000', amount: '90.000' },
          { text: '8992696404441', indent: true },
          { text: 'DISC MEMBER', indent: true, amount: '-5.000' },
          { text: 'INDOMIE GRG 85G', qty: '5 x 3.500', amount: '17.500' },
          { text: 'KANTONG PLASTIK', amount: '200' },
          { text: 'SNACK XYZ', amount: '12.000' },
          { text: 'TOTAL', amount: '114.700', bold: true },
          { text: 'DEBIT ****4321', amount: '114.700' },
        ],
        footer: ['MEMBER HP 081298765432', 'TERIMA KASIH'],
      },
      { rotateDeg: 0.8, noise: 900, seed: 11, ink: 0.92 },
    ),
  },
  {
    name: 'struk-alfamart-timeout',
    kind: 'receipt',
    fixtureDir: WORKER,
    conditions: [],
    html: receiptHtml(
      {
        header: ['ALFAMART', 'SERPONG', '14/10/2026 08:15'],
        rows: [
          { text: 'INDOMIE GRG 85G', qty: '2 x 3.400', amount: '6.800' },
          { text: 'TOTAL', amount: '6.800', bold: true },
          { text: 'TUNAI', amount: '10.000' },
          { text: 'KEMBALI', amount: '3.200' },
        ],
        footer: ['TERIMA KASIH SUDAH BERBELANJA'],
      },
      { rotateDeg: -0.4, noise: 500, seed: 23 },
    ),
  },
  {
    name: 'struk-buram',
    kind: 'receipt',
    fixtureDir: WORKER,
    conditions: ['faded', 'blurry'],
    html: receiptHtml(
      {
        header: ['TOKO SERBA ADA', '13/10/2026'],
        rows: [
          { text: 'GULA PASIR 1KG', qty: '1 x 16.000', amount: '16.000' },
          { text: 'MINYAK GORENG 2L', qty: '1 x 38.000', amount: '38.000' },
          { text: 'TOTAL', amount: '54.000', bold: true },
        ],
        footer: ['TERIMA KASIH'],
      },
      { rotateDeg: 2.5, noise: 2500, seed: 37, blurPx: 4, ink: 0.35 },
    ),
  },
  {
    name: 'struk-tanpa-toko',
    kind: 'receipt',
    fixtureDir: WEB,
    conditions: ['faded'],
    html: receiptHtml(
      {
        header: ['TOKO MAKMUR JAYA', '14/10/2026'],
        rows: [
          { text: 'MILO ORI 200G', qty: '1 x 21.000', amount: '21.000' },
          { text: '8992696404442', indent: true },
          { text: 'GULA PASIR 1KG', qty: '1 x 16.000', amount: '16.000' },
          { text: 'TOTAL', amount: '37.000', bold: true },
          { text: 'TUNAI', amount: '50.000' },
          { text: 'POIN', amount: '37' },
        ],
        footer: ['BARANG YANG SUDAH DIBELI', 'TIDAK DAPAT DIKEMBALIKAN'],
      },
      { rotateDeg: 0.3, noise: 1200, seed: 41, ink: 0.7 },
    ),
  },
  {
    name: 'label-milo',
    kind: 'price_label',
    fixtureDir: WORKER,
    conditions: [],
    html: labelHtml(
      [
        { name: 'MILO ORIGINAL 200G', barcode: '8992696404442', price: 'Rp19.500', promo: { price: 'Rp17.500', until: 's/d 31 Des 2099' } },
        { name: 'MILO 3IN1 10X35G', price: 'Rp23.000', member: { price: 'Rp21.000', program: 'AEON Member' } },
      ],
      { rotateDeg: -0.6, noise: 600, seed: 53 },
    ),
  },
  {
    name: 'shopee-milo',
    kind: 'marketplace',
    fixtureDir: WORKER,
    conditions: [],
    html: listingHtml({
      marketplace: 'Shopee',
      title: 'Milo Original 500 g Nestle',
      price: 'Rp47.000',
      seller: 'Nestle Official Store',
      shipping: 'Rp9.000',
      urlText: 'https://shopee.co.id/milo-original-500g',
    }),
  },
  {
    // 6b M4 (Q-78): screenshot ber-confidence rendah (field_confidence.price 0,7 < τ) sehingga e2e
    // alur 5 mencapai S-11 dari unggahan pertama, tanpa unggahan kedua (F-50).
    name: 'shopee-milo-uht',
    kind: 'marketplace',
    fixtureDir: WORKER,
    conditions: ['low_confidence'],
    html: listingHtml({
      marketplace: 'Shopee',
      title: 'Milo UHT 180 ml Nestle',
      price: 'Rp6.500',
      seller: 'Toko Susu Segar',
      shipping: 'Rp5.000',
      urlText: 'https://shopee.co.id/milo-uht-180ml',
    }),
  },
];
