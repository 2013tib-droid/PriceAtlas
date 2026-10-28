# Laporan uji OCR (D-16) — 2026-10-28T09:18:36.985Z

> **Data sintetis** (dan/atau klien palsu). Angka ini menguji harness, BUKAN hasil uji D-16.

Klien: fake · Prompt: v1

## Sampel

| Jenis/split | Kategori | Jumlah |
|---|---|---:|
| marketplace/dev | marketplace | 1 |
| marketplace/test | marketplace | 1 |
| price_label/dev | hypermarket | 1 |
| price_label/test | hypermarket | 1 |
| receipt/dev | lokal | 1 |
| receipt/test | hypermarket | 1 |
| receipt/test | minimarket | 1 |
| receipt/test | lokal | 1 |

Anotasi: 8/8 diverifikasi · pra-isi 0 (rata-rata field diubah —) · tanpa pra-isi 8

## Struk (split test)

| Metrik | vision-opus-low | vision-opus-medium | vision-sonnet | vision-haiku | ocr-gcv+opus-low |
|---|---:|---:|---:|---:|---:|
| Toko | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) |
| Cabang | 100.0 % (4) | 100.0 % (4) | 100.0 % (4) | 100.0 % (4) | 100.0 % (4) |
| Tanggal | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) |
| Jam | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Total | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) |
| Metode bayar | 100.0 % (4) | 100.0 % (4) | 100.0 % (4) | 100.0 % (4) | 100.0 % (4) |
| Recall baris produk | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) |
| Presisi baris produk | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) |
| Nominal baris | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) | 83.3 % (12) | 100.0 % (12) |
| Kuantitas | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) |
| Harga satuan | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) | 83.3 % (12) | 100.0 % (12) |
| Teks item (CER ≤ 0,1) | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) | 100.0 % (12) |
| line_type | 100.0 % (16) | 100.0 % (16) | 100.0 % (16) | 100.0 % (16) | 100.0 % (16) |
| Diskon + menempel benar | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Non-produk | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Member (konverter) recall | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Member (konverter) presisi | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Member (regex D-74) recall | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Member (regex D-74) presisi | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Struk sempurna | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 66.7 % (6) | 100.0 % (6) |
| Σ baris = total | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 66.7 % (6) | 100.0 % (6) |
| PII tertangkap | 100.0 % (4) | 100.0 % (4) | 100.0 % (4) | 100.0 % (4) | 100.0 % (4) |
| Kegagalan (refusal+skema+timeout) | 0.0 % (6) | 0.0 % (6) | 0.0 % (6) | 0.0 % (6) | 0.0 % (6) |
| Gagal baca (buram/bukan struk) | 0.0 % (6) | 0.0 % (6) | 0.0 % (6) | 0.0 % (6) | 0.0 % (6) |
| PII bocor setelah redaksi (jumlah) | 0 | 0 | 0 | 0 | 0 |
| τ untuk presisi ≥ 98 % | 0.50 | 0.50 | 0.50 | 0.61 | 0.50 |
| Coverage @τ | 100.0 % | 100.0 % | 100.0 % | 83.3 % | 100.0 % |
| ECE | 0.050 | 0.030 | 0.070 | 0.183 | 0.050 |
| Koreksi user / capture | 0.00 | 0.00 | 0.00 | 0.33 | 0.00 |
| Biaya / capture | $0.0163 | $0.0163 | $0.0082 | $0.0004 | $0.0178 |
| Ketidakstabilan antar-ulangan | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % |

### Presisi/coverage auto-save per τ (struk, test)

| τ | vision-opus-low | vision-opus-medium | vision-sonnet | vision-haiku | ocr-gcv+opus-low |
|---|---|---|---|---|---|
| 0.80 | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 83.3 % | 100.0 % / 100.0 % |
| 0.85 | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 83.3 % | 100.0 % / 100.0 % |
| 0.90 | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 83.3 % | 100.0 % / 100.0 % |
| 0.95 | 100.0 % / 100.0 % | 100.0 % / 100.0 % | — / 0.0 % | — / 0.0 % | 100.0 % / 100.0 % |
| 0.98 | — / 0.0 % | — / 0.0 % | — / 0.0 % | — / 0.0 % | — / 0.0 % |

## Label + screenshot (split test)

