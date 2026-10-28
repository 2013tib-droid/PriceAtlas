# Laporan uji OCR (D-16) — agregat

Split **all** · prompt v1 · harga per 2026-10-06 · 8 ground truth terverifikasi · **DATA SINTETIS (bukan keputusan D-16)**

Komposisi: Label 2, Struk 4, Screenshot 2; kategori toko: minimarket 2, supermarket 2, lokal 2, marketplace 2.

## Struk

| Arm | Sempurna | Toko | Tanggal | Total | Recall baris | Nominal baris | Teks (CER ≤ 0,1) | Presisi @τ | Coverage @τ | τ min 98 % | ECE | Koreksi/struk | Σ = total | Gagal | Bocor PII | Biaya/struk | p50 | p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| vision-opus-low | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0 | 0.030 | 0 | 100.0 % | 0.0 % | 0 | US$0.0426 | 0.0 dtk | 0.0 dtk |
| vision-opus-medium | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0 | 0.030 | 0 | 100.0 % | 0.0 % | 0 | US$0.0426 | 0.0 dtk | 0.0 dtk |
| vision-sonnet | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0 | 0.070 | 0 | 100.0 % | 0.0 % | 0 | US$0.0213 | 0.0 dtk | 0.0 dtk |
| vision-haiku | 66.7 % | 100.0 % | 100.0 % | 100.0 % | 83.3 % | 83.3 % | 100.0 % | — | 0.0 % | 0 | 0.140 | 0.33 | 66.7 % | 0.0 % | 0 | US$0.0011 | 0.0 dtk | 0.0 dtk |
| ocr-gcv+opus-low | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0 | 0.100 | 0 | 100.0 % | 0.0 % | 0 | US$0.0350 | 0.0 dtk | 0.0 dtk |

| Arm | Diskon | Void | Non-produk | Timbang | Member (recall) | Member (presisi) | Regex D-74 (recall) | Qty | Harga satuan | Stabilitas (field beda) |
|---|---|---|---|---|---|---|---|---|---|---|
| vision-opus-low | 100.0 % | — | 100.0 % | — | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0.0 % |
| vision-opus-medium | 100.0 % | — | 100.0 % | — | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0.0 % |
| vision-sonnet | 100.0 % | — | 100.0 % | — | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0.0 % |
| vision-haiku | 100.0 % | — | 100.0 % | — | 100.0 % | 100.0 % | 100.0 % | 83.3 % | 83.3 % | 0.0 % |
| ocr-gcv+opus-low | 100.0 % | — | 100.0 % | — | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0.0 % |

**Keputusan §4.8 (struk):** vision-sonnet — lolos semua batas dan biaya per capture terendah (§4.8 no. 2). Lolos: vision-opus-low, vision-opus-medium, vision-sonnet, ocr-gcv+opus-low.

Batas yang tidak lolos:

- vision-haiku: presisi auto-save @τ — (≥ 0.98)
- vision-haiku: coverage @τ 0 (≥ 0.6)
- vision-haiku: nominal baris produk 0.8333 (≥ 0.97)
- vision-haiku: recall baris produk 0.8333 (≥ 0.97)

## Label

| Arm | Sempurna | Harga | Normal | Promo | Member | Min qty | Periode | Program | Teks produk | Recall item | Presisi @τ | Gagal | Biaya | p50 | p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| vision-opus-low | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | — | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0.0 % | US$0.0238 | 0.0 dtk | 0.0 dtk |
| vision-opus-medium | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | — | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0.0 % | US$0.0238 | 0.0 dtk | 0.0 dtk |
| vision-sonnet | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | — | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0.0 % | US$0.0119 | 0.0 dtk | 0.0 dtk |
| vision-haiku | 50.0 % | 83.3 % | 66.7 % | 100.0 % | 100.0 % | — | 100.0 % | 100.0 % | 100.0 % | 100.0 % | — | 0.0 % | US$0.0006 | 0.0 dtk | 0.0 dtk |
| ocr-gcv+opus-low | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | — | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0.0 % | US$0.0215 | 0.0 dtk | 0.0 dtk |

**Keputusan §4.8 (label):** vision-sonnet — lolos semua batas dan biaya per capture terendah (§4.8 no. 2). Lolos: vision-opus-low, vision-opus-medium, vision-sonnet, ocr-gcv+opus-low.

