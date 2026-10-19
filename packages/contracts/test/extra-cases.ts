// Kasus bersama untuk test zod dan test kesetaraan SQL (app.valid_price_extra).
export const EXTRA_CASES: { label: string; value: unknown; valid: boolean }[] = [
  { label: 'objek kosong', value: {}, valid: true },
  {
    label: 'semua kunci dikenal',
    value: {
      shipping_fee: 9000, shop_voucher: 0, cashback: 1500.5, points: 10, listing_title: 'Milo 1kg',
      listing_url: 'https://shopee.co.id/x', member_note: 'Alfagift Rp17.900', member_eligible: true,
      member_hint: { text: 'DISC MEMBER', program_id: '40000000-0000-0000-0000-000000000001' }, note: 'catatan',
    },
    valid: true,
  },
  { label: 'member_hint tanpa program', value: { member_hint: { text: 'DISC MEMBER' } }, valid: true },
  { label: 'kunci tidak dikenal', value: { warna: 'merah' }, valid: false },
  { label: 'ongkir string', value: { shipping_fee: '9000' }, valid: false },
  { label: 'cashback negatif', value: { cashback: -1 }, valid: false },
  { label: 'url http', value: { listing_url: 'http://shopee.co.id' }, valid: false },
  { label: 'member_note 201 karakter', value: { member_note: 'x'.repeat(201) }, valid: false },
  { label: 'member_note 200 karakter', value: { member_note: 'x'.repeat(200) }, valid: true },
  { label: 'listing_title 501 karakter', value: { listing_title: 'x'.repeat(501) }, valid: false },
  { label: 'member_hint kunci lain', value: { member_hint: { text: 'x', lain: 1 } }, valid: false },
  { label: 'member_hint tanpa text', value: { member_hint: { program_id: '40000000-0000-0000-0000-000000000001' } }, valid: false },
  { label: 'member_hint program bukan uuid', value: { member_hint: { text: 'x', program_id: 'abc' } }, valid: false },
  { label: 'member_eligible string', value: { member_eligible: 'ya' }, valid: false },
  { label: 'array', value: [], valid: false },
  { label: 'null', value: null, valid: false },
  { label: 'points nol', value: { points: 0 }, valid: true },
  { label: 'note angka', value: { note: 5 }, valid: false },
];