| Metrik | vision-opus-low | vision-opus-medium | vision-sonnet | vision-haiku | ocr-gcv+opus-low |
|---|---:|---:|---:|---:|---:|
| Harga (semua) | 100.0 % (10) | 100.0 % (10) | 100.0 % (10) | 100.0 % (10) | 100.0 % (10) |
| Harga normal | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) |
| Harga promo | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Harga member | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Periode promo | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Program member | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Ongkir | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Seller | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) | 100.0 % (2) |
| Produk (CER ≤ 0,1) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) |
| Recall item | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) |
| Presisi item | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) | 100.0 % (6) |
| image_position | 100.0 % (4) | 100.0 % (4) | 100.0 % (4) | 100.0 % (4) | 100.0 % (4) |
| Kegagalan | 0.0 % (4) | 0.0 % (4) | 0.0 % (4) | 0.0 % (4) | 0.0 % (4) |
| PII bocor setelah redaksi (jumlah) | — | — | — | — | — |
| τ untuk presisi ≥ 98 % | 0.50 | 0.50 | 0.50 | 0.50 | 0.50 |
| Coverage @τ | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 100.0 % |
| ECE | 0.050 | 0.030 | 0.070 | 0.100 | 0.050 |
| Koreksi user / capture | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Biaya / capture | $0.0154 | $0.0154 | $0.0077 | $0.0004 | $0.0169 |
| Ketidakstabilan antar-ulangan | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % |

## Latensi realtime

| Arm | n | p50 | p95 |
|---|---:|---:|---:|
| vision-opus-low | 4 | 14 ms | 26 ms |
| vision-opus-medium | 4 | 15 ms | 17 ms |
| vision-sonnet | 4 | 15 ms | 21 ms |
| vision-haiku | 4 | 12 ms | 17 ms |
| ocr-gcv+opus-low | 4 | 12 ms | 14 ms |

## Struk per kategori toko dan kondisi (test, "struk sempurna" / nominal)

| Kelompok | vision-opus-low | vision-opus-medium | vision-sonnet | vision-haiku | ocr-gcv+opus-low |
|---|---|---|---|---|---|
| kategori:hypermarket | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 0.0 % / 66.7 % | 100.0 % / 100.0 % |
| kategori:lokal | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % |
| kategori:minimarket | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % |
| kondisi:faded | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % |
| kondisi:normal | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % |
| kondisi:skewed | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 100.0 % / 100.0 % | 0.0 % / 66.7 % | 100.0 % / 100.0 % |

## Kriteria §4.8

### vision-opus-low (claude-opus-5-5, effort low)

- ✅ struk: presisi auto-save ≥ 98 % (τ ditemukan): 100.0 % (>= 98.0 %)
- ✅ struk: coverage @τ: 100.0 % (>= 60.0 %)
- ✅ struk: nominal baris produk: 100.0 % (>= 97.0 %)
- ✅ struk: recall baris produk: 100.0 % (>= 97.0 %)
- ✅ struk: tanggal: 100.0 % (>= 98.0 %)
- ✅ struk: total: 100.0 % (>= 98.0 %)
- ✅ struk: toko: 100.0 % (>= 95.0 %)
- ✅ struk: kebocoran PII (jumlah): 0 (= 0)
- ✅ struk: kegagalan (refusal + skema + timeout): 0.0 % (<= 2.0 %)
- ✅ label/screenshot: harga (normal/promo/member): 100.0 % (>= 97.0 %)
- ✅ label/screenshot: recall item: 100.0 % (>= 97.0 %)
- ✅ label/screenshot: kegagalan (refusal + skema + timeout): 0.0 % (<= 2.0 %)

### vision-opus-medium (claude-opus-5-5, effort medium)

- ✅ struk: presisi auto-save ≥ 98 % (τ ditemukan): 100.0 % (>= 98.0 %)
- ✅ struk: coverage @τ: 100.0 % (>= 60.0 %)
- ✅ struk: nominal baris produk: 100.0 % (>= 97.0 %)
- ✅ struk: recall baris produk: 100.0 % (>= 97.0 %)
- ✅ struk: tanggal: 100.0 % (>= 98.0 %)
- ✅ struk: total: 100.0 % (>= 98.0 %)
- ✅ struk: toko: 100.0 % (>= 95.0 %)
- ✅ struk: kebocoran PII (jumlah): 0 (= 0)
- ✅ struk: kegagalan (refusal + skema + timeout): 0.0 % (<= 2.0 %)
- ✅ label/screenshot: harga (normal/promo/member): 100.0 % (>= 97.0 %)
- ✅ label/screenshot: recall item: 100.0 % (>= 97.0 %)
- ✅ label/screenshot: kegagalan (refusal + skema + timeout): 0.0 % (<= 2.0 %)