Batas yang tidak lolos:

- vision-haiku: presisi auto-save @τ — (≥ 0.98)
- vision-haiku: coverage @τ 0 (≥ 0.6)
- vision-haiku: harga 0.8333 (≥ 0.97)

## Screenshot

| Arm | Sempurna | Harga | Normal | Promo | Member | Min qty | Periode | Program | Teks produk | Recall item | Presisi @τ | Gagal | Biaya | p50 | p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| vision-opus-low | 100.0 % | 100.0 % | 100.0 % | — | — | — | — | — | 100.0 % | 100.0 % | 100.0 % | 0.0 % | US$0.0238 | 0.0 dtk | 0.0 dtk |
| vision-opus-medium | 100.0 % | 100.0 % | 100.0 % | — | — | — | — | — | 100.0 % | 100.0 % | 100.0 % | 0.0 % | US$0.0238 | 0.0 dtk | 0.0 dtk |
| vision-sonnet | 50.0 % | 50.0 % | 50.0 % | — | — | — | — | — | 100.0 % | 100.0 % | 50.0 % | 0.0 % | US$0.0119 | 0.0 dtk | 0.0 dtk |
| vision-haiku | 50.0 % | 50.0 % | 50.0 % | — | — | — | — | — | 100.0 % | 100.0 % | — | 0.0 % | US$0.0006 | 0.0 dtk | 0.0 dtk |
| ocr-gcv+opus-low | 50.0 % | 50.0 % | 50.0 % | — | — | — | — | — | 100.0 % | 100.0 % | 50.0 % | 0.0 % | US$0.0215 | 0.0 dtk | 0.0 dtk |

**Keputusan §4.8 (screenshot):** vision-opus-low — lolos semua batas dan biaya per capture terendah (§4.8 no. 2). Lolos: vision-opus-low, vision-opus-medium.

Batas yang tidak lolos:

- vision-sonnet: presisi auto-save @τ 0.5 (≥ 0.98)
- vision-sonnet: harga 0.5 (≥ 0.97)
- vision-haiku: presisi auto-save @τ — (≥ 0.98)
- vision-haiku: coverage @τ 0 (≥ 0.6)
- vision-haiku: harga 0.5 (≥ 0.97)
- ocr-gcv+opus-low: presisi auto-save @τ 0.5 (≥ 0.98)
- ocr-gcv+opus-low: harga 0.5 (≥ 0.97)

## Per kategori toko dan kondisi (arm terpilih struk)

| Kategori | Sempurna | Nominal baris | Recall baris | Tanggal | Total |
|---|---|---|---|---|---|
| lokal | 100.0 % (2) | 100.0 % | 100.0 % | 100.0 % | 100.0 % |
| minimarket | 100.0 % (2) | 100.0 % | 100.0 % | 100.0 % | 100.0 % |
| supermarket | 100.0 % (2) | 100.0 % | 100.0 % | 100.0 % | 100.0 % |

| Kondisi | Sempurna | Nominal baris | Recall baris | Tanggal | Total |
|---|---|---|---|---|---|
| blurry | — (0) | — | — | — | — |
| faded | 100.0 % (2) | 100.0 % | 100.0 % | 100.0 % | 100.0 % |
| member | 100.0 % (2) | 100.0 % | 100.0 % | 100.0 % | 100.0 % |
| skewed | 100.0 % (2) | 100.0 % | 100.0 % | 100.0 % | 100.0 % |

## Pertanyaan terbuka yang dijawab data

- **Q-34/Q-110 (member):** recall regex D-74 100.0 % dari 2 diskon member. Regex D-74 cukup (recall ≥ 95 %): kolom receipt_line.is_member_discount tidak dibuat (Q-110).
- **Q-122 (streaming):** p95 struk 0.0 dtk (vision-sonnet). p95 struk ≤ 60 dtk: tetap tanpa streaming (D-93).
- **Bias pra-isi (§4.2):** error vision-opus-medium tanpa pra-isi 0.0 %, dengan pra-isi —. Belum bisa diukur (butuh capture tanpa pra-isi dan dengan pra-isi).
- **Biaya kumulatif uji:** — (tidak ada buku biaya; klien palsu tidak mencatat biaya).