### vision-sonnet (claude-sonnet-5-5, effort medium)

- ✅ struk: presisi auto-save ≥ 98 % (τ ditemukan): 100.0 % (>= 98.0 %)
- ✅ struk: coverage @τ: 100.0 % (>= 60.0 %)
- ✅ struk: nominal baris produk: 100.0 % (>= 97.0 %)
- ✅ struk: recall baris produk: 100.0 % (>= 97.0 %)
- ✅ struk: tanggal: 100.0 % (>= 98.0 %)
- ✅ struk: total: 100.0 % (>= 98.0 %)
- ✅ struk: toko: 100.0 % (>= 95.0 %)
- ✅ struk: kebocoran PII (jumlah): 0 (= 0)
- ✅ struk: kegagalan (refusal + skema + timeout): 0.0 % (<= 2.0 %)
- ✅ label/screenshot: harga (normal/promo/member): 100.0 % (>= 97.0 %)
- ✅ label/screenshot: recall item: 100.0 % (>= 97.0 %)
- ✅ label/screenshot: kegagalan (refusal + skema + timeout): 0.0 % (<= 2.0 %)

### vision-haiku (claude-haiku-5-5, effort medium)

- ✅ struk: presisi auto-save ≥ 98 % (τ ditemukan): 100.0 % (>= 98.0 %)
- ✅ struk: coverage @τ: 83.3 % (>= 60.0 %)
- ❌ struk: nominal baris produk: 83.3 % (>= 97.0 %)
- ✅ struk: recall baris produk: 100.0 % (>= 97.0 %)
- ✅ struk: tanggal: 100.0 % (>= 98.0 %)
- ✅ struk: total: 100.0 % (>= 98.0 %)
- ✅ struk: toko: 100.0 % (>= 95.0 %)
- ✅ struk: kebocoran PII (jumlah): 0 (= 0)
- ✅ struk: kegagalan (refusal + skema + timeout): 0.0 % (<= 2.0 %)
- ✅ label/screenshot: harga (normal/promo/member): 100.0 % (>= 97.0 %)
- ✅ label/screenshot: recall item: 100.0 % (>= 97.0 %)
- ✅ label/screenshot: kegagalan (refusal + skema + timeout): 0.0 % (<= 2.0 %)

### ocr-gcv+opus-low (claude-opus-5-5, effort low)

- ✅ struk: presisi auto-save ≥ 98 % (τ ditemukan): 100.0 % (>= 98.0 %)
- ✅ struk: coverage @τ: 100.0 % (>= 60.0 %)
- ✅ struk: nominal baris produk: 100.0 % (>= 97.0 %)
- ✅ struk: recall baris produk: 100.0 % (>= 97.0 %)
- ✅ struk: tanggal: 100.0 % (>= 98.0 %)
- ✅ struk: total: 100.0 % (>= 98.0 %)
- ✅ struk: toko: 100.0 % (>= 95.0 %)
- ✅ struk: kebocoran PII (jumlah): 0 (= 0)
- ✅ struk: kegagalan (refusal + skema + timeout): 0.0 % (<= 2.0 %)
- ✅ label/screenshot: harga (normal/promo/member): 100.0 % (>= 97.0 %)
- ✅ label/screenshot: recall item: 100.0 % (>= 97.0 %)
- ✅ label/screenshot: kegagalan (refusal + skema + timeout): 0.0 % (<= 2.0 %)

## Usulan dari angka (keputusan tetap pemilik proyek, Q-102)

- Struk: lolos = vision-opus-low, vision-opus-medium, vision-sonnet, ocr-gcv+opus-low → **vision-sonnet** (§4.8.2 lolos batas minimum, biaya per capture terendah)
- Label/screenshot: lolos = vision-opus-low, vision-opus-medium, vision-sonnet, vision-haiku, ocr-gcv+opus-low → **vision-haiku** (§4.8.2 lolos batas minimum, biaya per capture terendah)
