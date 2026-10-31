# Tahap 6a — Desain AI Integration (termasuk uji OCR D-16)

> Status: **Disetujui (2026-10-27).** Semua usulan default §16 diterima → **D-92**. Dokumen ini tidak mengubah keputusan D-01 s/d D-91. **6b M0 selesai dan disetujui (2026-10-27):** §18. Q-122, Q-124, Q-125 → **D-93**; Q-120, Q-121, Q-123, Q-126 → **D-94** (semua usulan default). **6b M5 (Tanya) selesai dan disetujui (2026-10-28):** §19 (F-134–F-147); Q-127–Q-131 → **D-95** (semua usulan default). Uji live set emas menunggu pemilik proyek (Q-129). **6b M1-harness + M4 selesai dan disetujui (2026-10-30):** §20 (F-148–F-158); Q-132–Q-138 → **D-96** (semua usulan default); harness siap dijalankan pemilik proyek, keputusan D-16 menunggu foto + anotasi. **6b M2/M3 bagian tanpa D-16 selesai dan disetujui (2026-10-30):** §21 (F-159–F-166); Q-139–Q-142 → **D-97** (semua usulan default). **6b D-16 + M2 (2026-10-30):** §22 (F-167–F-174). Bagian B1–B3 (pemasangan extractor/matcher lewat env, uji §5.4, masa kalibrasi) selesai dan disetujui; Q-143–Q-146 → **D-98** (semua usulan default). Bagian A (Lampiran A, usulan keputusan D-16 → D-99) menunggu laporan agregat uji OCR. **Mode pribadi tanpa anggaran AI (2026-10-31):** §23 (F-175–F-182); Q-147–Q-150 → **D-100** (semua usulan default): foto dimatikan lewat saklar, struk masuk sebagai JSON tempelan dari Gemini, diproses tanpa AI.
> Rujukan: `PROJECT.md` §3, §5.4, §5.9, D-16, D-50, D-57, D-61, D-70, D-74, D-75, D-82, D-86–D-91; `docs/05-backend-design.md` §5–§7, §9; `docs/06-local-dev.md` §2; `docs/07-frontend-design.md` §6, §9, §13.

## Daftar Isi

0. [Ringkasan](#0-ringkasan)
1. [Kondisi saat ini dan cakupan](#1-kondisi-saat-ini-dan-cakupan)
2. [Temuan (F-106 dst.)](#2-temuan-f-106-dst)
3. [Arsitektur](#3-arsitektur)
4. [Uji OCR (D-16) dan harness evaluasi](#4-uji-ocr-d-16-dan-harness-evaluasi)
5. [Extractor sungguhan](#5-extractor-sungguhan)
6. [Gambar di worker (HEIC, EXIF, F-40)](#6-gambar-di-worker-heic-exif-f-40)
7. [Matcher AI tier 4](#7-matcher-ai-tier-4)
8. [Kalibrasi confidence dan ambang](#8-kalibrasi-confidence-dan-ambang)
9. [Redaksi PII](#9-redaksi-pii)
10. [Tanya (S-20, D-57)](#10-tanya-s-20-d-57)
11. [Perubahan skema, RPC, dan kontrak](#11-perubahan-skema-rpc-dan-kontrak)
12. [Kontrol biaya dan estimasi](#12-kontrol-biaya-dan-estimasi)
13. [Rencana test](#13-rencana-test)
14. [Milestone 6b](#14-milestone-6b)
15. [Yang perlu disiapkan pemilik proyek sebelum 6b](#15-yang-perlu-disiapkan-pemilik-proyek-sebelum-6b)
16. [Pertanyaan untuk didiskusikan (Q-102 dst.)](#16-pertanyaan-untuk-didiskusikan-q-102-dst)
17. [Bagian yang belum bisa dirancang penuh](#17-bagian-yang-belum-bisa-dirancang-penuh)
18. [Tahap 6b M0: hasil dan temuan baru (F-123 dst.)](#18-tahap-6b-m0-hasil-dan-temuan-baru-f-123-dst)
19. [Tahap 6b M5: hasil dan temuan baru (F-134 dst.)](#19-tahap-6b-m5-hasil-dan-temuan-baru-f-134-dst)
20. [Tahap 6b M1-harness + M4: hasil dan temuan baru (F-148 dst.)](#20-tahap-6b-m1-harness--m4-hasil-dan-temuan-baru-f-148-dst)
21. [Tahap 6b M2/M3 bagian tanpa D-16: hasil dan temuan baru (F-159 dst.)](#21-tahap-6b-m2m3-bagian-tanpa-d-16-hasil-dan-temuan-baru-f-159-dst)
22. [Tahap 6b D-16 + M2: hasil dan temuan baru (F-167 dst.)](#22-tahap-6b-d-16--m2-hasil-dan-temuan-baru-f-167-dst)
23. [Struk tempelan dari Gemini: mode pribadi tanpa anggaran AI (D-100)](#23-struk-tempelan-dari-gemini-mode-pribadi-tanpa-anggaran-ai-d-100)
24. [Lampiran A. Hasil uji OCR](#lampiran-a-hasil-uji-ocr)

---

## 0. Ringkasan

| Aspek | Usulan |
|---|---|
| Uji OCR (D-16) | Harness offline di `apps/worker/eval/` dengan 40 struk asli + 20 label + 10 screenshot. Ground truth = JSON per gambar dalam bentuk kontrak `ParsedReceipt`/`ParsedObservation`. Lima varian (`arm`) dibandingkan: Claude vision langsung (Opus 5.5 effort `low` dan `medium`, Sonnet 5.5, Haiku 5.5) dan OCR khusus + Claude parse. Data asli hanya ada di `.data/ocr-eval/` (sudah di-gitignore) di mesin pemilik proyek. Yang di-commit hanya laporan metrik tanpa teks. |
| Kriteria D-16 | Varian yang lolos batas minimum (presisi auto-save ≥ 98 %, nominal baris ≥ 97 %, tanggal dan total ≥ 98 %) dan paling murah per struk. Jika selisih akurasi kurang dari 1 poin, pilih yang paling sederhana (vision, satu vendor). Pemilihan model tetap keputusan pemilik proyek (Q-102). |
| Extractor | `VisionExtractor` dan `OcrThenParseExtractor`, keduanya memenuhi `CaptureExtractor` yang sudah ada. Satu panggilan Claude per capture (semua bagian struk sekaligus). Output dibatasi structured outputs (`output_config.format`) dengan skema khusus LLM, lalu diubah oleh konverter deterministik ke kontrak `parsed` dan divalidasi zod. Kontrak tidak diubah. |
| Retry dan timeout | Timeout SDK 120 dtk, `maxRetries: 1`, tenggat total ≤ 270 dtk (lease 300 dtk). Retry tingkat pipeline (D-70: 3 percobaan, 30/120/600 dtk) tetap satu-satunya retry yang panjang. |
| Gambar | Langkah baru di pipeline sebelum extractor: kenali tipe dari magic bytes, dekode (sharp; HEIC lewat libheif-wasm), putar sesuai EXIF, buang metadata, kecilkan ke ≤ 2576 px. File yang tidak bisa didekode → `failed` dengan `unsupported` (F-40). Gambar asli di bucket tidak diubah. |
| Matcher tier 4 | Hanya untuk item tanpa kandidat tier 1–3 (D-75 tetap). Claude memilih dari **daftar pendek** produk yang terlihat oleh household (fungsi SQL baru), tidak pernah membuat produk. Confidence tier 4 dibatasi 0,85 sehingga tidak pernah auto-save sampai kalibrasi membuktikan sebaliknya. |
| Kalibrasi | Dua lapis: (1) confidence ekstraksi diukur di harness (presisi per rentang confidence). (2) confidence matching diukur dari keputusan user selama **masa kalibrasi** 2 minggu / ≥ 150 baris, saat semua item masuk konfirmasi. Nilai tier pindah ke `app.config`. τ = 0,90 tetap sampai data ada. |
| PII | Tiga lapis: model menyamarkan PII langsung di transkripsi, nilai `pii` hasil parsing disamarkan dari teks, dan regex diperluas (berbasis label baris). Tanpa panggilan AI tambahan untuk redaksi. |
| Tanya | `POST /api/ask` (Route Handler, Node, `server-only`) memakai `packages/ai-tools` dengan JWT user. Loop tool maks 4 putaran, jawaban akhir JSON terstruktur yang dipetakan ke `AskReply` S-20. Tautan layar diambil dari output tool, bukan dari teks model. Tanpa streaming. Kuota 30 pertanyaan/hari, 300/bulan per household. Offline: kirim nonaktif. |
| Skema | Satu migration baru: kunci `app.config` (tier, kuota, anggaran), fungsi daftar pendek tier 4, tabel kuota Tanya, kolom baca harga member di `capture_item` (Q-77), perubahan R18 (Q-80/Q-81/Q-97) dan R20 (Q-87) sebagai satu perubahan RPC. `member_hint` sebagai kolom diputuskan dari data uji (Q-34). |
| Biaya | Perkiraan pemakaian pribadi (16 struk, 40 label, 8 screenshot, 40 pertanyaan per bulan): ±US$8/bulan dengan Opus 5.5 di semua jalur, ±US$4 dengan Sonnet 5.5, < US$0,50 dengan Haiku 5.5. Uji OCR: ±US$35–60, dibatasi keras US$75. Angka akhir diganti hasil ukur harness (§12). |
| CI | Tetap tanpa API berbayar: `EXTRACTOR=stub`, `ASK_ENGINE=stub` di e2e. Test API sungguhan hanya `LIVE_AI=1`, manual. |

---

## 1. Kondisi saat ini dan cakupan

### 1.1 Yang sudah ada

| Bagian | Isi | Catatan untuk Tahap 6 |
|---|---|---|
| `apps/worker/src/pipeline/types.ts` | `CaptureExtractor { engine, model, promptVersion, extract({kind, images, ctx}) }`, `AiMatcher.match(items, ctx)`, `TransientError`/`PermanentError(code)` | Antarmuka extractor cukup. `AiMatcher` perlu konteks tambahan (F-112). |
| `process-capture.ts` | claim → unduh + cek sha256 → extract → `record_run_output` (selalu) → zod `ParsedOutputSchema` → lokasi → `match_products` (tier 1–3) → AI hanya tanpa kandidat → `apply_extraction` | Langkah gambar (§6) disisipkan setelah cek sha256. Sisanya tetap. |
| `extractors/stub.ts` | Fixture per sha256 gambar posisi 1 | Tetap default CI/e2e. Ditambah mode fallback untuk e2e kamera (Q-118). |
| `jobs/redact.ts` | Regex HP, kartu, email + nilai `pii` | Diperluas (§9). |
| `packages/contracts/src/parsed.ts` | `ParsedReceipt` (header, `pii`, `lines`, `adjustments`, `member_hint`), `ParsedObservation`, `UsageSchema` | Tidak diubah, kecuali tambahan opsional yang kompatibel (§11.3). |
| `packages/ai-tools` | 6 tool baca, zod → JSON Schema, `runTool()` mengembalikan error sebagai data | Dipakai langsung oleh `/api/ask`. |
| `apps/web/features/ask`, `lib/ask/ask.ts` | Kerangka S-20, `AskReply` (answer, not_enough, ambiguous, out_of_scope, loading, coming_soon), `screenHref` | Diisi jawaban sungguhan. `S-03b` belum dipetakan (F-113). |
| `processing_run` | `ocr_engine`, `ai_model`, `prompt_version`, `input_tokens`, `output_tokens`, `cost_usd`, `raw_ocr_text`, `raw_ai_output` | Cukup untuk mencatat biaya per capture. |

### 1.2 Cakupan Tahap 6

1. Uji OCR D-16 dan harness (§4).
2. `EXTRACTOR=vision | ocr+parse` untuk struk, label, screenshot (§5).
3. Matcher AI tier 4 (§7).
4. Kalibrasi confidence per tier, `fuzzy_min_similarity`, `auto_save_min_confidence` (§8).
5. Gambar di worker: HEIC → JPEG, buang EXIF, validasi dekode (§6).
6. Redaksi PII di luar regex stub (§9).
7. Item tinjauan Tahap 6: Q-34/D-74, Q-77, Q-80/Q-81/Q-97, Q-87, Q-72/Q-78/Q-82 (§11, §13).
8. Tanya (§10).

Di luar cakupan: hosting worker (Q-17, Tahap 7), Batches API untuk pipeline interaktif (F-116), perbandingan per keranjang (D-39), AI yang menulis data.

### 1.3 Model dan API (diperiksa lewat skill `claude-api`, cache 2026-10-06)

| Model | ID | Input / output per 1 juta token | Catatan yang memengaruhi desain |
|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | US$4 / US$20 (cache read US$0,20) | Default. Thinking tidak bisa dimatikan; `effort` default `medium`, diatur eksplisit. `tool_choice` `any`/`tool` ditolak (400). Mendukung `fallbacks: "default"` server-side untuk `refusal`. |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | US$2 / US$10 | `tool_choice` paksa ditolak. Effort default `high`. |
| Claude Haiku 5.5 | `claude-haiku-5-5` | US$0,10 / US$0,50 (prompt ≤ 100K token) | Effort default `medium`. Refusal tanpa fallback server-side. Resolusi gambar maksimum dicek lewat Models API saat 6b. |

- Gambar: model generasi ini menerima sisi panjang hingga **2576 px**, maksimum ±4.784 token per gambar. Perkiraan token ≈ lebar × tinggi / 750.
- HEIC **tidak** diterima sebagai input gambar (JPEG, PNG, WebP, GIF saja), sehingga konversi di worker wajib (docs/07 §6.4).
- Structured outputs (`output_config.format`) tersedia di ketiga model. Skema tidak mendukung `minimum`/`maximum`, `minLength`/`maxLength`, dan skema rekursif. SDK TypeScript membuang batasan itu dan memvalidasinya di klien.
- Harga di atas berasal dari cache skill. Sebelum memutuskan anggaran, harga diperiksa ulang di halaman pricing resmi (§12).

---

## 2. Temuan (F-106 dst.)

| # | Temuan | Dampak | Usulan | Ke |
|---|---|---|---|---|
| F-106 | **Worker belum pernah mendekode gambar.** Format hanya ditolak lewat "tidak ada fixture" di stub. Claude vision tidak menerima HEIC. Paket `sharp` prebuilt tidak menyertakan dekoder HEVC (HEIC iPhone), hanya AVIF. | Begitu stub diganti, HEIC dari browser non-Safari (P-07) dan file rusak (F-40) akan menghasilkan 400 dari API, yang salah diklasifikasi sebagai error sementara dan diulang 3×. | Langkah `prepareImages` di pipeline (§6): magic bytes → sharp (JPEG/PNG/WebP) atau `heic-decode` (libheif-wasm) → JPEG tanpa metadata. Gagal dekode → `PermanentError('unsupported')`. | §6, Q-112 |
| F-107 | **Timeout SDK vs lease.** Default SDK: timeout 10 menit, 2 retry, sehingga satu panggilan bisa memakan hingga 30 menit. Lease run 300 dtk (D-70). Retry SDK dan retry pipeline juga saling berlipat. | Run di-reap sebagai `timeout` saat panggilan masih berjalan. Hasil yang datang belakangan dibuang (`stale`), tetapi biayanya tetap terpakai. Biaya retry bisa 3 × 3 = 9 panggilan. | `new Anthropic({ timeout: 120_000, maxRetries: 1 })` plus `AbortSignal` dengan tenggat `lease − 30 dtk` dari waktu claim. Retry panjang hanya lewat pipeline (D-70). | §5.4 |
| F-108 | **Kontrak `ParsedOutputSchema` tidak bisa langsung dipakai sebagai skema structured outputs:** ada `union`, `superRefine`, regex, `min/max`, dan `default`. `tool_choice` paksa juga ditolak di Opus 5.5 / Sonnet 5.5. | Mengirim skema kontrak apa adanya akan ditolak, atau batasannya diam-diam dibuang. | Skema LLM terpisah per jenis (datar, tanpa batasan angka, enum eksplisit), konverter deterministik ke kontrak, lalu `ParsedOutputSchema.safeParse` yang sudah ada sebagai gerbang akhir. Kontrak tidak berubah. | §5.2 |
| F-109 | **Confidence dari model tidak terkalibrasi.** `parse_confidence` dan `field_confidence` saat ini berasal langsung dari extractor (stub: angka tulisan tangan). Model cenderung melaporkan 0,95–0,99 untuk hampir semua field. | Dengan τ = 0,90, salah baca angka bisa langsung auto-save dan masuk harga terbaik. | Confidence gabungan: `min(confidence model, hasil cek deterministik)`. Cek: qty × harga satuan = nominal baris, Σ baris vs total, tanggal masuk akal, harga promo ≤ normal. Dikalibrasi di harness (§8). | §5.3, §8, Q-107 |
| F-110 | **Vision tidak punya "teks OCR mentah".** PROJECT.md §3 mewajibkan teks OCR mentah disimpan untuk audit dan proses ulang. | Tanpa transkripsi, `processing_run.raw_ocr_text` kosong untuk vision, sehingga audit, redaksi, dan perbandingan OCR tidak bisa dilakukan. | Model diminta mengeluarkan transkripsi baris per baris (dengan PII sudah disamarkan, §9) di field `transcript`. Tambahan output ±600–1.000 token per struk. | Q-106 |
| F-111 | **Confidence tier 1–2b ditulis langsung di SQL** (`1.00`, `0.98`, `0.95`, `0.70` di `match_products`). Tier 3 memakai skor similarity mentah, sehingga similarity 1,0 = auto-save (fixture `shopee-milo`). | Kalibrasi butuh migration setiap kali nilai berubah. Fuzzy match yang mirip tapi salah ukuran (Milo 200 g vs 500 g) bisa auto-save. | Kunci `app.config` per tier + `fuzzy_max_confidence` (default 1,0 = perilaku sekarang), dibaca `match_products`. Nilai diubah tanpa migration. | §8, §11 |
| F-112 | **`AiMatcher` tidak punya konteks yang dibutuhkan matcher sungguhan.** `UnmatchedItem` hanya `raw_text` + `barcode`. Tidak ada harga, ukuran, atau daftar kandidat dari katalog yang boleh dilihat household. | Matcher harus menebak dari pengetahuan umum (melanggar "AI bukan database"), atau membaca katalog tanpa RLS. | Fungsi SQL `app.ai_match_shortlist` (DEFINER, hanya worker) mengembalikan ≤ 15 produk aktif global + privat household per item. `UnmatchedItem` ditambah `amount`, `quantity`, `store_name` (tipe internal worker, bukan kontrak). | §7 |
| F-113 | **Tool `harga_per_satuan` mengembalikan `layar.id = 'S-03b'`**, tetapi `AskScreenRef` di `apps/web/lib/ask/ask.ts` hanya mengenal S-02/S-03/S-04/S-05. `screenHref` tidak punya cabang default, jadi hasilnya `undefined`. | Jawaban "harga per satuan" di S-20 tidak punya tautan ke layar sumber (U-18). | Tambah `S-03b` → `/produk?id=…` dengan sheet cek harga terbuka. Dikerjakan di M5 (Tanya). | M5 |
| F-114 | `.env.example` menyebut default `STUB_FIXTURES_DIR` = `apps/worker/fixtures`, padahal kode memakai `apps/worker/test/fixtures`. | Kecil. Membingungkan saat menambah fixture. | Komentar `.env.example` diperbaiki di sesi ini. | selesai |
| F-115 | **Gambar struk berisi PII dan dikirim ke pemroses pihak ketiga** (Anthropic; juga vendor OCR untuk `ocr+parse`). Redaksi tidak bisa dilakukan sebelum gambar dikirim. | Ini termasuk transfer data pribadi ke pemroses menurut UU PDP. Teks privasi S-19 belum menyebutnya. | Teks privasi (`/saya/privasi`) menyebut pemroses AI dan tujuannya. Kunci API org dengan retensi sesuai kebijakan Anthropic yang berlaku (cek saat 6b). Vendor OCR dipilih dengan perhatian pada region dan retensi (Q-103). | Q-114 |
| F-116 | Batches API (diskon 50 %) bisa butuh waktu hingga 24 jam dan **menolak parameter `fallbacks`**. | Tidak cocok untuk pipeline interaktif (sesi belanja butuh hasil dalam hitungan detik). | Batch hanya untuk harness uji dan proses ulang massal. Pipeline memakai panggilan biasa. | §4.6 |
| F-117 | **Data uji asli berisiko ter-commit**: gambar, ground truth, dan output mentah semuanya berisi PII. `check-secrets.sh` belum memeriksa file gambar. | Satu `git add .` yang salah membocorkan struk ke riwayat git. | Folder data di `.data/ocr-eval/` (sudah di-gitignore lewat `.data/`). Harness menolak berjalan jika folder datanya tidak di-ignore (`git check-ignore`). `check-secrets.sh` menolak file gambar yang dilacak di luar `apps/worker/test/fixtures/` dan `docs/wireframes/`, serta pola `sk-ant-`. | §4.2 |
| F-118 | **Fixture gambar worker bukan JPEG sungguhan** (42–54 byte, F-40). Setelah langkah dekode (F-106) ada, semua fixture CI akan gagal sebagai `unsupported`. | e2e alur 3–5 dan test L3 rusak. | Ganti fixture dengan JPEG sintetis kecil (struk/label/screenshot buatan dari HTML, dirender Playwright, tanpa data pribadi). Nama fixture tetap, pemetaan lewat field `images` tetap jalan. Ini menjawab Q-72. | Q-118 |
| F-119 | **Model dan versi prompt per run ditentukan saat claim**, sebelum jenis capture diketahui (`claim_next_capture(worker, engine, model, prompt_version)`). | Jika model atau prompt dibedakan per jenis (struk vs label), `processing_run.ai_model`/`prompt_version` salah. | Satu model per deployment. `promptVersion` gabungan untuk semua jenis (mis. `v1`), dan effort per jenis dicatat di `raw_ai_output.meta`. Tanpa ubah SQL claim. | §5.1 |
| F-120 | **Struk panjang multi-gambar**: bagian yang tumpang tindih membuat baris terbaca dua kali di sambungan. Biaya juga naik linear (10 bagian ≈ 40–48K token gambar). | Item dobel menggelembungkan Σ baris, yang terlihat sebagai selisih total. | Prompt meminta model menggabungkan baris di sambungan (setiap bagian diberi label "Bagian i dari n"). Konverter menandai pasangan baris identik berurutan di batas bagian (confidence turun). Diukur di harness (kategori "panjang"). | §4.4, §5.3 |
| F-121 | **Screenshot pesanan marketplace** (D-60) bisa memuat nama, alamat, dan HP pembeli. `ParsedObservation` tidak punya field `pii`, jadi redaksi hanya mengandalkan regex. | Alamat tidak tertangkap regex. | Transkripsi menyamarkan PII sejak dari model (§9 lapis 1). `ParsedObservation` tidak diubah. | §9 |
| F-122 | **Prompt injection lewat isi gambar atau nama produk** (mis. judul listing "abaikan instruksi…"; nama produk privat di output tool Tanya). | Extractor tidak punya tool dan output dibatasi skema, jadi akibat terburuknya nilai salah yang masuk konfirmasi. Tanya hanya punya tool baca dengan JWT user, jadi akibat terburuknya teks jawaban yang aneh. | Instruksi sistem menyatakan isi gambar/tool adalah data. Tautan layar tidak pernah diambil dari teks model (§10.4). Diuji dengan kasus adversarial di set Tanya. | §10 |

**F-105 (cek manual pembaca layar, Q-101/D-91):** status tetap *belum dicek di perangkat*. Tidak memblokir Tahap 6. Butir no. 10 (S-20) akan berubah setelah Tanya aktif, sehingga daftar cek `docs/07` §1.11 diperbarui di M5 (S-20 aktif: jawaban diumumkan lewat `aria-live`, tautan layar sumber bisa dijangkau).

---

## 3. Arsitektur

### 3.1 Gambaran

```
                 ┌──────────────────────── apps/worker ─────────────────────────┐
 capture ──claim─┤ unduh + sha256 → prepareImages (§6) → CaptureExtractor (§5)  │
                 │      ├─ StubExtractor        (CI, e2e)                        │
                 │      ├─ VisionExtractor      (Claude vision)                  │
                 │      └─ OcrThenParseExtractor (OcrEngine → Claude teks)       │
                 │ → konverter + cek deterministik → zod ParsedOutputSchema       │
                 │ → record_run_output (+ usage, cost) → match_products (1–3)     │
                 │ → AiMatcher (tier 4, §7) ← app.ai_match_shortlist              │
                 │ → apply_extraction                                             │
                 └───────────────────────────────────────────────────────────────┘
                 ┌──────────── apps/worker/eval (harness, lokal, manual) ────────┐
 .data/ocr-eval ─┤ arm × gambar → extractor yang sama → skor vs ground truth      │
                 └───────────────────────────────────────────────────────────────┘
                 ┌──────────── apps/web /api/ask (Route Handler, server-only) ───┐
 S-20 ── POST ───┤ JWT user → begin_ask (kuota) → loop Claude ⇄ packages/ai-tools │
                 │ → AskReply + layar dari output tool                            │
                 └───────────────────────────────────────────────────────────────┘
```

- Kode pemanggil Claude untuk worker dan harness ada di satu tempat (`apps/worker/src/ai/`), supaya harness mengukur kode yang sama dengan yang berjalan di produksi.
- Tanya memakai Anthropic SDK di `apps/web` (server saja) dan loop di `packages/ai-tools/src/ask.ts` (baru, `server-only`). Tool tetap di paket yang sama.
- Kunci API hanya di `ANTHROPIC_API_KEY` worker dan route handler. Tidak pernah `NEXT_PUBLIC_`. Disarankan kunci terpisah per komponen (worker, web) dan per lingkungan, supaya pemakaian bisa dibedakan dan dicabut sendiri-sendiri.
- Tidak bergantung pada platform hosting (Q-17): worker tetap proses Node biasa. Mode `--once` cocok untuk penjadwal eksternal (cron/scale-to-zero), karena satu capture selesai dalam satu lease.

### 3.2 Struktur folder baru

```
apps/worker/src/
  ai/
    claude.ts          # factory client (timeout, retry), callStructured(), pemetaan error → Transient/Permanent
    pricing.ts         # tabel harga per model (bertanggal), usage → costUsd
    budget.ts          # cek anggaran harian (§12.3)
  images/
    prepare.ts         # magic bytes, dekode, HEIC, orientasi, buang metadata, resize
  extractors/
    stub.ts            # (ada) + mode fallback e2e
    llm-schema.ts      # skema structured outputs per jenis (zod → JSON Schema)
    prompts/           # instruksi sistem per jenis, berversi (receipt.v1.md, label.v1.md, listing.v1.md)
    convert.ts         # LLM → ParsedReceipt/ParsedObservation + cek deterministik + confidence gabungan
    vision.ts          # VisionExtractor
    ocr-parse.ts       # OcrThenParseExtractor + antarmuka OcrEngine
    ocr/google-vision.ts
  matchers/
    claude-matcher.ts  # AiMatcher tier 4
apps/worker/eval/
  cli.ts               # ocr-eval: init | annotate | run | score | report
  arms.ts              # definisi varian
  score.ts             # penyelarasan baris + metrik
  annotate/            # alat anotasi lokal (HTML statis + server kecil di localhost)
  synthetic/           # generator struk/label/screenshot sintetis (HTML → JPEG via Playwright)
packages/ai-tools/src/
  ask.ts               # loop Tanya (server-only)
apps/web/app/api/ask/route.ts
```

---

## 4. Uji OCR (D-16) dan harness evaluasi

### 4.1 Pertanyaan yang dijawab

1. Apakah Claude vision langsung cukup akurat untuk struk Indonesia (thermal, pudar, miring, panjang), atau OCR khusus + Claude parse lebih baik?
2. Model dan effort mana yang memenuhi batas akurasi dengan biaya terendah?
3. Berapa nilai τ (`auto_save_min_confidence`) yang memberi presisi auto-save ≥ 98 %, dan berapa persen baris yang tetap auto-save (coverage)?
4. Apakah deteksi diskon member lewat regex teks (D-74) cukup (Q-34)?
5. Berapa biaya dan latensi per struk, per label, dan per screenshot?

### 4.2 Data: tempat, penyerahan, dan pengamanan

**Tempat:** `<repo>/.data/ocr-eval/` di mesin pemilik proyek. Folder `.data/` sudah ada di `.gitignore`. Folder lain di luar repo bisa dipakai lewat `OCR_EVAL_DIR`.

```
.data/ocr-eval/
  manifest.json            # daftar id, jenis, kategori, split (dev/test); TANPA teks struk
  images/<id>-<pos>.jpg    # gambar apa adanya dari HP (HEIC boleh)
  truth/<id>.json          # ground truth (§4.3)
  runs/<waktu>-<arm>/<id>.json   # output mentah, usage, latensi per gambar
  reports/<waktu>.md|.json       # laporan
```

**Pengaman (F-117):**
- `ocr-eval` menolak berjalan jika `git check-ignore -q "$OCR_EVAL_DIR"` gagal (folder data dilacak git).
- `scripts/check-secrets.sh` ditambah: tolak file `*.jpg|*.jpeg|*.png|*.heic|*.webp` yang dilacak di luar `apps/worker/test/fixtures/`, `apps/web/e2e/fixtures/`, `docs/wireframes/`, dan pola `sk-ant-[A-Za-z0-9_-]{20,}`.
- Yang di-commit dari uji hanya `reports/*.json` versi **agregat** (angka per metrik/kategori/arm, tanpa teks, nama toko diganti kategori jenis toko) ke lampiran dokumen ini di 6b.

**Cara menyerahkan (usulan default, Q-105):** pemilik proyek menjalankan harness di mesinnya sendiri.

| # | Langkah pemilik proyek | Perintah |
|---|---|---|
| 1 | Salin foto ke `.data/ocr-eval/inbox/` (dari HP via kabel/AirDrop/Drive pribadi) | — |
| 2 | Buat manifest dan nama file standar (id acak, tidak memakai nama toko) | `pnpm --filter @priceatlas/worker ocr-eval init` |
| 3 | Pra-isi ground truth dengan arm terbaik, lalu periksa dan koreksi setiap field di alat anotasi lokal (gambar di kiri, form di kanan) | `ocr-eval annotate --prefill vision-opus-medium` lalu buka `http://localhost:4317` |
| 4 | Jalankan semua arm pada split `test` | `ocr-eval run --set test --arms all --repeat 2` |
| 5 | Buat laporan, kirim/commit `report.agg.json` saja | `ocr-eval report` |

Gambar asli tidak pernah melewati sesi Claude Code ini. Sesi 6b membangun harness dan menjalankannya pada **data sintetis** (§13.1). Alternatif: folder Google Drive privat yang dibaca sesi 6b ke `.data/` (lebih cepat untuk iterasi prompt, tetapi gambar berisi PII masuk ke lingkungan cloud sesi). Lihat Q-105.

**Pra-isi dan bias:** pra-isi dari model mempercepat anotasi tetapi bisa membuat anotator menyetujui kesalahan model. Mitigasi: alat anotasi menandai setiap field "belum diperiksa" sampai disentuh. 5 struk pertama dianotasi **tanpa** pra-isi untuk mengukur selisihnya. Jika selisih > 1 % field, semua struk diperiksa ulang tanpa pra-isi.

### 4.3 Format ground truth

Satu file per capture, divalidasi oleh skema kontrak yang sama dengan worker, ditambah anotasi uji:

```jsonc
// truth/r-7f3a.json
{
  "id": "r-7f3a",
  "kind": "receipt",                       // receipt | price_label | marketplace
  "images": ["r-7f3a-1.jpg", "r-7f3a-2.jpg"],
  "split": "test",                         // dev | test (ditetapkan saat init, acak berstrata)
  "store_category": "minimarket",          // minimarket | supermarket | hypermarket | apotek | lokal | marketplace
  "conditions": ["long", "faded"],         // long | faded | skewed | crumpled | dark | glare | handwritten
  "expected": { /* ParsedReceipt persis kontrak: kind, store_hint, header, pii, lines, adjustments, member_hint */ },
  "annotations": {
    "lines": {                             // per line_no di expected
      "3": { "weighed": true },            // item timbang: quantity = berat (kg)
      "4": { "member_discount": true }     // baris diskon karena member (Q-34)
    },
    "transcript_pii": ["081298765432", "4321", "BUDI S"],   // nilai PII yang TIDAK boleh muncul setelah redaksi
    "notes": "baris 7 tertutup lipatan; nilai dari struk fisik"
  },
  "verified": { "by": "owner", "at": "2026-11-05", "prefill": "vision-opus-medium" }
}
```

Aturan anotasi (ditulis juga di alat anotasi):
- `raw_text` = deskripsi item saja (Q-28/D-63), persis seperti tercetak (huruf besar, singkatan).
- Nominal dalam rupiah bulat. Item timbang: `quantity` = berat dalam kg (3 desimal), `unit_amount` = harga per kg.
- Baris yang tidak terbaca oleh manusia ditulis `"unreadable": true` di `annotations.lines` dan tidak dihitung.
- `field_confidence` dan `parse_confidence` di ground truth **tidak diisi** (diabaikan skor).
- Label/screenshot: `expected` = `ParsedObservation`. `region` tidak dinilai, tetapi `image_position` dinilai.

### 4.4 Komposisi sampel

| Jenis | Jumlah | Rincian yang diminta |
|---|---|---|
| Struk | **40** (minimum 30) | Minimarket (Indomaret, Alfamart, Alfamidi) 10 · Supermarket (Superindo, Hero, Ranch, Farmers, Lotte, Transmart, Hypermart) 10 · AEON 4 · Apotek/drugstore (Guardian, Watsons, Century, K24) 4 · Toko lokal/independen atau pasar modern 4 · Bebas 8 |
| — kondisi (boleh tumpang tindih) | | ≥ 6 dengan item timbang · ≥ 6 dengan diskon member/kartu · ≥ 5 struk panjang multi-gambar (2–5 bagian) · ≥ 5 pudar/kusut/miring · ≥ 3 struk lama (> 1 bulan, thermal memudar) · ≥ 3 dengan void/refund · ≥ 3 dengan kantong plastik/donasi |
| Label harga | **20** | Normal saja 6 · Promo dengan periode 6 · Harga member (dua harga) 5 · Satu foto berisi > 1 label 3 |
| Screenshot | **10** | Shopee 4 · Tokopedia 3 · lainnya (Blibli, TikTok Shop, Lazada) 3; 2 di antaranya halaman pesanan (berisi alamat, untuk uji PII) |

**Split:** 30 % *dev* (untuk menyetel prompt), 70 % *test* (dikunci, dinilai sekali per versi prompt final). Pembagian berstrata per kategori toko. Semua keputusan D-16 diambil dari *test*. Ini mencegah prompt disetel pas untuk 40 struk yang sama.

### 4.5 Varian yang dibandingkan (arm)

| Arm | Isi | Mengapa |
|---|---|---|
| `vision-opus-low` | Opus 5.5, effort `low`, gambar langsung | Kandidat default termurah di model terbaik |
| `vision-opus-medium` | Opus 5.5, effort `medium` | Batas atas akurasi yang realistis; juga pra-isi anotasi |
| `vision-sonnet` | Sonnet 5.5, effort `medium` | ±½ biaya Opus |
| `vision-haiku` | Haiku 5.5, effort `medium` | ±1/40 biaya Opus; menentukan apakah jalur murah layak |
| `ocr-gcv+opus-low` | Google Cloud Vision `DOCUMENT_TEXT_DETECTION` → teks + koordinat → Opus 5.5 `low` (teks saja, gambar tidak dikirim) | Pembanding D-16 "OCR khusus + Claude parse" |

Arm opsional (tidak dijalankan kecuali diminta): OCR lokal (PaddleOCR/Tesseract) + Opus, untuk opsi tanpa vendor OCR; AWS Textract `AnalyzeExpense` atau Azure Document Intelligence `prebuilt-receipt` (keduanya khusus struk, Q-103).

Semua arm memakai **prompt dan skema LLM yang sama** (§5.2) dan konverter yang sama. Perbedaannya hanya sumber input (gambar atau teks OCR) dan model/effort.

### 4.6 Menjalankan

- Mode **batch** (Message Batches API, diskon 50 %, tanpa `fallbacks`, F-116) untuk akurasi dan biaya. Hasil dikunci per `custom_id = <arm>:<id>:<repeat>`.
- Mode **realtime** untuk latensi: subset 10 struk + 5 label per arm, panggilan biasa, diukur dari kirim sampai respons lengkap (termasuk `prepareImages`).
- `--repeat 2` pada split test untuk mengukur ketidakstabilan (persentase field yang berbeda antar-ulangan).
- Batas biaya keras: harness menjumlahkan biaya dari `usage` dan berhenti jika melewati `--budget` (default US$75).

### 4.7 Metrik

**Penyelarasan baris.** Baris prediksi dipasangkan ke baris ground truth dengan algoritma Hungaria, biaya = `1 − similarity(raw_text)` + penalti jika `line_amount` berbeda. Pasangan dengan similarity < 0,4 dan nominal berbeda dianggap tidak berpasangan.

| Kelompok | Metrik | Definisi |
|---|---|---|
| Header | toko | Nama jaringan ternormalisasi sama (`AEON` = `AEON BSD`?, dibandingkan setelah `app.normalize_text` + alias toko seed) |
| | cabang | Token cabang ground truth terkandung di prediksi |
| | tanggal, jam | Persis (jam ± 1 menit) |
| | total, subtotal | Persis (rupiah) |
| | metode bayar | Persis (enum ternormalisasi) |
| Baris | recall/presisi baris produk | Baris `product` berpasangan / total ground truth, dan / total prediksi |
| | `line_type` | Akurasi pada pasangan |
| | nominal | `line_amount` persis; `quantity`, `unit_amount` persis (jika ada di ground truth) |
| | teks item | CER (character error rate) `raw_text` setelah normalisasi spasi; ≤ 0,1 dianggap benar |
| | diskon | Baris diskon terdeteksi **dan** `applies_to_line_no` menunjuk pasangan yang benar |
| | void | Sama dengan diskon |
| | non-produk | Kantong plastik/donasi diklasifikasi `non_product` (bukan `product`) |
| | timbang | Pada baris `weighed`: berat (3 desimal), harga/kg, nominal persis |
| | member | Presisi/recall `member_discount` (lewat konverter, §11.3) dan regex D-74 pada baris diskon yang sama (Q-34) |
| Struk utuh | "struk sempurna" | Toko + tanggal + total benar **dan** semua baris produk berpasangan dengan nominal benar |
| | jumlah koreksi | Jumlah field yang harus diubah user di S-10 (proksi beban UX) |
| | Σ baris = total | Persentase struk dengan selisih 0 (sinyal kualitas §5.7) |
| Label/screenshot | harga | Normal, promo, member persis; promo_min_qty; periode promo; nama program |
| | produk | CER `raw_text`/`listing_title` |
| | item | Recall item (label ganda dalam satu foto) |
| Confidence (§8) | presisi auto-save @τ | Dari baris yang confidence gabungannya ≥ τ, berapa persen yang semua field angkanya benar |
| | coverage @τ | Persentase baris produk dengan confidence ≥ τ |
| | ECE | Expected calibration error, 10 rentang |
| PII | recall `pii` | Nilai di `annotations.transcript_pii` tertangkap di `pii` (struk) |
| | kebocoran | Nilai `transcript_pii` yang masih muncul di transkripsi **setelah** redaksi (§9). Target 0 |
| Operasional | biaya | US$ per capture dari `usage` (input, output, cache) × tabel harga + biaya OCR vendor |
| | latensi | p50/p95 realtime |
| | kegagalan | Persentase `refusal`, output tidak lolos skema kontrak, timeout |
| | stabilitas | Persentase field berbeda antar-ulangan |

Semua metrik dilaporkan total dan per kategori toko dan kondisi.

### 4.8 Kriteria keputusan D-16

1. **Batas minimum** (split test, struk):
   - presisi auto-save @τ ≥ **98 %** dengan coverage ≥ **60 %**,
   - nominal baris produk ≥ **97 %**, recall baris produk ≥ **97 %**,
   - tanggal ≥ **98 %**, total ≥ **98 %**, toko ≥ **95 %**,
   - kebocoran PII = **0**,
   - kegagalan (refusal + skema + timeout) ≤ **2 %**.
2. Dari arm yang lolos: **biaya per struk terendah**.
3. Jika dua arm berselisih < 1 poin di metrik "struk sempurna": pilih **vision** (satu vendor, satu panggilan, tanpa kunci OCR tambahan).
4. Label dan screenshot dinilai terpisah dengan batas yang sama (harga ≥ 97 %). Jika model termurah lolos untuk struk tetapi gagal di label (atau sebaliknya), model per jenis tetap boleh, dengan catatan F-119.
5. Jika tidak ada arm yang lolos: pilih arm dengan presisi auto-save tertinggi, τ dinaikkan sampai presisi ≥ 98 % (coverage berapa pun), dan dicatat sebagai risiko.

Hasil uji ditulis sebagai lampiran §A di dokumen ini (6b M1), lalu keputusannya dicatat sebagai D-9x. Pemilihan model yang lebih murah daripada Opus 5.5 adalah **keputusan pemilik proyek** berdasarkan angka ini (Q-102).

---

## 5. Extractor sungguhan

### 5.1 Pemilihan lewat env

```
EXTRACTOR=stub | vision | ocr+parse         # default stub
ANTHROPIC_API_KEY=                          # wajib untuk vision / ocr+parse
EXTRACT_MODEL=claude-opus-5-5               # satu model per deployment (F-119)
EXTRACT_EFFORT_RECEIPT=medium               # low | medium | high (hasil uji)
EXTRACT_EFFORT_OBSERVATION=low
OCR_ENGINE=google-vision                    # hanya ocr+parse
GOOGLE_VISION_API_KEY=                      # atau kredensial service account (Q-103)
AI_DAILY_BUDGET_USD=                        # opsional; override app.config (§12.3)
```

`buildDeps` (`main.ts`) memilih implementasi. `EXTRACTOR` selain `stub` tanpa `ANTHROPIC_API_KEY` → worker gagal start dengan pesan jelas (bukan gagal per capture).

| Field `CaptureExtractor` | `VisionExtractor` | `OcrThenParseExtractor` |
|---|---|---|
| `engine` | `claude-vision` | `gcv+claude` |
| `model` | `EXTRACT_MODEL` | `EXTRACT_MODEL` |
| `promptVersion` | `v1` (gabungan semua jenis, F-119) | `v1` |

### 5.2 Panggilan Claude

Satu panggilan per capture, berisi semua gambar sesuai `position`:

```ts
// Sketsa, bukan kode final. API diperiksa terhadap versi SDK yang dipasang saat 6b.
const msg = await client.messages.parse({
  model, max_tokens: 16000,
  thinking: { type: 'adaptive' },
  output_config: { effort, format: zodOutputFormat(LlmReceiptSchema) },
  system: [{ type: 'text', text: RECEIPT_PROMPT_V1, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: [
    { type: 'text', text: `Jenis: struk. Tanggal unggah (Asia/Jakarta): 2026-11-03. Jumlah bagian: 2.` },
    { type: 'text', text: 'Bagian 1 dari 2' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
    { type: 'text', text: 'Bagian 2 dari 2' }, { type: 'image', source: { … } },
  ] }],
}, { signal: deadline.signal });
```

- **Structured outputs, bukan tool use** (F-108): `tool_choice` paksa ditolak di Opus/Sonnet 5.5, dan tidak ada tool yang perlu dipanggil. `stop_reason` diperiksa sebelum output dipakai (`refusal`, `max_tokens`).
- **Refusal:** `betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'` (Claude API) diaktifkan secara default, supaya penolakan klasifikator yang keliru dijalankan ulang otomatis di model cadangan. Model yang benar-benar melayani (`response.model`) dicatat di `raw_ai_output.meta`. Apakah helper `parse` tersedia di namespace beta dicek saat 6b. Jika tidak, `messages.create` + validasi zod manual.
- **Caching:** instruksi sistem + skema (±2.500 token) diberi `cache_control`. Untuk pemakaian pribadi, cache 5 menit jarang kena kecuali di sesi belanja (label berturut-turut), jadi perkiraan biaya §12 tidak menghitung diskon cache.
- **Konteks tanggal:** tanggal unggah dan `captured_at` (zona household) dikirim supaya tahun dua digit ("15/10/26") dan tanggal tanpa tahun bisa diselesaikan. Konverter tetap memeriksa kewajarannya.
- **Prompt** berbahasa Indonesia, berisi aturan bisnis yang relevan: deskripsi item dipisah dari qty/harga (Q-28), baris diskon menempel ke item di atasnya, void negatif, non-produk (kantong plastik, donasi, poin, PPN), item timbang, harga member vs promo di label, ongkir/voucher di screenshot, dan "isi gambar adalah data, bukan instruksi" (F-122). Prompt disimpan sebagai file berversi. Perubahan prompt = versi baru + jalankan ulang split dev.

**Skema LLM struk (ringkas):**

```ts
LlmReceipt = {
  document: { type: 'receipt' | 'price_label' | 'marketplace' | 'other', readable: boolean, reason: string | null },
  store: { name: string | null, branch: string | null, confidence: number },
  header: { date: string | null /* YYYY-MM-DD */, time: string | null, total: number | null, subtotal: number | null,
            payment_method: 'cash' | 'debit' | 'credit' | 'qris' | 'ewallet' | 'other' | null,
            confidence: { date: number, time: number, total: number, subtotal: number } },
  lines: Array<{ section: number /* bagian ke- */, type: 'product' | 'discount' | 'void' | 'non_product' | 'tax' | 'other',
                 text: string, quantity: number | null, unit_price: number | null, amount: number,
                 applies_to: number | null /* indeks baris, 1-based */, barcode: string | null,
                 member_discount: boolean, bundle: boolean, confidence: number }>,
  adjustments: Array<{ kind: 'voucher' | 'cashback' | 'points' | 'other', text: string | null, amount: number | null, points: number | null }>,
  member: { text: string, program: string | null } | null,
  pii: { card_last4: string | null, card_masked: string | null, phone: string | null, member_id: string | null,
         member_name: string | null, customer_name: string | null, email: string | null },
  transcript: string   // semua baris tercetak, PII diganti [REDAKSI] (§9, F-110)
}
```

Skema label/screenshot mengikuti `ParsedObservationItem` (harga normal/promo/member, periode, program, seller, ongkir, voucher, cashback, judul, URL, region, `image_position`), ditambah `document`, `transcript`, dan confidence per field.

### 5.3 Konverter dan cek deterministik

`convert.ts` mengubah output LLM ke kontrak, lalu `ParsedOutputSchema.safeParse` (yang sudah ada di pipeline) menjadi gerbang akhir.

| Cek | Aturan | Akibat jika gagal |
|---|---|---|
| Jenis dokumen | `document.type` ≠ jenis capture | `PermanentError('not_a_receipt')` untuk struk, `unsupported` untuk lainnya (pesan yang sudah ada) |
| Terbaca | `document.readable = false` | `PermanentError('blurry')` |
| Penomoran | `line_no` = urutan 1..n; `applies_to` di luar rentang atau menunjuk baris non-produk | Diskon/void dilepas → `line_type: 'other'`, confidence 0,5 |
| Aritmetika baris | `quantity × unit_price` ≠ `amount` (± Rp1; timbang ± Rp50) | `parse_confidence` ≤ 0,6 |
| Total | Σ(product + non_product + discount + void + tax) ≠ `total` | `field_confidence.total` ≤ 0,7. Tidak memaksa konfirmasi (D-50), tetapi tampil sebagai peringatan |
| Tanggal | Di luar [unggah − 400 hari, unggah + 1 hari] | `field_confidence.date` ≤ 0,5 (mencegah auto-save, D-71) |
| Sambungan bagian | Dua baris berurutan di batas bagian dengan teks + nominal identik (F-120) | Kedua baris `parse_confidence` ≤ 0,6 |
| Label | `promo_price` ≥ `normal_price`, atau periode terbalik | `field_confidence.price` ≤ 0,6 |
| Angka | Nominal bukan bilangan bulat untuk IDR | Dibulatkan, confidence ≤ 0,8 |

Confidence akhir per baris = `min(confidence model, batas dari cek)`. Pemetaan dari confidence model ke probabilitas benar dikalibrasi di §8 (fungsi monoton per arm, disimpan di `pricing.ts`/`calibration.ts` bersama versi prompt).

`rawText` = `transcript` (vision) atau teks OCR vendor (ocr+parse). `output` mentah LLM disimpan sebagai `raw_ai_output` (selalu, termasuk jika konversi gagal, §5.4 di docs/05).

### 5.4 Error, timeout, retry

| Kondisi | Kelas | Catatan |
|---|---|---|
| `RateLimitError` (429), `InternalServerError` (5xx), overloaded, `APIConnectionError`, timeout/abort | `TransientError` | Retry pipeline D-70 (30/120/600 dtk, maks 3). SDK `maxRetries: 1` saja (F-107). |
| `BadRequestError` (400) karena gambar | `PermanentError('unsupported')` | Seharusnya jarang karena `prepareImages` |
| `BadRequestError` lain, `AuthenticationError`, `PermissionDeniedError` | `TransientError` + log `ai.config_error` | Kesalahan konfigurasi, bukan kesalahan gambar. Capture tidak boleh `failed` permanen karena kunci salah. |
| `stop_reason = 'refusal'` setelah fallback | `PermanentError('other')` | "Gambar tidak bisa diproses." |
| `stop_reason = 'max_tokens'` | `TransientError` sekali (percobaan berikutnya `max_tokens` × 2), lalu permanen | Struk sangat panjang |
| Output tidak lolos kontrak setelah konversi | `PermanentError('unsupported')` (perilaku pipeline sekarang) | Output mentah tetap tersimpan |
| Anggaran harian habis (§12.3) | Tidak di-claim | Capture tetap `uploaded`, tidak memakan percobaan |

**Tenggat:** `AbortController` dengan tenggat `capture_processing_timeout_seconds − 30 dtk` dihitung dari waktu claim. Timeout per panggilan SDK 120 dtk. Dengan `maxRetries: 1`, panggilan terburuk 240 dtk < 270 dtk.

### 5.5 Struk multi-gambar dan batas

- Semua bagian dalam satu panggilan, urut `position`, berlabel "Bagian i dari n". Satu konteks memungkinkan model menggabungkan baris di sambungan dan membaca total di bagian terakhir.
- Batas: UI 10 bagian (D-81). Worker menolak > 12 gambar (`unsupported`) sebagai pengaman biaya. Ukuran request setelah `prepareImages` ≤ ±12 MB (base64), di bawah batas 32 MB.
- Label: satu foto bisa berisi beberapa label (`items[]`, `image_position`). Screenshot: beberapa screenshot dalam satu capture = satu item per screenshot, kecuali jelas satu listing panjang.

### 5.6 `OcrThenParseExtractor`

```ts
interface OcrEngine { readonly name: string; recognize(images: PreparedImage[]): Promise<{ position: number; text: string; lines: { text: string; box: Box }[] }[]> }
```

- Google Cloud Vision `DOCUMENT_TEXT_DETECTION`, satu request per gambar (paralel, maks 4). Teks per bagian dikirim ke Claude dengan label bagian dan koordinat baris (untuk `region` label).
- Prompt dan skema LLM sama dengan vision, ditambah petunjuk bahwa input adalah teks OCR yang bisa salah baca (O ↔ 0, I ↔ 1, rp ↔ Rp).
- Error vendor OCR dipetakan dengan aturan yang sama (5xx/429 → sementara).
- Hanya dibangun penuh jika D-16 memilihnya. Untuk uji, implementasinya cukup untuk harness.

---

## 6. Gambar di worker (HEIC, EXIF, F-40)

Langkah `prepareImages` di `process-capture.ts`, tepat setelah verifikasi sha256 dan sebelum extractor. Berlaku untuk semua engine, termasuk stub (karena itu fixture diganti, F-118).

| # | Langkah | Detail |
|---|---|---|
| 1 | Kenali tipe dari magic bytes | JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF….WEBP`, HEIC `ftyp` + `heic/heix/hevc/mif1/msf1`. Ekstensi file diabaikan (Safari kadang memberi `.jpg` untuk HEIC dan sebaliknya). Tipe lain → `unsupported`. |
| 2 | Dekode | JPEG/PNG/WebP: `sharp` (libvips). HEIC: `heic-decode` (libheif via WASM) → RGBA → `sharp`. `limitInputPixels` = 50 MP (pengaman bom dekompresi). |
| 3 | Orientasi | `sharp().rotate()` mengikuti EXIF Orientation, lalu metadata dibuang (default sharp tanpa `withMetadata`). EXIF GPS tidak pernah dikirim ke API. |
| 4 | Ukuran | Sisi panjang ≤ 2576 px (batas model). Klien sudah ≤ 2560 px (D-82), jadi biasanya tidak berubah. HEIC 4032 px dari non-Safari dikecilkan. |
| 5 | Encode | JPEG kualitas 90, sRGB. PNG screenshot kecil (≤ 1,5 MB, ≤ 2576 px) dikirim sebagai PNG apa adanya (teks UI lebih tajam). |
| 6 | Validasi | Gagal dekode, ukuran < 200 px di sisi pendek, atau file 0 byte → `PermanentError('unsupported', 'Gambar tidak bisa dibuka. Coba foto ulang atau pilih foto lain.')`. |

- Hasil hanya ada di memori. **Gambar asli di bucket tidak diubah**: sha256 dipakai untuk deteksi duplikat dan audit (D-32). HEIC dari browser non-Safari tetap menyimpan EXIF/GPS di bucket privat sampai purge 12 bulan (P-08). Usulan: biarkan (kasus jarang, bucket privat). Alternatifnya mengganti objek dengan turunan bersih (Q-112).
- Waktu dekode HEIC 12 MP lewat WASM diperkirakan 0,5–2 dtk. Diukur di M0.
- Lisensi: `heic-decode`/libheif LGPL-3.0, dipakai sebagai dependensi server (tidak dibundel ke klien).

---

## 7. Matcher AI tier 4

### 7.1 Kapan dipanggil

Tetap D-75: hanya untuk item **tanpa kandidat sama sekali** dari tier 1–3. Satu panggilan per capture untuk semua item itu (bukan per item). Perluasan ke item dengan kandidat lemah (< τ, Q-36) diukur selama masa kalibrasi dan diputuskan sesudahnya (Q-108).

### 7.2 Daftar pendek dari database

`app.ai_match_shortlist(p_household uuid, p_store uuid, p_items jsonb, p_limit int default 15)` (DEFINER, `EXECUTE` hanya untuk role worker):
- Kandidat: produk `active`, global atau privat milik `p_household` (sama dengan aturan `match_products`). Tidak pernah produk privat household lain.
- Per item: `word_similarity` terhadap `search_text` + brand dengan ambang rendah `ai_match_shortlist_min_similarity` (0,2), ditambah produk yang pernah dibeli household di toko itu dengan kata pertama sama. Urut similarity, maks 15.
- Kolom yang dikirim ke model: indeks lokal (1..n), brand, nama, varian, ukuran (`pack_count × content_size content_unit`), mode jual (timbang/satuan), kategori. **UUID tidak dikirim.** Model memilih indeks, worker memetakan kembali, sehingga model tidak bisa mengarang id.
- Item tanpa daftar pendek sama sekali tidak dikirim ke model (tanpa biaya).

### 7.3 Panggilan dan hasil

- Input per item: teks struk (`raw_text`), nominal, kuantitas, nama toko, dan daftar pendeknya.
- Skema output: `[{ item: number, choice: number | null, confidence: number, reason: string }]`. `choice = null` jika tidak ada yang cocok. Model diminta memperhatikan ukuran: "MILO 1KG" ≠ Milo 500 g.
- Worker memvalidasi: `choice` harus ada di daftar pendek item itu, selain itu dibuang.
- `confidence` akhir = `min(confidence model, ai_match_max_confidence)` dengan default **0,85** < τ. Artinya saran AI selalu masuk konfirmasi dan tampil sebagai kandidat di S-14 (D-12 tetap). Batas dinaikkan hanya jika data kalibrasi menunjukkan presisi ≥ 98 % (Q-108).
- Model: `EXTRACT_MODEL`, effort `low`. Error apa pun di tier 4 **tidak** menggagalkan capture: item tetap tanpa saran (dicatat `ai.match_failed`).
- `AiMatcher.match` tetap antarmukanya, hanya `UnmatchedItem` dan `MatchContext` ditambah field (F-112). `StubAiMatcher` tidak berubah perilakunya.

### 7.4 Tidak dilakukan

AI tidak membuat produk, brand, alias, atau group. Alias baru tetap hanya dari keputusan user (§5.9).

---

## 8. Kalibrasi confidence dan ambang

### 8.1 Lapis 1: ekstraksi (dari harness)

- Untuk setiap arm: kumpulkan pasangan (confidence gabungan baris, benar/salah) dari split dev. Pasang fungsi monoton (isotonic) yang memetakan confidence ke probabilitas benar. Simpan sebagai tabel kecil per `model + promptVersion`.
- Laporkan di split test: kurva presisi–coverage, ECE, dan nilai τ terkecil dengan presisi ≥ 98 %.
- Header struk diperlakukan sama untuk toko dan tanggal (D-71). Total tidak ikut auto-save (D-50).

### 8.2 Lapis 2: matching (dari pemakaian nyata)

Harness tidak bisa mengukur matching tanpa katalog dan histori pemilik proyek. Jadi matching dikalibrasi dari pemakaian nyata:

1. **Masa kalibrasi** (default 2 minggu atau ≥ 150 baris produk, mana yang lebih lama): `auto_save_min_confidence` = 1,01, sehingga semua item masuk konfirmasi. Saran sistem tetap tampil di S-10/S-11, user cukup menekan "Benar".
2. Data sudah tercatat tanpa skema baru: `receipt_line.suggested_product_id`, `match_tier`, `match_confidence`, dan produk akhir di `price_record` (serta `capture_item` untuk observasi).
3. Skrip SQL `db/scripts/calibration_report.sql` (baca saja, dijalankan pemilik proyek): presisi per tier dan per rentang confidence = persentase saran yang diterima tanpa diganti.
4. Nilai baru ditulis ke `app.config`:

| Kunci baru | Default (= perilaku sekarang) | Dipakai |
|---|---|---|
| `match_conf_barcode` | 1,00 | tier 1 |
| `match_conf_alias_household` | 0,98 | tier 2 |
| `match_conf_alias_global` | 0,95 | tier 2 |
| `match_conf_alias_group` | 0,70 | tier 2b |
| `fuzzy_max_confidence` | 1,00 | tier 3: `min(similarity, nilai ini)` (F-111) |
| `ai_match_max_confidence` | 0,85 | tier 4 |
| `fuzzy_min_similarity` | 0,5 (ada) | tier 3 |
| `auto_save_min_confidence` | 0,90 (ada) | D-50 |

5. Setelah masa kalibrasi: τ kembali ke nilai hasil analisis (target presisi ≥ 98 %), dicatat sebagai keputusan final D-50 (`PROJECT.md`). Analisis diulang setelah 3 bulan.

Risiko: selama masa kalibrasi user mengonfirmasi lebih banyak (±10–20 ketukan per struk). Alternatifnya hanya memakai data harness (tanpa matching) dan menerima τ = 0,90 apa adanya (Q-107).

### 8.3 `fuzzy_min_similarity`

Data masa kalibrasi juga memberi distribusi similarity untuk saran fuzzy yang benar dan yang salah. Nilai 0,5 diturunkan jika banyak baris benar berada di 0,4–0,5 tanpa kandidat, dan dinaikkan jika kandidat ≤ 0,55 hampir selalu ditolak. Perubahan ini tidak memengaruhi auto-save secara langsung (auto-save tetap lewat τ).

---

## 9. Redaksi PII

| Lapis | Kapan | Isi |
|---|---|---|
| 1. Di sumber | Saat ekstraksi | Prompt meminta `transcript` dengan `[REDAKSI]` untuk nomor kartu, HP, email, nomor/nama member, nama pelanggan, alamat pengiriman, kode approval/ref kartu. Struktur `pii` tetap diisi (struk). Untuk OCR vendor, teks mentah vendor tetap utuh sampai lapis 3 berjalan. |
| 2. Nilai terstruktur | Job `redact_ocr` (D-64, 7 hari) | Nilai di `receipt.pii` (sekarang ditambah `member_id`, `member_name`, `customer_name`, `card_masked`, `email`) disamarkan dari teks dan JSON (sudah ada di `redactText`, hanya kunci yang bertambah). |
| 3. Regex | Job yang sama | Pola yang ada (HP, kartu, email) ditambah pola berbasis label baris: nilai setelah `NAMA`, `NAME`, `MEMBER`, `NO. MEMBER`, `ID MEMBER`, `KARTU`, `CARD`, `TELP`, `HP`, `PHONE`, `ALAMAT`, `PENERIMA`, `APPR`, `REF NO` sampai akhir baris; NIK 16 digit (sudah tertutup pola kartu). Pola dibatasi baris supaya tidak menghapus nama produk. |

- Tidak ada panggilan AI tambahan khusus redaksi: biayanya akan dobel, dan teks PII akan dikirim ulang ke pemroses.
- Diukur di harness (metrik "kebocoran", §4.7, target 0) dengan teks yang melewati ketiga lapis.
- Unit test `redact.ts` ditambah contoh sintetis untuk setiap pola baru, termasuk kasus negatif (nama produk yang mengandung "MEMBER" tidak terhapus).
- Log worker tetap tanpa teks/PII (docs/05 §7.4).

---

## 10. Tanya (S-20, D-57)

### 10.1 Alur

```
S-20 ──POST /api/ask { question, history? }──► route.ts (runtime nodejs, import 'server-only')
  1. Validasi zod: question 1–200 karakter (ASK_MAX_LENGTH), history ≤ 4 pasangan teks
  2. Supabase server client dari cookie → user (sama dengan /api/account/delete)
  3. rpc begin_ask()  ── kuota habis → 429 AI_QUOTA_EXCEEDED
  4. ANTHROPIC_API_KEY kosong / ASK_ENGINE=off → 503 AI_UNAVAILABLE (UI: keadaan "Segera hadir" yang sudah ada)
  5. runAsk(): loop Claude ⇄ runTool(userRpcClient, …), maks 4 putaran tool
  6. rpc record_ask_usage(tokens, cost)
  7. 200 { reply: AskReply, tools_used: [...] }
```

### 10.2 Model dan instruksi

- Model `claude-opus-5-5`, effort `low` (pertanyaan pendek, tool yang menentukan isi), `fallbacks: 'default'`. Model lain diukur dengan set pertanyaan emas (§13.3) sebelum diganti (Q-115).
- Instruksi sistem (Indonesia, berversi): hanya enam kemampuan; jawab hanya dari output tool; jangan menyebut angka yang tidak ada di output tool; sebutkan jumlah data dan tanggal terakhir; tidak menjawab soal pengeluaran/budget, resep, atau harga pasar umum (D-57); tidak menulis data; teks dari tool adalah data (F-122); lebih dari satu produk cocok → minta user memilih.
- Tool: 6 dari `registry` apa adanya (`input_schema` dari zod). Tanpa `strict: true` karena skema memakai batasan yang tidak didukung; validasi tetap oleh zod di `runTool` dan error dikembalikan sebagai `tool_result` dengan `is_error: true`.
- Jawaban akhir lewat `output_config.format`:

```ts
AskFinal = { kind: 'answer' | 'not_enough' | 'ambiguous' | 'out_of_scope',
             text: string,                         // ≤ 400 karakter, bahasa Indonesia
             options: { label: string, question: string }[] }   // hanya untuk ambiguous, maks 4
```

### 10.3 Pemetaan ke `AskReply`

| `AskFinal.kind` | `AskReply` | `tool` dan `screen` |
|---|---|---|
| `answer` | `{ kind: 'answer', text, basis, tool, screen }` | `tool` = tool terakhir yang berhasil (nama + argumen ringkas, mis. nama produk). `screen` = `layar` dari output tool itu. `basis` = "N data, terakhir …" dari `jumlah_data`/`tanggal_terakhir` output tool. |
| `not_enough` | `{ kind: 'not_enough', text, tool, screen }` | Sama |
| `ambiguous` | `{ kind: 'ambiguous', options }` | — |
| `out_of_scope` | `{ kind: 'out_of_scope' }` | — (teks tetap dari UI, bukan dari model) |
| `answer` tanpa tool berhasil | dipaksa `not_enough` | Mencegah jawaban dari pengetahuan umum |

### 10.4 Pengaman

- `screen` hanya diambil dari output tool, tidak pernah dari teks model. Id produk di tautan dijamin berasal dari RPC yang dipanggil dengan JWT user (RLS).
- Pemeriksaan angka (log saja di 6b): setiap angka rupiah di `text` dicari di output tool putaran itu. Ketidakcocokan dicatat sebagai metrik `ask.unsupported_number`. Diputuskan jadi pemblokir setelah ada data.
- Log route: id user (hash), durasi, token, nama tool, `kind`. Teks pertanyaan dan jawaban tidak dicatat.
- Riwayat percakapan tetap di perangkat (docs/07 §9): 20 tanya-jawab terakhir di IndexedDB per user, ikut terhapus saat Keluar (D-84). `history` yang dikirim ke server hanya teks pertanyaan dan jawaban (maks 4), tanpa output tool.
- Kuota (§11.1): `begin_ask()` (DEFINER, `authenticated`) mengunci baris household-hari, memeriksa `ask_daily_limit` (30) dan `ask_monthly_limit` (300), lalu menambah hitungan. `record_ask_usage()` hanya menambah token/biaya household sendiri. User yang memanggil RPC ini sendiri hanya bisa menghabiskan kuotanya sendiri, sehingga route tidak perlu service role.

### 10.5 Streaming dan offline

- **Tanpa streaming ke klien** di 6b: jawaban pendek, butuh 1–3 putaran tool, dan bentuk akhirnya terstruktur. UI memakai keadaan "Mencari di historimu…" yang sudah ada. Timeout route 45 dtk → pesan "Gagal menjawab. Coba lagi." Streaming ditinjau jika p95 > 10 dtk (Q-115).
- **Offline:** `/tanya` tetap di luar `SHELL_ROUTES`. Jika `navigator.onLine = false`, tombol Kirim nonaktif dengan petunjuk "Tanya butuh sinyal. Hasil cari tetap bisa dipakai offline." Riwayat di perangkat tetap terbaca. Pertanyaan tidak diantrekan.
- Teks UI baru di `lib/copy/id.ts`. Keadaan "Segera hadir" tetap ada untuk 503.

---

## 11. Perubahan skema, RPC, dan kontrak

Satu migration baru `supabase/migrations/2026110x000000_ai_integration.sql`, lalu `db/scripts/snapshot.sh`, `db/scripts/gen_inventory_test.sh` (diff ditinjau), dan `packages/db-types` dibangkitkan ulang di job CI. Setiap objek baru di-`REVOKE` eksplisit (F-09).

### 11.1 Skema dan fungsi

| # | Perubahan | Alasan |
|---|---|---|
| 1 | Kunci `app.config`: tabel §8.2, `ai_match_shortlist_min_similarity` 0,2, `ai_daily_budget_usd` 2,00, `ask_daily_limit` 30, `ask_monthly_limit` 300 | F-111, §12.3, §10.4 |
| 2 | `app.match_products` membaca kunci tier dari config. Dengan nilai default, hasilnya identik (dibuktikan test L1 yang ada) | F-111 |
| 3 | `app.ai_match_shortlist(...)` DEFINER, `EXECUTE` hanya role worker | §7.2, F-112 |
| 4 | `app.ask_usage (household_id, day, questions, input_tokens, output_tokens, cost_usd)`, PK `(household_id, day)`, cascade hapus household; `public.begin_ask()`, `public.record_ask_usage(...)` DEFINER | §10.4 |
| 5 | `app.ai_spend_today()` (DEFINER, worker): Σ `processing_run.cost_usd` + Σ `ask_usage.cost_usd` hari ini (zona DB) | §12.3 |
| 6 | **Q-77:** `capture_item.read_member_price numeric(14,2)`, `read_member_program_name text` (yang terbaca, tidak diubah user). `apply_extraction` mengisinya. W18 (ubah lokasi item) memetakan ulang: jika `member_program_id` kosong dan toko baru punya program yang cocok (aturan yang sama dengan §5.5) → `member_price`/`member_program_id` diisi, `extra.member_note` dihapus | Q-77, F-57 |
| 7 | **Q-34 (bersyarat):** `receipt_line.is_member_discount boolean` (NULL = tidak diketahui). Trigger turunan memakai `coalesce(is_member_discount, regex D-74)`. Hanya dibuat jika harness menunjukkan regex recall < 95 % pada diskon member asli | Q-34, Q-110 |

### 11.2 RPC (satu perubahan R18 + R20, Q-80/Q-81/Q-97/Q-87)

| RPC | Perubahan keluaran | Catatan |
|---|---|---|
| R18 `get_active_session` | `labels[]` ditambah `item_status` (`pending`/`accepted`/`rejected`, per item), `thumbnail_path` (`storage_path` gambar posisi 1, NULL jika sudah di-purge). `vs_best_pct` dihitung terhadap **termurah 90 hari tanpa record dari capture sesi ini** (helper `app.best_unit_price_excluding(product, household, capture_ids)` dengan aturan yang sama dengan ringkasan: aktif, bukan bundle, mata uang default, member hanya jika eligible) | Satu label bisa punya beberapa item, jadi satu baris per item (bentuk sekarang sudah per item lewat `capture_item`) |
| R20 `price_record_detail` | Ditambah `source_text`: `capture_item.raw_text` atau `extra.listing_title` untuk record observasi, `receipt_line.raw_text` untuk struk (sudah ada di `receipt_line`) | Teks alias S-16/S-18 untuk label (F-72) |

Frontend yang ikut berubah: S-13 (status per item, thumbnail lewat `createSignedUrls` satu panggilan untuk semua label, D-79), S-16/S-18 (teks alias). Kontrak keluaran di `packages/contracts/src/rpc.ts` ditambah field (aditif).

### 11.3 Kontrak (`packages/contracts`)

Hanya tambahan yang kompatibel:
- `ParsedReceiptLine.member_discount?: boolean` (opsional; stub dan fixture lama tetap valid). `apply_extraction` meneruskannya ke kolom #7 jika kolom itu dibuat.
- `pii` struk: kunci baru hanya nilai string, `z.record` yang ada sudah menerima.
- `errors.ts`: `AI_QUOTA_EXCEEDED` (429), `AI_UNAVAILABLE` (503), dengan pesan UI di `docs/07` §8.
- `ask.ts` baru: `AskRequestSchema`, `AskResponseSchema` (bentuk `AskReply` yang sudah ada di `apps/web/lib/ask/ask.ts` dipindah ke kontrak, ditambah `S-03b` (F-113)).

RLS tidak berubah. `ask_usage` di schema `app` (tidak terbaca klien).

---

## 12. Kontrol biaya dan estimasi

### 12.1 Asumsi token

| Input | Ukuran | Token |
|---|---|---|
| Bagian struk | 1100 × 2560 px (2,8 MP) | ±3.800 |
| Label | 2048 × 1536 px (3,1 MP) | ±4.200 |
| Screenshot | 945 × 2048 px (1,9 MP) | ±2.600 |
| Instruksi + skema | — | ±2.500 (dihitung tanpa diskon cache) |
| Output struk | JSON 20 baris ±1.800 + transkripsi ±800 + thinking (low ±800 / medium ±2.000) | low ±3.400 / medium ±4.600 |
| Output label/screenshot | JSON ±400 + transkripsi ±200 + thinking ±800 | ±1.400 |

Rata-rata 1,5 bagian per struk. Angka ini diganti hasil ukur `usage` dari harness di M1.

### 12.2 Perkiraan per capture dan per bulan (pemakaian pribadi)

| Per item | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 |
|---|---|---|---|
| Struk (effort medium) | US$0,125 | US$0,062 | US$0,003 |
| Struk (effort low, Opus) | US$0,10 | — | — |
| Label (low) | US$0,055 | US$0,027 | US$0,001 |
| Screenshot (low) | US$0,048 | US$0,024 | US$0,001 |
| Tier 4 per capture (low, ±3.000 in / 600 out) | US$0,024 | US$0,012 | US$0,001 |
| Tanya per pertanyaan (low, 2 putaran) | US$0,05 | US$0,025 | US$0,002 |

| Per bulan (asumsi) | Volume | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 |
|---|---|---|---|---|
| Struk | 16 | 2,00 | 0,99 | 0,05 |
| Label | 40 | 2,20 | 1,08 | 0,04 |
| Screenshot | 8 | 0,38 | 0,19 | 0,01 |
| Tier 4 | 30 capture | 0,72 | 0,36 | 0,03 |
| Tanya | 40 | 2,00 | 1,00 | 0,08 |
| Retry dan cadangan +10 % | | 0,73 | 0,36 | 0,02 |
| **Total** | | **±US$8** | **±US$4** | **< US$0,50** |

- Bulan pertama bisa ±1,5× karena katalog masih kosong (lebih banyak tier 4).
- `ocr+parse`: Google Cloud Vision ±US$1,5 per 1.000 gambar (1.000 gambar pertama per bulan gratis, menurut harga publik yang perlu dicek ulang) ditambah parse teks oleh Claude. Biaya Claude turun karena token gambar diganti token teks (±1.500 per bagian), sehingga total kira-kira sama dengan vision dengan model yang sama.
- Uji OCR: ±US$35–60 (5 arm × 70 gambar × 2 ulangan + iterasi prompt di dev), separuhnya lewat batch. Batas keras US$75.
- Untuk skala SaaS (D-03), biaya didominasi token output. Jalur model lebih kecil dan pengurangan transkripsi ditinjau di Tahap 7, bukan di sini.

### 12.3 Kontrol

| Kontrol | Tempat | Perilaku |
|---|---|---|
| Anggaran harian global | `app.config.ai_daily_budget_usd` (env `AI_DAILY_BUDGET_USD` override) | Sebelum claim, worker memanggil `app.ai_spend_today()`. Jika ≥ anggaran, worker tidak meng-claim (capture tetap `uploaded`, tidak memakan percobaan), log `ai.budget_exhausted` sekali per jam. Tanya mengembalikan 429 `AI_QUOTA_EXCEEDED`. |
| Kuota Tanya per household | `ask_daily_limit`, `ask_monthly_limit` | §10.4 |
| Batas gambar | 12 per capture, ≤ 2576 px | §5.5, §6 |
| `max_tokens` | 16.000 ekstraksi, 4.000 Tanya, 2.000 tier 4 | Mencegah output liar |
| Tier 4 hanya tanpa kandidat | D-75 | Tanpa biaya untuk item yang sudah cocok |
| Batas pengeluaran di Console Anthropic | Diatur pemilik proyek | Lapis terakhir di luar aplikasi |
| Pencatatan | `processing_run.input_tokens/output_tokens/cost_usd`, `ask_usage` | Biaya per capture terlihat. Tabel harga `pricing.ts` bertanggal. |

---

## 13. Rencana test

### 13.1 Prinsip

- **CI tidak pernah memanggil API berbayar.** `EXTRACTOR=stub` dan `ASK_ENGINE=stub` di e2e. Job CI tidak punya `ANTHROPIC_API_KEY`. Test live dilewati kecuali `LIVE_AI=1` dan kunci tersedia.
- Data sintetis untuk semua yang di-commit: generator di `apps/worker/eval/synthetic/` membuat struk, label, dan screenshot dari template HTML (font monospace thermal, noise, rotasi kecil) lalu merendernya ke JPEG dengan Playwright (sudah ada di lingkungan). Nilai ground truth-nya diketahui sejak dibuat.

### 13.2 Lapisan

| Lapisan | Isi | CI |
|---|---|---|
| L1 SQL | `match_products` dengan config default = hasil lama; kunci tier berubah → confidence berubah; `ai_match_shortlist` tidak pernah mengembalikan produk privat household lain (pola `98_rls_matrix`); `begin_ask` kuota harian/bulanan, dua sesi bersamaan; `record_ask_usage` hanya household sendiri; R18 `vs_best_pct` tanpa record sesi, `item_status`, `thumbnail_path` (purged → NULL); R20 `source_text`; W18 pemetaan ulang member (Q-77); inventaris hak akses diperbarui | ya |
| L2 unit worker | `prepareImages`: JPEG/PNG/WebP/HEIC sintetis, EXIF orientasi 6/8, GPS dibuang, file rusak/0 byte/tipe lain → `unsupported`, bom piksel; `convert.ts`: setiap cek §5.3, sambungan bagian, tanggal tahun dua digit; pemetaan error SDK (§5.4) dengan klien palsu; tenggat/abort; `pricing.ts`; redaksi lapis 2–3 (positif dan negatif); matcher: indeks di luar daftar pendek dibuang, batas confidence | ya |
| L3 pipeline | Fixture JPEG sintetis menggantikan fixture palsu (F-118), semua skenario lama tetap lulus; extractor palsu (respons Claude rekaman sintetis) melewati pipeline penuh termasuk refusal, `max_tokens`, output tidak valid; anggaran habis → tidak claim | ya |
| L3 web | `/api/ask` dengan klien Claude palsu: 401 tanpa sesi, 429 kuota, 503 tanpa kunci, loop tool (1–4 putaran), error tool sebagai data, `answer` tanpa tool → `not_enough`, `screen` dari output tool, S-03b (F-113) | ya |
| L5 web | S-20 aktif: kirim, memuat, 5 keadaan balasan dari route palsu, offline → kirim nonaktif, riwayat di perangkat terhapus saat Keluar; S-13 status per item + thumbnail; axe | ya |
| e2e | Alur 3–5 dengan fixture JPEG sintetis; **fixture screenshot ber-confidence rendah** (Q-78) sehingga alur 5 mencapai S-11 tanpa unggahan kedua; **alur 4 kamera** lewat mode fallback stub (Q-82, Q-118): worker e2e dengan `STUB_FALLBACK_FIXTURE=label-milo` memetakan gambar tak dikenal (frame kamera palsu) ke fixture itu; S-20 dengan `ASK_ENGINE=stub` (jawaban berdasarkan pola pertanyaan) | ya |
| Live (manual) | `LIVE_AI=1 pnpm --filter @priceatlas/worker test:live`: 3 struk + 2 label + 1 screenshot sintetis lewat `VisionExtractor` sungguhan, hasil lolos kontrak dan nominal benar; tier 4 dengan katalog kecil; `pnpm --filter @priceatlas/web test:live-ask`: set pertanyaan emas | tidak |
| Harness | §4 (data asli pemilik proyek) | tidak |

### 13.3 Set pertanyaan emas Tanya

30 pertanyaan terhadap katalog fixture dev (`db/scripts/dev-db.sh`): 4 per kemampuan (24), 4 di luar kemampuan ("total belanjaku bulan ini", "resep milo", "harga milo di pasar"), 2 adversarial (nama produk privat berisi instruksi, pertanyaan yang meminta menyimpan data). Dinilai: tool yang dipanggil, `kind`, angka di jawaban ada di output tool, tautan layar. Target: 100 % menolak di luar kemampuan, ≥ 90 % tool benar.

---

## 14. Milestone 6b

| M | Isi | Selesai jika | Butuh dari pemilik proyek |
|---|---|---|---|
| **M0** Fondasi | `prepareImages` + dependensi (`sharp`, `heic-decode`); fixture JPEG sintetis (F-118, Q-72) + generator sintetis; `ai/claude.ts`, `pricing.ts`, `llm-schema.ts`, prompt v1, `convert.ts`; guard `check-secrets` (F-117); perbaikan F-114 sudah | L2/L3 lulus, CI hijau tanpa kunci | — |
| **M1** Uji OCR (D-16) | Harness `ocr-eval` (init, annotate, run, score, report, batch + realtime, budget); `VisionExtractor` dan `OcrThenParseExtractor` cukup untuk harness; uji live sintetis | Laporan test-split lengkap, lampiran §A, **keputusan D-16** | Foto (§15), kunci Anthropic + Google Vision, anotasi, menjalankan harness |
| **M2** Extractor produksi | Extractor terpilih untuk 3 jenis; `buildDeps`; error/tenggat (§5.4); anggaran harian (§12.3); kolom/config migration bagian 1 (#1, #2, #5) | Worker lokal memproses foto asli end-to-end di mode B; L1–L3 + e2e hijau | Uji coba di HP |
| **M3** Matcher tier 4 + mulai kalibrasi | `ai_match_shortlist`, `ClaudeAiMatcher`; masa kalibrasi (τ = 1,01); `calibration_report.sql`; redaksi lapis 1–3 | Tier 4 berjalan di pemakaian nyata; laporan kalibrasi bisa dijalankan | Pemakaian 2 minggu |
| **M4** Item tinjauan Tahap 6 | R18/R20 (Q-80, Q-81, Q-97, Q-87) + S-13/S-16/S-18; Q-77 (W18); Q-34 sesuai data uji; fixture screenshot rendah (Q-78), e2e alur 4 (Q-82) | e2e alur 4–6 diperbarui, hijau | — |
| **M5** Tanya | Kuota (#4), `packages/ai-tools/src/ask.ts`, `/api/ask`, S-20 aktif, F-113, offline, riwayat di perangkat, set pertanyaan emas; daftar cek F-105 no. 10 diperbarui | L3/L5/e2e hijau; set emas memenuhi target | Kunci Anthropic di `apps/web/.env.local` |
| **M6** Kalibrasi final | Analisis masa kalibrasi → nilai `app.config` final, τ final (D-50), keputusan Q-36; dokumen diperbarui | Keputusan dicatat di Decision Log | Data 2 minggu |

M5 tidak bergantung pada D-16, jadi bisa dikerjakan paralel dengan M1 (menunggu anotasi). Urutan yang disarankan: M0 → (M1 ∥ M5) → M2 → M3 → M4 → M6.

---

## 15. Yang perlu disiapkan pemilik proyek sebelum 6b

| # | Item | Rincian |
|---|---|---|
| 1 | **Foto struk asli** | 40 struk (minimum 30) sesuai §4.4: 10 minimarket, 10 supermarket, 4 AEON, 4 apotek/drugstore, 4 toko lokal, 8 bebas. Termasuk ≥ 6 item timbang, ≥ 6 diskon member, ≥ 5 struk panjang (difoto per bagian seperti di app, dengan sedikit tumpang tindih), ≥ 5 pudar/kusut, ≥ 3 struk lama, ≥ 3 void. Foto dengan kamera HP biasa (HEIC boleh). Jangan disunting, jangan dipotong. |
| 2 | Foto label dan screenshot | 20 label (6 normal, 6 promo berperiode, 5 harga member, 3 foto berisi beberapa label) dan 10 screenshot (4 Shopee, 3 Tokopedia, 3 lainnya; 2 halaman pesanan). |
| 3 | Struk fisiknya | Disimpan sampai anotasi selesai, untuk memeriksa baris yang buram di foto. |
| 4 | Waktu anotasi | ±10 menit per struk dengan pra-isi (±7 jam untuk 40 struk), ±3 menit per label/screenshot. |
| 5 | **Kunci API Anthropic** | Dari Console, workspace khusus PriceAtlas, dengan batas pengeluaran (mis. US$100 untuk bulan uji). Dua kunci: `worker` dan `web`. Disimpan hanya di `.env` worker dan `apps/web/.env.local` di mesin sendiri. Tidak dikirim lewat chat. Periksa juga kebijakan retensi data API yang berlaku untuk org (F-115). |
| 6 | Kunci Google Cloud Vision | Hanya untuk arm `ocr-gcv+opus-low`: project GCP dengan Vision API aktif dan kunci API yang dibatasi ke Vision API (atau pilih vendor lain di Q-103). |
| 7 | **Akses jaringan sesi 6b** | Untuk test live sintetis di sesi cloud: `api.anthropic.com` (dan `vision.googleapis.com` jika arm OCR) diizinkan di network policy environment, serta `ANTHROPIC_API_KEY` khusus uji (batas kecil, mis. US$10) di secrets environment. Registry npm sudah terjangkau (`sharp` mengunduh biner lewat paket npm `@img/*`). Tanpa ini, sesi 6b tetap bisa membangun semuanya dengan klien palsu, dan semua uji live dijalankan pemilik proyek. |
| 8 | Satu file HEIC tanpa data pribadi | Mis. foto dinding polos dari iPhone, lokasi dimatikan. Untuk test dekode HEIC di CI (libheif tidak punya encoder di Node untuk membuat sampel sendiri). |
| 9 | Keputusan §16 | Terutama Q-102, Q-105, Q-107, Q-112. |
| 10 | Cek F-105 | Tetap terbuka, tidak memblokir. |

---

## 16. Pertanyaan untuk didiskusikan (Q-102 dst.)

Setiap pertanyaan punya usulan default. Jawab "setuju semua" jika semua default sudah cocok.

### 16.1 Uji OCR

| ID | Pertanyaan | Usulan default |
|---|---|---|
| **Q-102** | Arm uji D-16 dan siapa yang memilih model. | **Lima arm §4.5.** Model produksi dipilih pemilik proyek dari laporan, dengan rekomendasi mengikuti kriteria §4.8. Tanpa keputusan lain, default tetap `claude-opus-5-5`. |
| Q-103 | Vendor OCR untuk arm `ocr+parse`: Google Cloud Vision, AWS Textract `AnalyzeExpense`, Azure Document Intelligence `prebuilt-receipt`, atau OCR lokal (PaddleOCR/Tesseract)? | **Google Cloud Vision** (`DOCUMENT_TEXT_DETECTION`): satu API key, kuat untuk teks Latin campuran, tidak perlu model struk khusus karena parsing oleh Claude. Vendor lain hanya jika Vision kalah jauh tetapi masih lebih baik dari vision Claude. |
| Q-104 | Kriteria keputusan §4.8 (presisi auto-save ≥ 98 %, nominal ≥ 97 %, tanggal/total ≥ 98 %, kebocoran PII 0, kegagalan ≤ 2 %, lalu biaya terendah, lalu vision jika selisih < 1 poin). | **Ya.** |
| **Q-105** | Penyerahan data asli: pemilik proyek menjalankan harness sendiri, atau folder Google Drive privat yang dibaca sesi 6b? | **Dijalankan sendiri** (gambar tidak pernah masuk lingkungan cloud sesi). Sesi 6b membangun dan menguji harness dengan data sintetis, pemilik proyek menjalankan 5 perintah §4.2, laporan agregat dikirim balik. Alternatif Drive lebih cepat untuk iterasi prompt, tetapi gambar berisi PII masuk ke sesi. |
| Q-106 | Vision menulis transkripsi lengkap (F-110, ±US$0,015 per struk Opus)? | **Ya**, dengan PII disamarkan di sumber. Dibutuhkan untuk audit, redaksi, proses ulang, dan perbandingan dengan OCR. |

### 16.2 Confidence dan matching

| ID | Pertanyaan | Usulan default |
|---|---|---|
| **Q-107** | Kalibrasi matching lewat masa kalibrasi (τ = 1,01 selama 2 minggu / ≥ 150 baris, semua item dikonfirmasi), atau τ = 0,90 langsung dengan data harness saja? | **Masa kalibrasi.** Biayanya hanya ketukan "Benar" tambahan. Tanpa itu τ = 0,90 untuk matching tidak pernah diuji. |
| Q-108 | Tier 4 dibatasi confidence 0,85 (tidak pernah auto-save) sampai kalibrasi; perluasan tier 4 ke item dengan kandidat lemah (Q-36) diputuskan setelah masa kalibrasi? | **Ya, keduanya.** |
| Q-109 | Nilai tier pindah ke `app.config` + `fuzzy_max_confidence` (F-111)? | **Ya.** Default = perilaku sekarang, jadi tidak ada perubahan perilaku sampai kalibrasi. |
| Q-110 | `member_hint` (Q-34/D-74): kolom `receipt_line.is_member_discount` dari parser, atau tetap regex teks diskon? | **Diputuskan dari data uji:** regex recall ≥ 95 % pada diskon member asli → tetap D-74. Jika tidak → kolom (§11.1 #7), regex jadi cadangan. Field opsional `member_discount` tetap ditambah ke kontrak supaya bisa diukur. |

### 16.3 Data, gambar, PII

| ID | Pertanyaan | Usulan default |
|---|---|---|
| Q-111 | Q-77: kolom staging `read_member_price`/`read_member_program_name` di `capture_item` + pemetaan ulang otomatis di W18? | **Ya.** Teks `member_note` saja tidak cukup untuk dipetakan ulang dengan aman. |
| **Q-112** | HEIC (dan file lain) yang masih punya EXIF/GPS di bucket: biarkan, atau worker mengganti objek dengan turunan JPEG bersih? | **Biarkan** di MVP: kasusnya hanya HEIC dari browser non-Safari, bucket privat, purge 12 bulan, dan sha256 asli tetap konsisten. Mengganti objek mengubah hash dan memutus deteksi duplikat. |
| Q-113 | Redaksi PII tiga lapis tanpa panggilan AI tambahan (§9), target kebocoran 0 di harness? | **Ya.** Jika harness menunjukkan kebocoran, pola regex ditambah. AI khusus redaksi hanya jika tetap bocor. |
| Q-114 | Teks privasi (`/saya/privasi`) menyebut bahwa foto diproses oleh layanan AI (Anthropic; dan vendor OCR jika dipilih) untuk membaca harga (F-115)? | **Ya**, satu paragraf, dibuat di M2 sebelum extractor sungguhan dipakai. |

### 16.4 Tanya

| ID | Pertanyaan | Usulan default |
|---|---|---|
| Q-115 | Tanya: Opus 5.5 effort `low`, tanpa streaming, jawaban terstruktur, maks 4 putaran tool, timeout 45 dtk? | **Ya.** Streaming ditinjau jika p95 > 10 dtk. Model lain hanya setelah lolos set pertanyaan emas. |
| Q-116 | Kuota Tanya 30/hari dan 300/bulan per household, lewat RPC DEFINER yang bisa dipanggil user (tanpa service role di route)? | **Ya.** |
| Q-117 | Anggaran AI harian global (default US$2) yang menghentikan claim dan Tanya saat habis? | **Ya.** Capture tetap antre dan diproses besoknya, tanpa memakan percobaan. |

### 16.5 Test dan milestone

| ID | Pertanyaan | Usulan default |
|---|---|---|
| Q-118 | Fixture: ganti dengan JPEG sintetis (Q-72, F-118), tambah fixture screenshot ber-confidence rendah (Q-78), dan mode `STUB_FALLBACK_FIXTURE` khusus e2e untuk frame kamera (Q-82)? | **Ya, ketiganya.** Fallback hanya aktif lewat env di worker e2e, tidak pernah default. |
| Q-119 | Pembagian milestone §14 dan urutan M0 → (M1 ∥ M5) → M2 → M3 → M4 → M6? | **Ya.** |

**Hasil review 6a (2026-10-27):** pemilik proyek menyetujui semua usulan default Q-102 s/d Q-119 → **D-92**.

---

## 17. Bagian yang belum bisa dirancang penuh

| Bagian | Yang kurang | Dampak ke 6b |
|---|---|---|
| Pilihan engine dan model (D-16) | Data asli dan hasil harness | M2 menunggu keputusan M1. Kode extractor dibuat untuk dua engine sampai keputusan diambil. |
| Prompt final | Iterasi pada split dev | Prompt v1 di M0 adalah titik awal. |
| Nilai τ dan confidence tier final | Masa kalibrasi (M3) | Default sekarang tetap berlaku. |
| Kolom `member_hint` | Data uji (Q-110) | Migration bagian #7 bersyarat. |
| Harga dan resolusi gambar Haiku 5.5 | Cek Models API + halaman pricing saat 6b | Angka §12 diperbarui di M1. |
| Retensi data di sisi Anthropic dan vendor OCR | Pengaturan org pemilik proyek | Teks privasi (Q-114) menyesuaikan. |
| Hosting worker | Tahap 7 (Q-17) | Desain tidak bergantung pada platform; `--once` tersedia. |
| Cek pembaca layar (F-105) | Perangkat pemilik proyek | Tidak memblokir. Butir S-20 diperbarui di M5. |

---

## 18. Tahap 6b M0: hasil dan temuan baru (F-123 dst.)

> Status: **selesai dan disetujui** (2026-10-27): Q-120 s/d Q-126 → D-93, D-94 (semua usulan default). Basis: branch desain 6a (`D-92`). Tidak ada migration, perubahan RPC, atau perubahan RLS. Kontrak `packages/contracts` hanya bertambah dua field opsional. `EXTRACTOR` produksi tetap hanya `stub`; CI tidak memanggil API berbayar dan tidak butuh `ANTHROPIC_API_KEY`.

### 18.1 Yang dibangun

| Bagian | File | Isi |
|---|---|---|
| Gambar (§6, F-106) | `apps/worker/src/images/prepare.ts` | Magic bytes (JPEG, PNG, WebP, HEIC `heic/heix/hevc/hevx/mif1/msf1`; ekstensi diabaikan). Dekode `sharp` (`failOn: 'error'`, `limitInputPixels` 50 MP, `autoOrient`) atau `heic-decode` (dimensi dicek ≤ 50 MP **sebelum** dekode RGBA, karena `heic-decode` sendiri tidak memeriksanya; rotasi wadah HEIF diterapkan libheif). Metadata dibuang, sisi panjang ≤ 2576 px, JPEG q90 sRGB (latar putih untuk PNG transparan). PNG ≤ 1,5 MB tetap PNG. Gagal dekode / 0 byte / tipe lain / sisi pendek < 200 px → `PermanentError('unsupported', 'Gambar tidak bisa dibuka. Coba foto ulang atau pilih foto lain.')`. > 12 gambar → `unsupported` (§5.5). |
| Pipeline | `src/pipeline/process-capture.ts`, `types.ts` | `prepareImages` tepat setelah cek sha256, untuk semua engine termasuk stub. Hasil di `ImageBlob.prepared` (memori saja; objek bucket tidak diubah, Q-112). Tenggat `createDeadline` = lease − 30 dtk dari claim → `ctx.signal`/`ctx.deadlineAt`. Error yang membawa `runOutput` (refusal, `max_tokens`, output tidak valid, bukan struk) tetap menulis `record_run_output` sebelum `fail_run`, sehingga output mentah dan biaya tidak hilang (F-127). `raw_ai_output` = `Extraction.rawOutput ?? output`. |
| Klien Claude (§5.2, §5.4, F-107) | `src/ai/claude.ts` | `createClaudeClient`: timeout 120 dtk, `maxRetries: 1`. `callStructured`: `beta.messages.create` dengan `thinking: adaptive`, `output_config: { effort, format: betaZodOutputFormat(skema) }`, instruksi sistem ber-`cache_control`, `betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'` (tidak untuk Haiku). `stop_reason` diperiksa dulu: `refusal` → `PermanentError('other')`; `max_tokens` → sementara di percobaan 1, permanen sesudahnya (`maxTokensFor`: 16.000 lalu 32.000). JSON divalidasi zod di sini. Pemetaan error SDK sesuai tabel §5.4 (+ 413 → `unsupported`, 404 model → konfigurasi). Model yang melayani (`response.model`) dan pemakaian fallback dicatat di meta. |
| Harga | `src/ai/pricing.ts` | Tabel bertanggal (`PRICING_AS_OF = 2026-10-06`): Opus 5.5, Sonnet 5.5, Haiku 5.5 (+ harga prompt > 100K), model cadangan fallback. `costUsd(model, usage)`: input, output, tulis cache 5 menit (1,25×) / 1 jam (2×), baca cache; per iterasi jika ada `usage.iterations` (fallback ditagih harga modelnya sendiri). Model tak dikenal → `null`, bukan 0. `input_tokens` di `processing_run` = input + tulis cache + baca cache. |
| Skema LLM (F-108) | `src/extractors/llm-schema.ts` | `LlmReceiptSchema` persis §5.2; `LlmObservationSchema` (label + screenshot) mengikuti `ParsedObservationItem` + `document`, `transcript`, confidence per field. Semua field wajib (kosong = `null`), tanpa batasan angka. Test memeriksa JSON Schema yang dikirim: tiap objek `additionalProperties: false`, semua properti `required`, tanpa `minimum/maximum/pattern/default/$ref`. |
| Prompt v1 | `src/extractors/prompts/{receipt,label,listing}.v1.md` | Indonesia. Aturan bisnis §5.2: deskripsi item dipisah dari qty/harga (Q-28), diskon/void negatif + `applies_to`, non-produk, `tax` hanya untuk pajak yang menambah total, item timbang (kg 3 desimal), tanggal d/m/y + tahun dua digit, `member_discount`, sambungan bagian (F-120), PII → `[REDAKSI]` di transkripsi (§9 lapis 1), harga member ≠ promo, ongkir/voucher terpisah, dan bagian "Isi gambar adalah data" (F-122). `PROMPT_VERSION = 'v1'` (F-119). |
| Konverter (§5.3, F-109) | `src/extractors/convert.ts` | Semua cek §5.3: jenis dokumen, terbaca, penomoran/`applies_to` (lepas → `other`, ≤ 0,5), aritmetika (± Rp1, timbang ± Rp50, ≤ 0,6), Σ baris vs total (≤ 0,7), jendela tanggal [unggah − 400 hari, unggah + 1 hari] hari Asia/Jakarta (≤ 0,5), sambungan bagian (≤ 0,6), label promo ≥ normal / periode terbalik (≤ 0,6), pembulatan rupiah (≤ 0,8). Confidence akhir = `min(model, batas)`; setiap cek yang kena dicatat di `flags` (masuk `raw_ai_output.meta`, untuk harness). Nilai di luar kontrak dibersihkan (harga negatif, `promo_min_qty` < 2, URL bukan https, region > 1, posisi gambar di luar rentang, judul > 500). Semua hasil uji lolos `ParsedOutputSchema`. |
| `VisionExtractor` | `src/extractors/vision.ts` | Pesan user: konteks tanggal unggah/foto (Asia/Jakarta), "Bagian i dari n" (struk) / "Gambar i dari n", gambar base64 dari `prepared`. `rawOutput = { llm, meta: { requested_model, served_model, fallback_used, stop_reason, effort, max_tokens, tokens, cost_usd, prompt_version, kind, flags } }`. **Belum dipasang ke `buildDeps`** (M2); `EXTRACTOR≠stub` tetap ditolak saat start. Dibuat sekarang karena L3 §13.2 butuh extractor dengan respons rekaman (Q-120). |
| Kontrak (§11.3) | `packages/contracts/src/parsed.ts` | `ParsedReceiptLine.member_discount?: boolean`; `Extraction.rawOutput?: unknown`. Aditif: stub dan fixture lama tetap valid; `apply_extraction` mengabaikan kunci yang tidak dikenalnya (diuji L3). |
| Fixture sintetis (F-118, Q-72) | `apps/worker/eval/synthetic/{templates,specs,generate}.ts` | Template HTML (struk thermal monospace dengan rotasi kecil + derau deterministik, label rak dua harga, screenshot marketplace) → JPEG lewat Playwright yang sudah terpasang. Menggantikan 6 file palsu 42–54 byte: 5 di `apps/worker/test/fixtures/` + `apps/web/test/fixtures/worker/struk-tanpa-toko.jpg` (5–37 KB, 446–730 px). Nama fixture dan isi JSON tidak berubah. `--out DIR` menulis set uji sintetis + `<nama>.truth.json` (untuk harness M1). |
| Guard F-117 | `scripts/check-secrets.sh` | Pola `sk-ant-[A-Za-z0-9_-]{20,}`; file `*.jpg/jpeg/png/heic/heif/webp/gif/avif` yang dilacak di luar `apps/worker/test/fixtures/`, `apps/web/test/fixtures/`, `apps/web/e2e/fixtures/`, `apps/web/public/icons/`, `docs/wireframes/` → gagal (F-124). Diuji manual dengan file bocor sementara (keduanya tertangkap). |
| Dependensi | `apps/worker/package.json` | `sharp` 0.35.5 (prebuilt `@img/*`, sudah di `onlyBuiltDependencies`), `heic-decode` 2.1.0 (libheif-js 1.23.5, LGPL-3.0, server saja), `@anthropic-ai/sdk` 1.3.0, `zod` 4 (langsung, untuk skema LLM). Skrip `synthetic`. |

### 18.2 Hasil test

| Lapisan | Hasil | Catatan |
|---|---|---|
| L1 SQL `bash db/tests/run.sh` | **569 pengecekan lulus** | Tidak ada perubahan SQL. Dijalankan di PostgreSQL **16** (lihat di bawah). |
| L2 worker baru | `ai.test.ts` 33, `convert.test.ts` 19, `images.test.ts` 16 + **1 dilewati** (HEIC asli) | Klien palsu (`test/claude-fake.ts`): sukses, fallback (biaya per iterasi), refusal, `max_tokens` 1/2, JSON rusak, skema tidak lolos, 13 kelas error SDK, abort tenggat; harga; skema JSON; prompt. Gambar: 5 tipe magic bytes, WebP/PNG/JPEG, PNG besar dan transparan, resize 4032 → 2576, EXIF Orientation 6/8 (dicek warna piksel), GPS + Make terbuang, 0 byte/teks/GIF/JPEG terpotong/header palsu/HEIC rusak, sisi pendek 199 px, bom 56 MP, > 12 gambar, semua fixture CI bisa didekode. |
| L3 worker | `vision-pipeline.test.ts` 9; e2e/jobs/concurrency lama tetap lulus dengan fixture JPEG | Pipeline penuh dengan `VisionExtractor` + respons rekaman: struk-aeon → `needs_confirmation` (5 baris, `member_discount` diterima, transkripsi tanpa HP, biaya US$0,084 tercatat), label-milo (dua item, harga member tanpa toko → catatan, F-57), refusal, `max_tokens` 16.000 → 32.000 → gagal, skema tidak lolos, bukan struk, gambar rusak (Claude tidak dipanggil), 429 → ulang → sukses, tenggat lewat → signal aborted → sementara. |
| Worker total | **114 lulus, 1 dilewati** (sebelumnya 37) | |
| `pnpm -r --workspace-concurrency=1 test` | contracts 62, worker 114 (+1 skip), ai-tools 21, web **577** | Semua lulus. |
| L5c browser (`test:browser`, Chromium terpasang via `PW_CHROMIUM_PATH`) | **12 lulus** | Fixture struk-aeon sekarang JPEG sungguhan → jalur "lewati kompresi" (`kept`), sha256 tetap = fixture stub. |
| `pnpm -r typecheck`, `next build`, lint + format web, `check-secrets.sh`, `pnpm install --frozen-lockfile` | lulus | Run CI pertama PR #21 gagal di typecheck/`next build` web: web mengimpor `prepare.ts` (lewat fixture test) tetapi tidak membaca deklarasi `heic-decode.d.ts` milik worker. Diperbaiki dengan `/// <reference>` di `prepare.ts`. Typecheck lokal sebelumnya berhenti di error worker sehingga error web tidak terlihat. |
| Waktu `prepareImage` (4 vCPU, JPEG derau terburuk) | 12 MP (8,7 MB): ±370 ms; 4,9 MP (1920 × 2560): ±220 ms | HEIC belum diukur (tanpa sampel). |

**Tidak dijalankan di sesi ini:** `db/scripts/snapshot.sh --check` (PostgreSQL 17 tidak bisa dipasang: `apt.postgresql.org` ditolak proxy; tidak ada perubahan SQL sehingga snapshot tidak terpengaruh), L4 dan e2e Playwright (butuh Supabase CLI, hanya di job CI `supabase-e2e`). Dampak ke e2e dianalisis: fixture baru ≤ 1,5 MB, ≤ 2048 px, tanpa GPS → aturan lewati kompresi (docs/07 §6.3) mengunggah byte asli, sehingga sha256 tetap dikenali stub; worker e2e menjalankan `prepareImages` dengan `sharp` prebuilt dari `pnpm install`.

### 18.3 Penyimpangan dari desain dan alasannya

| Desain | Implementasi M0 | Alasan |
|---|---|---|
| §5.2 sketsa `messages.parse` | `beta.messages.create` + `betaZodOutputFormat` + `safeParse` manual (jalur cadangan §5.2) | F-123 |
| §4.2/F-117 daftar folder gambar | + `apps/web/test/fixtures/`, `apps/web/public/icons/` | F-124 |
| §6 langkah 5 "PNG dikirim apa adanya" | PNG di-encode ulang lossless (piksel sama) | Chunk `eXIf`/`tEXt` bisa memuat lokasi; "apa adanya" akan melewatkan pembuangan metadata §6 langkah 3. |
| §5.4 "`max_tokens` sementara sekali, lalu permanen; berikutnya × 2" | Berdasarkan nomor percobaan, bukan alasan percobaan sebelumnya | F-128 |
| §5.3 Σ baris vs total | + Σ − voucher = total diterima; diskon/void positif dibalik negatif | F-129 |
| §5.5 batas 12 gambar (M2) | Sudah di `prepareImages` (M0) | Murah, dan berlaku juga untuk stub. |
| §14 `VisionExtractor` di M1 | Kelas dibuat di M0 (tidak dipasang) | L3 §13.2 butuh extractor dengan respons rekaman; harness M1 memakai kelas yang sama (Q-120). |
| §13.2 L2 "HEIC sintetis" | Test HEIC asli dilewati tanpa sampel; HEIC rusak + magic bytes diuji | libheif di Node tidak punya encoder (§15 no. 8). |

### 18.4 Temuan baru

| # | Temuan | Dampak | Usulan | Ke |
|---|---|---|---|---|
| F-123 | **Helper `beta.messages.parse` (SDK 1.3.0) melempar `AnthropicError` saat JSON tidak lolos skema atau terpotong**, sebelum `stop_reason` bisa diperiksa, dan tanpa teks mentah. (Pertanyaan §5.2 terjawab: `parse` ada di namespace beta, `fallbacks: 'default'` bertipe di SDK.) | Refusal/`max_tokens` akan terbaca sebagai "output tidak valid", dan output mentah untuk audit hilang. | `create` + skema dari `betaZodOutputFormat` (batasan dibuang SDK seperti `parse`) + validasi zod setelah cek `stop_reason`. | selesai |
| F-124 | Daftar folder gambar F-117 tidak memuat file gambar yang **sudah** dilacak: `apps/web/public/icons/*.png` (ikon PWA) dan `apps/web/test/fixtures/worker/struk-tanpa-toko.jpg`. `apps/web/e2e/fixtures/` belum ada. | Guard akan langsung gagal di CI. | Allowlist ditambah dua folder itu; `apps/web/e2e/fixtures/` tetap diizinkan untuk nanti. | Q-126 → D-94 |
| F-125 | **Fixture web ikut bergantung pada fixture palsu (F-40):** `struk-tanpa-toko.jpg` (web), test L5a/L5c yang mengharapkan `undecodable`/`sniffMime = null`, dan sha256 di `rpc.json`. `scenario.ts` juga menyalin isi folder fixture tanpa melewati subfolder (akan gagal begitu `heic/` ada). | Test web rusak setelah fixture diganti. | Fixture web diganti JPEG sintetis; dua test diperbarui ke perilaku JPEG sungguhan (`kept`, ukuran terbaca); di `rpc.json` hanya nilai sha256 yang diganti (membangkitkan ulang penuh mengubah semua tanggal relatif dan jam sesi yang dipakai M4, F-75); `scenario.ts` hanya menyalin file. Prosedur di docs/06 §2.6. | selesai |
| F-126 | **Timeout 120 dtk tanpa streaming vs output struk panjang.** Output struk ±3.400–4.600 token (§12.1) + thinking; percobaan kedua menaikkan `max_tokens` ke 32.000 tetapi timeout tetap 120 dtk. | Struk sangat panjang bisa habis waktu (sementara, diulang) walaupun model masih menulis. | Ukur latensi p50/p95 per jenis di harness M1. Jika p95 struk > 60 dtk: ekstraksi pakai streaming (`stream().finalMessage()`) dengan tenggat yang sama, timeout per panggilan dinaikkan. | Q-122 → D-93 |
| F-127 | Pipeline lama menyimpan `processing_run` mentah **hanya jika extract berhasil**. Refusal/`max_tokens`/output tidak valid sudah memakan biaya. | Biaya dan bukti audit hilang untuk run gagal; anggaran harian (§12.3) jadi kurang hitung. | `TransientError`/`PermanentError` membawa `runOutput` opsional; pipeline menulis `record_run_output` sebelum `fail_run`. `raw_ai_output` vision = `{ llm, meta }` (kontrak `Extraction.rawOutput` aditif). Job redaksi sudah mengosongkan kunci `pii` di kedalaman mana pun. | selesai |
| F-128 | Aturan `max_tokens` §5.4 butuh tahu alasan percobaan sebelumnya, yang tidak disimpan di claim. | — | `max_tokens` = 16.000 di percobaan 1, 32.000 di percobaan ≥ 2 (apa pun alasan gagal sebelumnya); `max_tokens` di percobaan ≥ 2 → permanen. Batas lebih besar tidak menambah biaya kecuali dipakai. | Q-121 → D-94 |
| F-129 | **Cek total §5.3 menghitung salah untuk struk dengan voucher** yang dicetak di bawah sebagai adjustment (TOTAL tercetak sudah dikurangi voucher), dan model kadang menulis diskon tanpa tanda minus. | Peringatan total palsu (`field_confidence.total` ≤ 0,7) dan Σ salah. | Konverter menerima Σ baris = total **atau** Σ baris − voucher = total; diskon/void selalu dinormalkan negatif; baris `other` tidak dihitung; prompt: `tax` hanya untuk pajak yang menambah total. Diukur di harness (metrik "Σ baris = total"). | Q-123 → D-94 |
| F-130 | **Lease untuk tenggat diambil dari `PipelineDeps.leaseSeconds` (default 300)**, bukan dari `app.config.capture_processing_timeout_seconds`. Waktu mulai diambil tepat sebelum query claim (sedikit lebih awal dari `started_at` di DB, jadi konservatif). | Jika config diubah tanpa mengubah worker, tenggat bisa lebih panjang dari lease. | M2: env `CAPTURE_LEASE_SECONDS` (default 300) dan pemeriksaan saat start bahwa nilainya ≤ config (lewat query baca saja). | Q-124 → D-93 |
| F-131 | Harga **baca cache Haiku 5.5** tidak ada di cache skill; harga model cadangan (`claude-opus-5`, `claude-opus-4-8`) diambil dari tabel skill. 400 "gambar" dikenali dari pesan error (API tidak punya kode khusus). | Biaya Haiku dengan cache bisa sedikit meleset; 400 gambar yang pesannya lain dianggap kesalahan konfigurasi (sementara, diulang 3×, lalu `failed`). | Harga dicek di halaman pricing resmi di M1 (§17) dan `PRICING_AS_OF` diperbarui. Pola pesan diperiksa dengan uji live M1 (gambar rusak sengaja). | M1 |
| F-132 | **Fixture sintetis bergantung pada font mesin** yang merendernya; Playwright global (1.63) di lingkungan cloud tidak cocok dengan browser terpasang (build 1243). | Menjalankan ulang generator mengubah sha256 (rpc.json, test L5c). | Gambar di-commit; generator hanya dijalankan saat fixture perlu berubah, dengan prosedur docs/06 §2.6. Opsi `CHROMIUM_PATH` untuk biner Chromium lain. | selesai |
| F-133 | **Belum ada sampel HEIC.** `heic-decode` tidak memeriksa ukuran sebelum mengalokasikan RGBA (bom piksel lewat HEIC). | Jalur HEIC hanya diuji untuk file rusak dan magic bytes; waktu dekode HEIC belum diukur (§6 memperkirakan 0,5–2 dtk). | Dimensi dicek lewat `heic-decode.all()` sebelum `decode()`. Test HEIC asli otomatis aktif begitu `apps/worker/test/fixtures/heic/sample.heic` ada (lolos guard F-117) dan mencetak waktu dekode. | Q-125 → D-93 |

**F-105 (Q-101):** tetap terbuka, tidak memblokir. Tidak ada perubahan UI di M0.

### 18.5 Pertanyaan (Q-120 dst.)

| ID | Pertanyaan | Usulan default |
|---|---|---|
| Q-120 | `VisionExtractor` dibuat di M0 (tidak dipasang ke `buildDeps`) supaya L3 bisa menguji pipeline penuh dengan respons rekaman, dan harness M1 memakai kelas yang sama. Diterima? | **Ya.** Pemasangan (env `EXTRACTOR=vision`, kunci wajib saat start) tetap di M2. |
| Q-121 | Aturan `max_tokens` berbasis nomor percobaan (F-128): 16.000 di percobaan 1, 32.000 sesudahnya, `max_tokens` di percobaan ≥ 2 → permanen? | **Ya.** |
| Q-122 | Streaming untuk ekstraksi jika latensi mendekati timeout (F-126)? | **Diputuskan dari data M1:** p95 struk > 60 dtk → streaming + timeout per panggilan dinaikkan, tenggat lease tetap. Selain itu tetap tanpa streaming. |
| Q-123 | Cek total menerima Σ − voucher, diskon/void dinormalkan negatif, `tax` hanya pajak tambahan (F-129)? | **Ya**, dan diukur di harness; aturan diubah lewat prompt v2 jika data menunjukkan pola lain. |
| Q-124 | Sumber lease untuk tenggat AI (F-130)? | **Env `CAPTURE_LEASE_SECONDS` (default 300) di M2**, worker menolak start jika lebih besar dari `app.config`. |
| Q-125 | Sampel HEIC (§15 no. 8) masih dibutuhkan. Sampai ada, test HEIC dilewati dan HEIC hanya diuji di uji live/harness M1 (foto HEIC asli di `.data/ocr-eval/`)? | **Ya.** Pemilik proyek menaruh satu foto dinding polos (lokasi mati) di `apps/worker/test/fixtures/heic/sample.heic` kapan saja. |
| Q-126 | Allowlist gambar F-117 ditambah `apps/web/test/fixtures/` dan `apps/web/public/icons/` (F-124)? | **Ya.** Folder lain butuh perubahan skrip yang ditinjau. |

**Hasil review sebagian (2026-10-27):** pemilik proyek menerima usulan default **Q-122, Q-124, Q-125 → D-93**:
- Q-122: streaming ekstraksi diputuskan dari latensi harness M1 (p95 struk > 60 dtk → streaming + timeout per panggilan dinaikkan, tenggat lease tetap); selain itu tanpa streaming.
- Q-124: di M2 tenggat AI memakai env `CAPTURE_LEASE_SECONDS` (default 300); worker menolak start jika nilainya lebih besar dari `app.config.capture_processing_timeout_seconds`.
- Q-125: test HEIC tetap dilewati sampai `apps/worker/test/fixtures/heic/sample.heic` ada; sementara itu HEIC diuji lewat uji live/harness M1 dengan foto asli di `.data/ocr-eval/`.

Pemilik proyek kemudian menerima usulan default **Q-120, Q-121, Q-123, Q-126 → D-94**:
- Q-120: `VisionExtractor` tetap dibuat di M0 tanpa dipasang; pemasangan (`EXTRACTOR=vision`, kunci wajib saat start) di M2.
- Q-121: `max_tokens` 16.000 di percobaan 1, 32.000 di percobaan ≥ 2; `max_tokens` di percobaan ≥ 2 → gagal permanen.
- Q-123: cek total menerima Σ baris = total atau Σ baris − voucher = total; diskon/void dinormalkan negatif; `tax` hanya untuk pajak yang menambah total. Diukur di harness, diubah lewat prompt v2 jika data menunjukkan pola lain.
- Q-126: allowlist gambar F-117 = `apps/worker/test/fixtures/`, `apps/web/test/fixtures/`, `apps/web/e2e/fixtures/`, `apps/web/public/icons/`, `docs/wireframes/`; folder lain butuh perubahan skrip yang ditinjau.

### 18.6 Berikutnya

M1 (uji OCR D-16) dan M5 (Tanya) bisa dimulai paralel sesuai §14. M1 butuh dari pemilik proyek: foto (§15 no. 1–4), kunci Anthropic + Google Vision, dan akses jaringan sesi bila uji live dijalankan di sesi cloud (§15 no. 7).

---

## 19. Tahap 6b M5: hasil dan temuan baru (F-134 dst.)

> Status: **selesai dan disetujui** (2026-10-28): Q-127 s/d Q-131 → D-95 (semua usulan default). Basis: branch D-94 (`claude/practical-clarke-i5q34e`, belum di-merge ke `master` saat M5 dimulai). Satu migration baru (aditif), dua RPC baru (`begin_ask`, `record_ask_usage`), dua kode error baru. RLS tidak berubah. Worker hanya berubah di tabel harga yang kini dipakai bersama (F-135). CI tetap tanpa API berbayar dan tanpa `ANTHROPIC_API_KEY`. Set pertanyaan emas **belum** dijalankan terhadap Claude sungguhan (F-146, Q-129).

### 19.1 Yang dibangun

| Bagian | File | Isi |
|---|---|---|
| Migration (§11.1 #1 #4 #5) | `supabase/migrations/20261027000100_ask_quota.sql` | `app.config`: `ask_daily_limit` 30, `ask_monthly_limit` 300, `ai_daily_budget_usd` 2,00. `app.err` ditambah `AI_QUOTA_EXCEEDED` (PT429) dan `AI_UNAVAILABLE` (PT503) (aditif, `create or replace`). `app.ask_usage (household_id, day, questions, recorded, input_tokens, output_tokens, cost_usd, updated_at)`, PK `(household_id, day)`, cascade hapus household, `revoke` dari `public/anon/authenticated`. `app.ai_spend_today()` (DEFINER, hanya `service_role`): Σ `processing_run.cost_usd` hari ini (zona DB) + Σ `ask_usage.cost_usd` hari ini (F-134). `public.begin_ask()` (DEFINER, `authenticated`): household user → upsert baris household-hari → `select … for update` → cek harian, bulanan (bulan kalender zona household), anggaran global → `questions + 1`; kembalian `{day, questions_today, daily_limit, questions_month, monthly_limit}`; habis → `AI_QUOTA_EXCEEDED` dengan `detail.reason` `daily`/`monthly`/`budget`. `public.record_ask_usage(p_day, p_input_tokens, p_output_tokens, p_cost_usd)` (DEFINER): hanya baris household sendiri, `p_day` hari ini/kemarin, maks satu catatan per pertanyaan yang dihitung (`recorded < questions`), biaya ≤ US$1 per pertanyaan, biaya NULL (model tak dikenal) = token saja (F-138). REVOKE/GRANT eksplisit (F-09). |
| Snapshot, inventaris, tipe | `db/schema.sql`, `db/tests/flows/99_privilege_inventory.sql`, `packages/db-types/src/database.ts` | Diff inventaris ditinjau: hanya `begin_ask()` dan `record_ask_usage(…)` untuk `authenticated` (tabel `app.ask_usage` dan `ai_spend_today` tidak terbuka). `db-types` ditulis tangan dalam bentuk `supabase gen types` (F-147). |
| Kontrak (§11.3) | `packages/contracts/src/{errors,ask,rpc}.ts` | `AI_QUOTA_EXCEEDED` 429, `AI_UNAVAILABLE` 503. `ask.ts` baru: `ASK_MAX_LENGTH` 200, `ASK_HISTORY_MAX` 4, `ASK_TEXT_MAX` 400, `ASK_TOOLS`, `AskScreenRefSchema` (+ `S-03b`, F-113), `AskToolRefSchema`, `AskBasisSchema` (F-139), `AskReplySchema` (4 bentuk server), `AskRequestSchema` (strict), `AskResponseSchema`, `AskErrorResponseSchema`, `BeginAskResultSchema`, `ASK_RPC_INPUTS`. `RPC_NAMES.askRoute` (dipanggil route server dengan JWT user, bukan `rpcCall` klien); test kesetaraan SQL ikut memeriksanya. Semua aditif. |
| Loop Tanya (§10.2, §10.3) | `packages/ai-tools/src/ask.ts`, `src/prompts/ask.v1.ts` (`ask-v1`) | Sub-path `@priceatlas/ai-tools/ask` (tidak diekspor dari index paket, supaya klien tidak memuat SDK). `runAsk`: `beta.messages.create` dengan `claude-opus-5-5`, `thinking: adaptive`, `output_config: { effort: 'low', format: betaZodOutputFormat(AskFinal) }`, 6 tool registry tanpa `strict` (`$schema` dibuang), instruksi sistem tetap (tanpa tanggal; tanggal hari ini di pesan user) ber-`cache_control`, `betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'` (bukan Haiku), `max_tokens` 4.000. Loop manual: tool paralel dalam satu putaran → semua `tool_result` dalam satu pesan user; error tool (`INVALID_INPUT`, `NOT_FOUND`, `UNKNOWN_TOOL`, exception tak dikenal → `TOOL_FAILED`) dikirim sebagai `tool_result` `is_error: true`; konten asisten diteruskan apa adanya (append-only), kecuali blok internal sebelum blok `fallback` terakhir. Setelah 4 putaran: `tool_choice: none` + pengingat teks; model yang tetap memanggil tool → gagal `tool_loop` (F-145). `stop_reason`: `refusal` → `out_of_scope`; `max_tokens` → gagal; JSON tidak lolos `AskFinal` → gagal. Tenggat total 45 dtk (`AbortSignal.timeout` digabung signal request), klien SDK `timeout` 45 dtk `maxRetries` 1. Pemetaan `mapFinal` (§10.3 + F-140). `unsupportedRupiah`: angka "RpX" di teks dicocokkan dengan angka di kunci harga output tool → log `ask.unsupported_number` saja. `runAskStub` untuk `ASK_ENGINE=stub`. Biaya per respons lewat tabel harga bersama (F-135), per iterasi jika fallback. |
| Route (§10.1) | `apps/web/app/api/ask/route.ts`, `apps/web/lib/ask/server.ts` | `runtime = 'nodejs'`, `import 'server-only'`, `Cache-Control: no-store`. `handleAsk` (bisa diuji tanpa Next): zod → 400 `INVALID_INPUT`; `supabase.auth.getUser()` → 401 `UNAUTHENTICATED`; engine `off`/tanpa kunci → 503 `AI_UNAVAILABLE` `disabled` (sebelum kuota, F-137); `begin_ask` → 429 `AI_QUOTA_EXCEEDED` + `reason`; `runAsk`/`runAskStub`; `record_ask_usage` (juga setelah gagal yang sudah memakai token); 200 `{ reply, tools_used }`; gagal → 503 dengan `reason` `config`/`timeout`/`upstream` (F-141). Env `ASK_ENGINE` (`claude`/`stub`/`off`), `ANTHROPIC_API_KEY`, `ASK_MODEL` (opsional). Log JSON satu baris: hash id user (sha256, 12 hex), durasi, token, biaya, tool (gagal ditandai `!`), `kind`, putaran, model yang melayani, fallback, `unsupported_numbers`; tanpa teks pertanyaan/jawaban. |
| S-20 (§10.5, docs/07 §9) | `apps/web/features/ask/*`, `lib/ask/ask.ts`, `lib/copy/id.ts`, `lib/offline/prefs.ts` | Kirim aktif; satu pertanyaan sekaligus; "Mencari di historimu…"; 7 keadaan balasan (jawaban + "N data · terakhir …" + "Dijawab dengan" + tautan layar; data kurang; ambigu → chip mengirim pertanyaan baru; di luar kemampuan; kuota per alasan; gagal + "Coba lagi"; "Segera hadir"). `?q=` dari S-02 dikirim sekali lalu URL dibersihkan (F-143). Offline: Kirim nonaktif + "Tanya butuh sinyal…", riwayat tetap terbaca, tidak diantrekan. Riwayat 20 tanya-jawab di `prefs.ask_history` IndexedDB user (terhapus saat Keluar, D-84); 4 pasangan teks terakhir yang benar-benar dijawab ikut sebagai `history`. Jawaban baru diumumkan lewat region `aria-live` tersendiri (riwayat yang dimuat tidak dibacakan). F-113: S-03b → `/produk?id=…&sheet=cek-harga`. `check:bundle` gagal jika kunci/SDK Anthropic ada di `.next/static`. |
| Set pertanyaan emas (§13.3) | `apps/web/test/live/ask-golden.ts`, `ask-golden.live.test.ts`, `vitest.live.config.ts`, skrip `test:live-ask` | 30 pertanyaan (4 per tool, 4 di luar kemampuan, 2 adversarial: produk privat bernama instruksi, permintaan menyimpan harga), seed histori sintetis Ani di DB uji dari migration + katalog dev, penilai (kind, tool, angka, layar, pola terlarang), ringkasan (menolak di luar kemampuan, tool benar, p50/p95, biaya) → `.data/ask-golden/<waktu>.json` tanpa teks jawaban. Dilewati kecuali `LIVE_AI=1` + kunci. Test juga memastikan jumlah `price_record` tidak berubah. |
| Dokumen | `docs/06` §2.7, §4.1, §4.2, §4.11; `docs/07` §1.11 (butir 10), §8.2, §9, §11.3; `.env.example` | `ASK_ENGINE`, kunci web, `test:live-ask`, cara mencoba stub. |

### 19.2 Hasil test

| Lapisan | Hasil | Catatan |
|---|---|---|
| L1 SQL `bash db/tests/run.sh` | **602 lulus** (M0: 569) | `86_ask_quota.sql` 33: config, hak (user tidak membaca `ask_usage`/`ai_spend_today`, anon tidak bisa `begin_ask`), harian (ke-4 > 3 → PT429, ditolak tidak dihitung, `detail`), per household, bulanan (bulan lalu tidak dihitung, ke-11 > 10), **dua sesi bersamaan** (sesi kedua lewat `dblink_send_query` menunggu kunci baris, lalu melihat kuota habis; hitungan tetap 2), `record_ask_usage` (household sendiri, household lain tidak tersentuh, maks per pertanyaan, hari/token/biaya di luar batas, biaya NULL), tanpa household → FORBIDDEN, `ai_spend_today` (run hari ini + Tanya hari ini; kemarin dan NULL tidak dihitung), anggaran habis → `budget`, cascade hapus household. `99_privilege_inventory` diperbarui. |
| `db/scripts/snapshot.sh --check` | lulus | Dengan `pg_dump` 16 (F-147). |
| contracts | **70** (62) | `ask.test.ts` 7 + kesetaraan SQL (`app.err` = `ERROR_HTTP` termasuk dua kode baru, fungsi public = `RPC_NAMES` + `askRoute`, argumen `ASK_RPC_INPUTS`). |
| ai-tools | **55** (21) | `ask.test.ts` 34 dengan klien Claude palsu (`test/claude-fake.ts`, juga diekspor `@priceatlas/ai-tools/testing`) dan tool sungguhan terhadap DB uji: parameter permintaan, 1 putaran (biaya US$0,016 dari 2 × 1.000/200 token), tool paralel, 4 putaran → `tool_choice: none`, putaran ke-5 → `tool_loop`, error tool sebagai data, tool tidak dikenal, `answer` tanpa tool → `not_enough` teks tetap, `jumlah_data` 0 → `not_enough`, S-03b, S-04/S-05, hasil cari > 1 → S-02, ambigu (maks 4), di luar kemampuan, teks dipotong 400, refusal, `max_tokens`, JSON rusak/skema salah, 6 error SDK, tenggat 80 ms, fallback (blok sebelum `fallback` tidak diteruskan dan tool_use-nya tidak dijalankan; biaya dengan harga `claude-opus-5`), F-122 (nama produk privat berisi instruksi masuk sebagai JSON, layar dari output tool, "Rp1" tercatat, household lain `NOT_FOUND`), stub. |
| web L3 | `test/ask/route.test.ts` **16** | DB uji + klien palsu: 400, 401, 503 tanpa kunci/`off` (kuota tidak terpakai), 429 harian (Claude tidak dipanggil), 429 anggaran, 2 putaran → 200 + biaya tercatat di `ask_usage` + log tanpa teks/uuid user, error tool → `not_enough`, S-03b, F-122, di luar kemampuan, 503 `config`/`upstream`, tenggat setelah 1 putaran → `timeout` dengan token putaran pertama tercatat, stub; `route.ts` mengimpor `server-only`, tidak ada `NEXT_PUBLIC_*ANTHROPIC`, komponen klien tidak mengimpor SDK/loop. |
| web L5 | `test/ask/ask-screen.test.tsx` **10**, `logic.test.ts` **16**, `golden.test.ts` **3**; M7 disesuaikan | L5b: kirim → memuat → jawaban + dasar + tautan + tool + `aria-live`; `?q=` sekali; data kurang/di luar kemampuan/S-03b/ambigu → chip dengan history; 429/503 segera hadir/503 timeout + Coba lagi; jaringan putus; offline (awal dan di tengah); riwayat maks 20 + tidak diumumkan; Keluar menghapus DB; axe (0 serious/critical). Test kerangka M7 yang mengharapkan Kirim nonaktif dihapus; audit a11y M7 S-20 tanpa `?q=`. |
| `pnpm -r --workspace-concurrency=1 test` | contracts 70, ai-tools 55, worker 114 (+1 skip), web **621** (577) | Semua lulus. |
| L5c `test:browser` (Chromium `/opt/pw-browsers`) | 12 lulus | Tidak ada kode browser-only baru. |
| `pnpm -r typecheck` | lulus | Web benar-benar dijalankan (pelajaran F-125): error tipe test M7 sempat muncul dan diperbaiki sebelum lulus. |
| lint + format web, `next build`, `check:bundle`, `check-secrets.sh` | lulus | `/api/ask` = route dinamis; SDK hanya di bundle server (penanda `anthropic-version` ada di `.next/server/app/api/ask/route.js`, tidak di `.next/static`); `check:bundle` dengan `ANTHROPIC_API_KEY` palsu di env juga lulus. JS `/` 337 KiB modul (M7: 336). Smoke `next start` dengan `ASK_ENGINE=stub`: body kosong/bukan JSON → 400, tanpa sesi → 401. |

**Tidak dijalankan di sesi ini:** uji live set emas (F-146), e2e `e2e/ask.spec.ts` dan tambahan L4 (429 lewat PostgREST, `begin_ask`/`record_ask_usage` dengan JWT asli) karena butuh Supabase CLI (job CI `supabase-e2e`), `supabase gen types` (F-147).

### 19.3 Penyimpangan dari desain dan alasannya

| Desain | Implementasi M5 | Alasan |
|---|---|---|
| §14: `ai_spend_today` di M2 | Dibuat di M5 | F-134 |
| §11: satu migration untuk semua perubahan AI | Migration terpisah per milestone (`20261027000100_ask_quota.sql`) | F-136 |
| §3.2: `pricing.ts` di `apps/worker/src/ai/` | Pindah ke `packages/ai-tools/src/pricing.ts`; worker me-re-export | F-135 |
| §10.1: `begin_ask` (3) lalu cek kunci (4) | Cek engine/kunci dulu, lalu `begin_ask` | F-137 |
| §10.3: `basis` = teks "N data, terakhir …" | Objek `{ jumlah_data, tanggal_terakhir }`, diformat UI | F-139 |
| §10.3: hanya "answer tanpa tool → not_enough" | + `jumlah_data` 0, `not_enough` tanpa tool, refusal, ambigu tanpa pilihan | F-140 |
| §10.1 langkah 4: 503 hanya tanpa kunci | 503 juga untuk gagal saat menjawab, dengan `reason` | F-141 |
| §10.2: maks 4 putaran tool | Setelah 4 putaran: `tool_choice: none` + pengingat | F-145 |
| §3.2: `packages/ai-tools/src/ask.ts` `server-only` | Sub-path terpisah, tanpa `import 'server-only'` di paket (paket itu dipakai test Node dan skrip live); `server-only` di `route.ts` | Paket `server-only` melempar di luar kondisi `react-server` (vitest, tsx). Batas klien dijaga test (komponen tidak mengimpor) dan `check:bundle`. |
| §13.2 L1 "inventaris hak akses" | + test L4 PT429 lewat PostgREST | Bentuk HTTP 429 hanya terbukti di PostgREST asli. |

### 19.4 Temuan baru

| # | Temuan | Dampak | Usulan / penanganan | Ke |
|---|---|---|---|---|
| F-134 | **Anggaran harian dibutuhkan Tanya sebelum M2.** §12.3 menempatkan `app.ai_spend_today()` di M2 (worker), tetapi `begin_ask` (M5) harus menolak saat anggaran habis. | Tanpa fungsi itu, kuota Tanya tidak mengenal anggaran global. | `app.ai_spend_today()` dibuat di M5 (hanya `service_role`; `begin_ask` DEFINER memanggilnya). Worker memakainya di M2 (cek sebelum claim). | selesai (Q-131) |
| F-135 | **Tabel harga dibutuhkan worker dan route web.** Menyalin `pricing.ts` akan membuat dua tabel bertanggal yang bisa berbeda. | Biaya Tanya dan capture dihitung dengan harga berbeda. | `pricing.ts` pindah apa adanya ke `packages/ai-tools/src/pricing.ts` (sub-path `./pricing`); `apps/worker/src/ai/pricing.ts` = `export *` (impor worker dan test tidak berubah). Worker kini bergantung pada `@priceatlas/ai-tools`. | selesai (Q-131) |
| F-136 | **"Satu migration" §11 tidak cocok dengan urutan milestone** M0 → (M1 ∥ M5) → M2 → M3 → M4: bagian M2–M4 (tier config, shortlist, `read_member_*`, R18/R20) belum dirancang final dan sebagian bersyarat (Q-110). | Menunggu satu migration menahan M5. | Migration per milestone, nama bertanggal setelah `…0900`; M2–M4 menambah migration masing-masing. Snapshot + inventaris diperbarui per migration. | Q-131 |
| F-137 | **Urutan §10.1 memakan kuota saat Tanya mati**: `begin_ask` sebelum cek kunci berarti setiap ketukan Kirim saat 503 menghabiskan kuota. | Kuota habis tanpa jawaban; anggaran tidak terpengaruh. | Cek engine/kunci dulu (tanpa DB), baru `begin_ask`. Pertanyaan yang gagal setelah `begin_ask` (timeout, 5xx) tetap dihitung (biaya sudah terpakai). | Q-131 |
| F-138 | **`record_ask_usage` dipanggil user sendiri (Q-116) bisa menaikkan biaya household sendiri secara sengaja**, dan `ai_daily_budget_usd` bersifat global. Batas yang dipasang: ≤ US$1 per pertanyaan, maks satu catatan per pertanyaan yang dihitung, hari ini/kemarin. Satu household tetap bisa mencatat hingga 30 × US$1 = US$30/hari, di atas anggaran US$2. | Pemakaian pribadi: tidak relevan. SaaS (D-03): satu akun bisa menghentikan Tanya dan worker untuk semua household sampai besok (DoS anggaran). | MVP tetap seperti Q-116. Sebelum SaaS (Tahap 7): `record_ask_usage` hanya `service_role` (route memakai kunci server khusus untuk satu RPC itu), atau anggaran per household. | **Q-127** |
| F-139 | **`basis` berbentuk teks di server** tidak bisa memakai format tanggal relatif zona household (docs/07 §10.3) yang dipakai kartu harga. | "terakhir 2026-10-24" berbeda dengan "terakhir 3 hari lalu" di S-02. | Kontrak `basis = { jumlah_data, tanggal_terakhir }` dari output tool; UI memakai `DataCount` yang sama dengan kartu ("5 data · terakhir 3 hari lalu"). | Q-130 |
| F-140 | **Celah pemetaan §10.3**: (a) `answer` dari tool yang mengembalikan 0 data, (b) `not_enough` tanpa tool berhasil membawa teks model yang bisa berasal dari pengetahuan umum, (c) refusal (setelah fallback) tidak punya bentuk, (d) `ambiguous` tanpa pilihan. | Jawaban tanpa dasar data bisa tampil. | (a), (b), (d) → `not_enough` dengan teks tetap "Belum ada data di historimu untuk menjawab pertanyaan ini." (`tool`/`screen` dari tool terakhir yang berhasil jika ada); (c) → `out_of_scope` (log `ask.refusal`). | Q-130 |
| F-141 | **Gagal setelah `begin_ask`** (timeout 45 dtk, 429/5xx Anthropic, kunci ditolak, `max_tokens`, output tidak valid) tidak punya kode di §10.1. | UI tidak bisa membedakan "Segera hadir" dan "coba lagi". | 503 `AI_UNAVAILABLE` dengan `reason`: `disabled`/`config` → UI "Segera hadir"; `timeout`/`upstream` → "Gagal menjawab. Coba lagi." Token yang sudah terpakai tetap dicatat (pola F-127) supaya anggaran tidak kurang hitung. | selesai |
| F-142 | **`history` dari klien diteruskan sebagai giliran `assistant`**: user bisa memalsukan riwayatnya sendiri. | Hanya jawaban user itu sendiri yang terpengaruh; tool tetap RLS, tautan/basis tetap dari output tool, instruksi sistem menyebut riwayat sebagai data. | Diterima. Riwayat tidak disimpan di server (§10.4). | selesai |
| F-143 | **Pertanyaan dari S-02 (`?q=`)**: desain M7 menampilkannya sebagai "Kamu: …" tanpa mengirim; dengan Tanya aktif, mengetuk "Tanya: milo" lalu harus menekan Kirim lagi terasa ganda. | Satu ketukan ekstra; atau, jika dikirim otomatis, kuota terpakai tanpa menekan Kirim. | Dikirim otomatis sekali (hanya jika online), lalu URL diganti `/tanya` (muat ulang tidak mengirim lagi). | **Q-128** |
| F-144 | **Prompt caching Tanya mungkin tidak aktif**: awalan tools + system ±2.500–3.000 token, bisa di bawah minimum cache model. | Biaya input per putaran tanpa diskon cache (sudah diasumsikan §12.1). | Diukur dari `usage.cache_read_input_tokens` di uji live (laporan set emas mencatat token). Tidak ada perubahan sampai ada data. | M5 live |
| F-145 | **Batas 4 putaran tool** tidak menyebut apa yang terjadi di putaran ke-5. | Tanpa aturan, model bisa terus memanggil tool atau loop dipotong tanpa jawaban. | Setelah putaran ke-4: permintaan berikutnya `tool_choice: { type: 'none' }` (diizinkan Opus 5.5; `any`/`tool` tidak) + teks pengingat di pesan user; jika tetap `tool_use` → gagal `tool_loop` (503 `upstream`). | selesai |
| F-146 | **Set pertanyaan emas belum dijalankan terhadap Claude**: sesi ini tanpa `ANTHROPIC_API_KEY` (`api.anthropic.com` terjangkau, 401). Kriteria selesai §14 M5 "set emas memenuhi target" belum terbukti; prompt `ask-v1` belum diiterasi. | Akurasi tool, penolakan di luar kemampuan, latensi p95 (Q-115: streaming jika > 10 dtk), dan biaya per pertanyaan belum terukur. | Pemilik proyek menjalankan `LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm --filter @priceatlas/web test:live-ask` (±US$1–2) dan mengirim ringkasan (`.data/ask-golden/*.json`, tanpa teks jawaban). Jika target tidak tercapai: prompt v2 + jalankan ulang. | **Q-129** |
| F-147 | **Lingkungan sesi**: PostgreSQL 17/`pg_dump` 17 tidak bisa dipasang (proxy menolak `apt.postgresql.org` dan Maven Central; paket npm `@embedded-postgres` 17 tanpa `pg_dump`), Supabase CLI tidak ada. | Snapshot dan `db-types` tidak bisa dibangkitkan dengan alat CI. | Snapshot dengan `pg_dump` 16: lebih dulu dibuktikan **identik** dengan `db/schema.sql` yang di-commit untuk skema sebelum M5, lalu dibangkitkan ulang. `db-types` ditulis tangan dalam bentuk keluaran `supabase gen types` (urutan alfabet, `Record<PropertyKey, never>`, `Returns: undefined` untuk void, argumen default opsional) dan lolos Prettier; drift diperiksa job CI `supabase-e2e`. | selesai |

**F-105 (Q-101):** tetap terbuka, tidak memblokir. Butir no. 10 daftar cek `docs/07` §1.11 diperbarui untuk S-20 aktif (jawaban lewat `aria-live`, tautan layar sumber, offline).

### 19.5 Pertanyaan (Q-127 dst.)

| ID | Pertanyaan | Usulan default |
|---|---|---|
| Q-127 | `record_ask_usage` tetap bisa dipanggil user (DEFINER, batas per pertanyaan) di MVP, dengan risiko DoS anggaran global saat SaaS (F-138)? | **Ya untuk MVP.** Ditinjau di Tahap 7 sebelum ada user lain: pindah ke `service_role` khusus route atau anggaran per household. |
| Q-128 | Pertanyaan dari S-02 (`?q=`) langsung dikirim sekali saat S-20 terbuka (F-143)? | **Ya.** Hanya jika online; URL dibersihkan sehingga muat ulang/kembali tidak mengirim lagi. |
| Q-129 | Set pertanyaan emas dijalankan pemilik proyek dengan kunci web, dan M5 dianggap selesai setelah target §13.3 tercapai (F-146)? | **Ya.** Hasil agregat dikirim balik; jika gagal target → prompt `ask-v2` + jalankan ulang di sesi berikutnya. p95 > 10 dtk → streaming ditinjau (Q-115). |
| Q-130 | Bentuk `basis` sebagai objek dan perluasan pemetaan §10.3 (F-139, F-140)? | **Ya.** |
| Q-131 | Penyimpangan F-134 (`ai_spend_today` di M5), F-135 (tabel harga bersama), F-136 (migration per milestone), F-137 (cek kunci sebelum kuota)? | **Ya, semuanya.** |

**Hasil review M5 (2026-10-28):** pemilik proyek menerima semua usulan default Q-127 s/d Q-131 → **D-95**.

### 19.6 Berikutnya

Review M5 selesai (D-95). PR ke `master` menjalankan job `supabase-e2e` (e2e S-20, L4 429, drift `db-types`). Uji live set emas oleh pemilik proyek (Q-129). M1 (uji OCR D-16) tetap menunggu foto dan anotasi (§15). Setelah D-16: M2 (extractor produksi, worker memakai `app.ai_spend_today()` sebelum claim).

---

## 20. Tahap 6b M1-harness + M4: hasil dan temuan baru (F-148 dst.)

> Status: **selesai dan disetujui** (2026-10-30): Q-132 s/d Q-138 → D-96 (semua usulan default). Basis: `master` setelah PR #22 (M5, D-94, D-95). Dua bagian: (A) harness uji OCR M1 — dibangun dan diuji dengan data sintetis + klien palsu, **dijalankan pemilik proyek** pada foto asli (Q-105 → D-92), sehingga keputusan D-16 dan Lampiran A menunggu foto + anotasi; (B) item tinjauan M4. Satu migration baru (aditif). RLS tidak berubah. Kontrak hanya bertambah field. `EXTRACTOR` produksi tetap `stub`; `VisionExtractor`/`OcrThenParseExtractor` tidak dipasang ke `buildDeps` (M2, D-94). CI tetap tanpa API berbayar dan tanpa kunci. M4 dikerjakan sebelum M2–M3 (F-149).

### 20.1 Yang dibangun

**Bagian A — harness uji OCR (§4, `apps/worker/eval/`).**

| Bagian | File | Isi |
|---|---|---|
| CLI | `eval/cli.ts`, skrip `ocr-eval` | `init` · `annotate` · `run` · `score` · `report` (§3.2, §4.6). Folder data `OCR_EVAL_DIR` (default `<repo>/.data/ocr-eval`). Setiap perintah memanggil guard F-117 lebih dulu. Log per gambar hanya dengan `--verbose` (log tetap tanpa teks/PII). `run --estimate` mencetak perkiraan biaya tanpa memanggil API. |
| Data + guard | `eval/data.ts` | Guard F-117: folder data di dalam work tree git **wajib** `git check-ignore`; di luar repo boleh; git tidak ada → ditolak. `manifest.json` (id acak, jenis, kategori toko, kondisi, split, nama file standar, tanggal referensi = mtime foto, sha256 sumber; **tanpa** teks/nama file asli). `TruthSchema` = bentuk §4.3 dengan `expected` divalidasi **skema kontrak yang sama dengan worker** (`ParsedReceiptSchema`/`ParsedObservationSchema`), `annotations` (`weighed`, `member_discount`, `unreadable`, `transcript_pii`, catatan), `verified` (`null` = draf; hanya yang terverifikasi dinilai). |
| `init` | `eval/init.ts` | `inbox/<jenis>/[<kategori>/]<file>`; folder di bawah jenis = struk multi-bagian (urut nama file). Id `r-/l-/s-` + hex acak. Split dev 30 % / test 70 % **berstrata per (jenis, kategori)**, deterministik dari `seed`; menjalankan ulang hanya menambah foto baru (sha256) tanpa memindah split lama. `--synthetic DIR` mengimpor set sintetis sebagai truth terverifikasi (`verified.by = 'synthetic'`). |
| Arm | `eval/arms.ts` | Lima arm §4.5 (`vision-opus-low`, `vision-opus-medium`, `vision-sonnet`, `vision-haiku`, `ocr-gcv+opus-low`), prompt v1 + skema LLM + konverter yang sama. `slug` aman untuk `custom_id` batch (F-148). |
| `run` | `eval/run.ts` | **Batch** (Message Batches API lewat `client.beta.messages.batches`, parameter = `buildBatchParams` = panggilan biasa **tanpa** `fallbacks`/`betas`, F-116; biaya × `BATCH_PRICE_FACTOR` 0,5; status batch disimpan di `runs/<run>/batch.json`; item `max_tokens`/error sementara diulang realtime dengan batas × 2, F-128). **Realtime** (panggilan produksi persis, dengan `fallbacks: 'default'`; latensi dari `prepareImages` sampai respons lengkap; percobaan ulang seperti pipeline). Mode `both` (default): batch untuk semua + subset realtime 10 struk / 5 label / 5 screenshot per arm untuk latensi (Q-122 → D-93). **Anggaran**: buku biaya kumulatif `spend.json` dengan batas keras US$75 (§12.2) + `--budget` per run; sebelum setiap panggilan/batch biaya diperkirakan dari asumsi §12.1 dan run berhenti jika melewati sisa anggaran. OCR vendor ditagih di buku yang sama. Klien palsu tidak pernah menulis buku biaya. |
| `score` | `eval/score.ts`, `eval/stats.ts` | Penyelarasan baris dengan algoritma Hungaria (biaya = 1 − similarity + 0,5 jika nominal beda; similarity < 0,4 dan nominal beda → tidak berpasangan). Semua metrik §4.7 sebagai pembilang/penyebut: toko (nama jaringan ternormalisasi), cabang, tanggal, jam ± 1 mnt, total, subtotal, metode bayar ternormalisasi (F-153), recall/presisi baris produk, `line_type`, nominal/qty/harga satuan, CER teks ≤ 0,1, diskon/void (menempel ke pasangan yang benar), non-produk, timbang, member (flag parser) + **regex D-74 pada teks diskon member asli** (Q-34/Q-110), "struk sempurna", jumlah koreksi, Σ baris = total, confidence (presisi/coverage @τ, ECE 10 rentang, τ minimum untuk 98 %, isotonic dari split dev, §8.1), PII (recall + kebocoran setelah `redactText`), kegagalan (refusal/skema/timeout), stabilitas antar-ulangan. Label/screenshot: item dipasangkan, harga normal/promo/member, min qty, periode, program, posisi gambar, ongkir, judul. Gambar yang memang tak terbaca (`expected: null`) benar jika ditolak buram. Capture gagal dihitung salah di semua metrik akurasinya. |
| `report` | `eval/report.ts` | `reports/<waktu>.agg.json` + `.md`: angka per arm × jenis × kategori toko × kondisi, biaya per capture, latensi p50/p95, keputusan §4.8 (batas minimum → biaya terendah → vision jika selisih "sempurna" < 1 poin → jika tak ada yang lolos: presisi tertinggi + τ dinaikkan sebagai risiko), label dan screenshot terpisah dengan batas yang sama (§4.8 no. 4), rekomendasi Q-34/Q-110 (regex ≥ 95 %), Q-122 (p95 struk > 60 dtk → streaming), bias pra-isi §4.2. **Pengaman terakhir:** laporan tidak ditulis jika ada teks ground truth (teks item, toko, cabang, judul, PII) di JSON/markdown. |
| Alat anotasi | `eval/annotate/{server.ts,index.html,form.js}` | `ocr-eval annotate [--prefill ARM]` → `http://localhost:4317`: gambar di kiri (turunan JPEG bersih lewat `prepareImage`, sehingga HEIC tampil di semua browser), form di kanan (header, baris dengan anotasi timbang/member/tak terbaca, item label, PII, kategori, kondisi). Setiap field kuning = **belum diperiksa** sampai diubah atau ditandai ✓; "Simpan terverifikasi" hanya jika semua field diperiksa dan valid; draf boleh. Pra-isi = output arm (catatan run terbaru) tanpa confidence; capture tanpa output arm itu dijalankan realtime lebih dulu (dengan anggaran, `--no-run` untuk melewati). **5 struk pertama tanpa pra-isi** (`--blind`). Server hanya `127.0.0.1`, menolak Host selain localhost (DNS rebinding), hanya melayani file di manifest; nilai dari model di-escape (F-122). Truth divalidasi `TruthSchema` sebelum ditulis. |
| Klien palsu | `eval/fake-client.ts` | Untuk uji tanpa jaringan dan `run --client fake`: jawaban dibentuk dari ground truth sintetis (kebalikan `convert.ts`) dengan gangguan deterministik per arm; mendukung realtime dan batch; menolak `fallbacks` dan `custom_id` tidak valid seperti API. Laporannya ditandai **sintetis** dan bukan bahan D-16. |
| Extractor | `src/extractors/ocr-parse.ts`, `src/extractors/ocr/google-vision.ts`, `prompts/ocr.v1.md` | `OcrEngine` + `OcrThenParseExtractor` (§5.6): OCR → teks + kotak baris per bagian → Claude **teks saja** dengan prompt v1 + tambahan OCR (O ↔ 0, I ↔ 1, rp ↔ Rp) → konverter yang sama; `rawText` = teks OCR vendor (§5.3), biaya = Claude + OCR. `GoogleVisionOcr`: `DOCUMENT_TEXT_DETECTION`, satu request per gambar paralel maks 4, kunci di header `x-goog-api-key` (tidak di URL), kata → baris lewat penanda jeda GCV, error 429/5xx/jaringan → sementara, 400 → `unsupported`, 401/403 → sementara + `ai.config_error`, harga US$1,50/1.000 gambar (bertanggal). `VisionExtractor` dan `claude.ts` hanya dipecah (`request`/`finish`, `interpretMessage`, `buildBatchParams`) supaya realtime dan batch memakai pemeriksaan `stop_reason` + zod + konverter yang sama; perilaku pipeline tidak berubah. |
| Set sintetis | `eval/synthetic/{set.ts,specs.ts,generate.ts}` | Truth set sintetis dalam bentuk §4.3 (kategori toko, kondisi, anotasi member/PII di spesifikasi). `writeSyntheticSet` menyalin JPEG fixture yang di-commit (tanpa Chromium); `synthetic --out DIR` merender ulang. `synthetic --only a,b` merender fixture tertentu saja (fixture lain tidak berubah sha256-nya, F-132). Fixture baru `label-indomie` (label kedua untuk uji live §13.2). |
| Uji live | `test/live/vision.live.test.ts`, `vitest.live.config.ts`, skrip `test:live` | `LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm --filter @priceatlas/worker test:live`: 3 struk + 2 label + 1 screenshot sintetis lewat `VisionExtractor` sungguhan (lolos kontrak, nominal produk/total/tanggal benar, PII tidak ada di transkripsi, harga label/screenshot benar) + satu gambar rusak yang sengaja dikirim ke API (400 harus terbaca sebagai gambar → `unsupported`, F-131). Ringkasan token/biaya/latensi tanpa teks → `.data/live/<waktu>.json`. Dikecualikan dari `test`/CI (`vitest.config.ts` exclude). Tier 4 belum ada (M3). |
| Contoh laporan | `eval/examples/report-synthetic.{agg.json,md}` | Laporan agregat dari set sintetis (8 capture) dengan klien palsu, `--set all --repeat 2`, semua arm. Contoh bentuk, **bukan** hasil model (Lampiran A). |

**Bagian B — item tinjauan M4 (§11.1 #6, §11.2, §14 M4).**

| Bagian | File | Isi |
|---|---|---|
| Migration | `supabase/migrations/20261028000100_review_items.sql` | **Q-77:** `capture_item.read_member_price numeric(14,2) ≥ 0`, `read_member_program_name text ≤ 200` (tanpa GRANT UPDATE kolom: user tidak bisa mengubahnya). `app.match_member_program(store, nama)` = aturan pencocokan program yang sama dengan `apply_extraction` lama (nama ternormalisasi, atau satu-satunya program aktif jika nama tidak terbaca), dipakai `apply_extraction` (kini juga mengisi kolom terbaca) dan **W18**: jika `store_id` berubah dan patch tidak mengubah harga/program member, harga member terbaca dipetakan ulang ke program toko baru (`member_price`, `member_program_id`, `extra.member_note` dihapus); program toko lama yang tidak berlaku di toko baru → kembali jadi catatan (F-151). **R18** `get_active_session`: `labels[]` + `item_status` (`pending`/`accepted`, null tanpa item) dan `thumbnail_path` (gambar posisi 1, null jika `purged_at`); `vs_best_pct` terhadap `app.best_unit_price_excluding(produk, household, capture sesi)` = termurah `best_price_window_days` tanpa record dari capture sesi itu, aturan ringkasan (aktif, bukan bundle, mata uang default; harga member sudah di `unit_price`). Helper DEFINER dengan batas household pemanggil (F-152). **R20** `price_record_detail` + `source_text` (aturan teks alias W6: baris struk, teks label, judul listing untuk screenshot). Q-34/§11.1 #7 **tidak** dibuat (Q-110, menunggu data uji). REVOKE/GRANT eksplisit (F-09). |
| Snapshot, inventaris, tipe | `db/schema.sql`, `99_privilege_inventory.sql`, `packages/db-types` | Snapshot dengan `pg_dump` 16 — lebih dulu dibuktikan identik dengan `db/schema.sql` di `master` (F-147). Diff inventaris ditinjau: hanya `app.match_member_program` dan `app.best_unit_price_excluding` untuk `authenticated`. `db-types` ditulis tangan (dua kolom `capture_item`; RPC mengembalikan `Json`), drift diperiksa job CI `supabase-e2e`. |
| Kontrak | `packages/contracts/src/rpc.ts` | `SessionLabelSchema.item_status`, `.thumbnail_path`; `PriceRecordDetailSchema.source_text`. Semua `nullish` (aditif; cache R18/R20 di perangkat dari sebelum M4 tetap lolos, F-150). |
| S-13 | `features/shopping/session-labels.tsx`, `lib/session/session.ts`, `lib/data/captures.ts` | Kartu per item (Q-81): item tersimpan → harga + label + pembanding, item pending → "perlu dicek ›" (S-11), meski dari foto yang sama. Thumbnail (Q-97, F-101): `useSignedUrls` = **satu** `createSignedUrls` untuk semua label (D-79), kunci `['storage', …]` tidak di-persist; purged/gagal ditandatangani → ikon label. R18 lama tanpa `item_status` → perilaku per foto lama (F-61). |
| S-16/S-18 | `lib/catalog/record-form.ts`, `features/catalog/split-screen.tsx`, `lib/copy/id.ts` | Teks alias dari `source_text` (Q-87, F-72): "Perbarui juga alias 'MILO ORIGINAL 200G' di …?" untuk label, judul listing untuk screenshot; isian alias S-18 terisi dari teks label juga. Kalimat S-18 "Teks struk '…'" → "Teks '…'". R20 lama → kalimat umum seperti sebelumnya. |
| Fixture + worker e2e | `test/fixtures/shopee-milo-uht.{jpg,json}`, `src/extractors/stub.ts`, `src/main.ts`, `.github/workflows/ci.yml` | **Q-78:** `shopee-milo-uht` (screenshot sintetis, `field_confidence.price` 0,7 < τ) → `needs_confirmation` dari unggahan pertama. **Q-82/Q-118:** `STUB_FALLBACK_FIXTURE=<nama>`: gambar tak dikenal dibaca sebagai fixture itu **hanya jika jenis capture sama** dengan jenis output fixture; nama salah → worker gagal start; tanpa env → tidak aktif. Worker e2e CI: `STUB_FALLBACK_FIXTURE=label-milo`. `.env.example` diberi peringatan. |
| e2e | `e2e/session.spec.ts`, `e2e/confirm.spec.ts` | Alur 4: shutter kamera palsu Chromium → (fallback) label-milo → S-13 per item (Milo 200 g tersimpan "3% lebih murah dari biasanya", Milo 3in1 perlu dicek) + thumbnail termuat → S-11 → simpan → pembanding tetap "3% lebih murah" setelah ringkasan diperbarui; WebKit lewat galeri. Alur 5: `shopee-milo-uht` → S-11 dari unggahan pertama → simpan → S-16 record → ganti produk → tawaran alias berisi judul listing (alur 6 untuk label/screenshot). Alur 6a–c lama tidak berubah. |

### 20.2 Hasil test

| Lapisan | Hasil | Catatan |
|---|---|---|
| L1 `bash db/tests/run.sh` | **630 lulus** (M5: 602) | `87_review_items.sql` 28: nilai terbaca (dengan/tanpa nama program, tanpa harga member), user tidak bisa mengubahnya (42501) dan bukan kunci patch W18, W18: toko dipilih → program + catatan dihapus (hasil R16), nama tidak terbaca → satu-satunya program aktif, pratinjau R16 memakai program hasil pemetaan, pindah ke toko lain → catatan lagi, patch member oleh user menang, program yang cocok tidak diubah, tanpa harga terbaca tidak berubah, audit; R18 prasyarat F-60 (ringkasan memuat record sesi) lalu `vs_best_pct` −10 % (bukan 0 %), `item_status` pending/accepted/NULL, `thumbnail_path`, record di luar 90 hari, purged → NULL, helper tidak membaca household lain, pengecualian capture, anon ditolak; R20 `source_text` struk/label/screenshot + kunci lama tetap. `99_privilege_inventory` diperbarui. |
| `snapshot.sh --check` | lulus | `pg_dump` 16 (F-147). |
| worker | **152 lulus, 1 dilewati** (M5: 114) | `eval-score.test.ts` 14 (Hungaria, CER, persentil, ECE, isotonic, τ minimum, penyelarasan, toko/cabang/metode bayar, skor struk sempurna dan cacat, member + regex D-74, gagal, tak terbaca, stabilitas, label, keputusan §4.8 tiga cabang). `eval-harness.test.ts` 21 (guard F-117 tiga kasus + folder repo ini, `init` dari inbox, split berstrata, impor sintetis, arm, batch tanpa fallbacks + biaya × 0,5 + OCR, anggaran berhenti sebelum memanggil API, realtime `max_tokens` → × 2, GCV baris/kunci/error, `OcrThenParseExtractor`, server anotasi (daftar, JPEG tanpa EXIF, path traversal, Host, PUT tidak valid/valid), `form.js`, CLI end-to-end init → run → score → report dengan agregat tanpa teks/id, `--estimate`, pengaman laporan, tanpa kunci, folder di repo tanpa ignore). `e2e.test.ts` +2 (`shopee-milo-uht` → perlu dicek; fallback hanya jenis sama + tanpa fallback → `failed`), `unit.test.ts` +1, `images.test.ts` (fixture baru bisa didekode). |
| web | **626** (M5: 621) | M4 L5: S-13 per item, thumbnail satu `createSignedUrls` (purged dan gagal → ikon), R18 lama → per foto, "3% lebih murah" setelah ringkasan; S-16 label → alias dari `source_text`, R20 lama → kalimat umum; `aliasText` untuk tiga sumber. Fixture `rpc.json`: field baru ditambahkan tanpa membangkitkan ulang (`UPDATE_FIXTURES=fields`, F-125/F-75); nilai yang berubah karena perilaku baru (W18, `vs_best_pct`) disalin dari keluaran server. |
| contracts, ai-tools | 70, 55 | Tidak ada test baru (kontrak hanya field keluaran). |
| typecheck, lint + format web, `next build`, `check:bundle`, `check-secrets.sh` | lulus | Web benar-benar dijalankan (F-125). |
| Harness end-to-end | lulus | Set sintetis (8 capture) → `init --synthetic` → `run --arms all --repeat 2 --client fake` (batch + subset latensi, 120 catatan) → `score` → `report`; agregat tanpa teks/nama toko/PII/id. Alat anotasi dicoba di Chromium sungguhan (pra-isi tampil sebagai "belum diperiksa", simpan terverifikasi). |
| Uji live | **tidak dijalankan** | Sesi tanpa `ANTHROPIC_API_KEY` (F-155); `test:live` terverifikasi dilewati. |

**Tidak dijalankan di sesi ini:** e2e Playwright alur 4–6 dan L4 (butuh Supabase CLI; job CI `supabase-e2e`), `supabase gen types` (F-147), uji live dan harness terhadap API sungguhan (F-155).

### 20.3 Penyimpangan dari desain dan alasannya

| Desain | Implementasi | Alasan |
|---|---|---|
| §14: urutan M0 → (M1 ∥ M5) → M2 → M3 → **M4** | M4 dikerjakan sebelum M2–M3 | F-149 |
| §4.6 `custom_id = <arm>:<id>:<repeat>` | `<arm.slug>__<id>__r<n>` | F-148 |
| §11.1 #6 W18 hanya jika `member_program_id` kosong | + program toko lama yang tidak berlaku di toko baru → catatan; patch member oleh user menang | F-151 |
| §11.2 helper `app.best_unit_price_excluding` (tanpa rincian hak) | DEFINER + batas household pemanggil | F-152 |
| §11.3 field keluaran baru | `nullish` di kontrak | F-150 |
| §4.2 langkah 3 "pra-isi dengan arm terbaik" | Pra-isi realtime (harga penuh, ±US$6) dan dicatat terpisah (`purpose: prefill`, tidak masuk akurasi) | Q-134 |
| §4.6 realtime "subset 10 struk + 5 label" | + 5 screenshot | Latensi screenshot juga dibutuhkan §4.1 no. 5. |
| §4.8 no. 4 label/screenshot "batas yang sama (harga ≥ 97 %)" | Presisi/coverage @τ + harga + recall item + kegagalan | "Batas yang sama" dibaca termasuk auto-save, karena label juga di-auto-accept dengan τ. |
| §13.2 Live "tier 4 dengan katalog kecil" | Tidak ada | Matcher tier 4 baru di M3. |

### 20.4 Temuan baru

| # | Temuan | Dampak | Usulan / penanganan | Ke |
|---|---|---|---|---|
| F-148 | **`custom_id` batch hanya menerima huruf, angka, `_`, `-` (≤ 64)**; bentuk §4.6 `<arm>:<id>:<repeat>` memakai `:` dan nama arm `ocr-gcv+opus-low` memakai `+`. | Batch ditolak seluruhnya. | `custom_id = <slug>__<id>__r<n>` (slug arm tanpa `+`); pemetaan disimpan di `runs/<run>/batch.json`; klien palsu menolak format lain. | selesai (Q-135) |
| F-149 | **M4 dikerjakan sebelum M2–M3** (§14). M4 tidak bergantung pada D-16; M2 menunggu foto + anotasi. | Urutan milestone berubah; tidak ada ketergantungan kode yang terlewat (M4 tidak menyentuh extractor/matcher). | Dicatat. M2 (extractor produksi) dimulai setelah D-16. | Q-137 |
| F-150 | **Cache R18/R20 di perangkat (persist IndexedDB, D-60) dari sebelum M4 tidak memuat field baru**, dan `PERSIST_BUSTER` menghapus juga cache produk offline (R5) jika dinaikkan. | Field wajib membuat kode UI salah membaca `undefined` sampai R18 dimuat ulang. | Field baru `nullish` di kontrak; UI kembali ke perilaku lama tanpa field (status per foto, tanpa thumbnail, kalimat alias umum). Buster tidak dinaikkan. | Q-136 |
| F-151 | **Pemetaan ulang W18 §11.1 #6 hanya untuk `member_program_id` kosong**, padahal program yang dipetakan dari toko A tetap menempel jika lokasi item lalu diubah ke toko B. | Harga member item menunjuk program toko lain; pratinjau/konfirmasi memakai eligibility program yang salah. | Jika program saat ini bukan milik toko baru: petakan ulang ke program toko baru, atau kembali menjadi `member_note` (teks "Program 21000" seperti `apply_extraction`). Patch yang juga mengubah `member_price`/`member_program_id` tidak dipetakan ulang (pilihan user menang). Item yang diproses sebelum migration tidak punya nilai terbaca, jadi tidak dipetakan ulang. | Q-132 |
| F-152 | **`app.config` tidak bisa dibaca role `authenticated`** (`app.config_int` hanya `service_role`), padahal R18 berjalan sebagai user (INVOKER). | Helper INVOKER membaca `best_price_window_days` → `permission denied`. | Helper DEFINER dengan filter household pemanggil (`app.my_household_ids()`, pola `missing_storage_paths`); test L1 household lain dan anon. | selesai |
| F-153 | **`payment_method` kontrak berupa teks bebas** (fixture `struk-tanpa-toko`: `"tunai"`), skema LLM berupa enum (`cash`, …). | Skor metode bayar dan data lama tidak sebanding. | Harness membandingkan enum ternormalisasi (§4.7). Data produksi dari extractor sungguhan sudah enum; fixture stub dibiarkan. | selesai |
| F-154 | **Matching screenshot memakai `listing_title`, bukan nama produk** (`process-capture.ts`: `raw_text: it.listing_title ?? it.raw_text`). `word_similarity` judul panjang ("Milo UHT 180 ml Susu Cokelat Kotak") terhadap produk "milo uht 180 ml" jauh di bawah 0,5. | Judul marketplace yang panjang jarang mencapai tier 3; sebagian besar akan bergantung pada tier 4/manual. Fixture `shopee-milo-uht` sengaja memakai judul pendek + brand. | M3: kirim `raw_text` (nama produk dari model) lebih dulu, judul sebagai cadangan; diukur di masa kalibrasi. Alias user tetap memakai judul (W6). | **Q-133** |
| F-155 | **Sesi ini tanpa `ANTHROPIC_API_KEY`/kunci Google Vision.** Uji live dan harness tidak pernah memanggil API sungguhan; perilaku Batches API (bentuk hasil, `errored`) hanya diuji lewat klien palsu yang mengikuti tipe SDK 1.3.0. F-131: harga baca cache Haiku 5.5 sekarang tertulis di skill `claude-api` (0,1× input = US$0,01/MTok, sama dengan tabel); halaman pricing resmi belum dibuka. | Batch pertama dan pola pesan 400 gambar baru terbukti saat pemilik proyek menjalankan. | Pemilik proyek menjalankan `test:live` (±US$0,40) sebelum `ocr-eval run`; jika gagal, kirim pesan error-nya (tanpa gambar). | Q-138 |
| F-156 | **R18 `vs_last_pct` tetap terhadap `price_summary`** (memuat record label itu sendiri). | Tidak dipakai UI saat ini (hanya `vs_best_pct`). | Dibiarkan; ditinjau jika UI menampilkannya. | — |
| F-157 | **Mode fallback e2e menggantikan jalur "gagal dibaca" kamera di alur 4** (frame kamera kini terbaca sebagai label-milo). | Kartu "gagal dibaca" tidak lagi dicapai lewat kamera di e2e. | Tetap diuji di L5 (`session.test.tsx`) dan alur G (`struk-buram`); fallback hanya untuk jenis label. | selesai |
| F-158 | **Pra-isi anotasi dan subset latensi realtime dibayar penuh** (tanpa diskon batch). | Perkiraan uji penuh §4.4 (`run --estimate`, asumsi §12.1): batch 5 arm × 49 capture test × 2 ulangan ±US$14,5, subset latensi ±US$5,6, pra-isi 70 capture ±US$6 → **±US$26**, ditambah iterasi prompt di dev. Di bawah batas US$75. | Dibiarkan: pra-isi realtime juga memberi data latensi tambahan dan anotasi bisa dimulai tanpa menunggu batch (hingga 24 jam). | Q-134 |

**F-105 (Q-101):** tetap terbuka, tidak memblokir. Ada perubahan UI S-13 (thumbnail dekoratif `alt=""`, status per item dengan tautan bernama "Cek label <produk>") yang tercakup audit axe yang ada; butir daftar cek `docs/07` §1.11 tidak berubah.

### 20.5 Pertanyaan (Q-132 dst.)

| ID | Pertanyaan | Usulan default |
|---|---|---|
| Q-132 | W18 memetakan ulang juga saat program yang menempel bukan milik toko baru (kembali ke catatan jika tidak ada padanan), dan pilihan member user di patch yang sama menang (F-151)? | **Ya.** |
| Q-133 | Matching screenshot memakai nama produk (`raw_text`) dulu dan judul listing sebagai cadangan (F-154)? | **Ya, di M3**, bersama matcher tier 4; dampaknya diukur di masa kalibrasi. |
| Q-134 | Pra-isi anotasi realtime (harga penuh, ±US$6) dan subset latensi realtime termasuk screenshot (F-158)? | **Ya.** Total perkiraan ±US$26 + iterasi dev, batas keras tetap US$75. |
| Q-135 | Bentuk `custom_id` batch `<slug>__<id>__r<n>` dan mode `run` default `both` (batch semua + subset realtime) (F-148)? | **Ya.** |
| Q-136 | Field keluaran baru R18/R20 `nullish` di kontrak, UI kembali ke perilaku lama untuk cache tanpa field, buster cache tidak dinaikkan (F-150)? | **Ya.** |
| Q-137 | Penyimpangan urutan: M4 sebelum M2–M3 (F-149)? | **Ya.** M2 dimulai setelah D-16 (laporan Lampiran A). |
| Q-138 | Sebelum `ocr-eval run`, pemilik proyek menjalankan `test:live` sekali (±US$0,40) untuk membuktikan kunci, model, dan pola error 400 gambar (F-155, F-131)? | **Ya.** Jika gagal, kirim pesan error tanpa gambar; harness tidak dijalankan sampai lulus. |

**Hasil review (2026-10-30):** pemilik proyek menerima semua usulan default Q-132 s/d Q-138 → **D-96**.

### 20.6 Berikutnya

Pemilik proyek: §15 no. 1–6 (foto, kunci), lalu `test:live` (Q-138) dan lima perintah docs/06 §2.8; kirim `reports/<waktu>.agg.json`. Sesi berikutnya mengisi Lampiran A dari agregat itu dan mengusulkan keputusan D-16 (model/engine, τ ekstraksi, Q-34/Q-110, Q-122) → D-9x, lalu M2. PR ke `master` menjalankan job `supabase-e2e` (e2e alur 4–6, L4, drift `db-types`).

---

## 21. Tahap 6b M2/M3 bagian tanpa D-16: hasil dan temuan baru (F-159 dst.)

> Status: **selesai dan disetujui** (2026-10-30; Q-139–Q-142 → **D-97**). Basis: `master` setelah PR #23 + D-96. Hanya bagian M2/M3 yang tidak bergantung pada pilihan engine/model (D-16): kunci tier di config, daftar pendek dan matcher tier 4, anggaran harian, lease, matching screenshot Q-133, laporan kalibrasi, redaksi lapis 2–3, dan teks privasi Q-114. Satu migration baru (aditif). RLS tidak berubah, kontrak dan RPC publik tidak berubah. `EXTRACTOR` produksi tetap `stub`; `ClaudeAiMatcher` dibangun dan diuji dengan klien palsu tetapi **tidak** dipasang ke `buildDeps` (dipasang bersama extractor sungguhan di M2, F-165). CI tetap tanpa API berbayar dan tanpa kunci.

### 21.1 Yang dibangun

| Bagian | File | Isi |
|---|---|---|
| Migration | `supabase/migrations/20261030000100_match_config.sql` | **§11.1 #1–#2:** kunci `app.config` tabel §8.2 (`match_conf_barcode` 1,00, `match_conf_alias_household` 0,98, `match_conf_alias_global` 0,95, `match_conf_alias_group` 0,70, `fuzzy_max_confidence` 1,00) + `ai_match_max_confidence` 0,85 + `ai_match_shortlist_min_similarity` 0,2. `app.match_products` (`create or replace`, isi sama) membaca kunci itu; tier 3 = `min(similarity, fuzzy_max_confidence)` (F-111). Dengan default hasilnya identik: test L1 `70_capture_pipeline` tidak diubah dan tetap lulus. **§11.1 #3:** `app.ai_match_shortlist(household, store, items, limit 15)` DEFINER, `EXECUTE` hanya `service_role`: produk `active` global + privat household sendiri, (a) `word_similarity` ≥ 0,2 terhadap nama + varian + brand, atau (b) pernah dibeli household di toko itu (`price_record` aktif) dengan kata pertama sama; urut similarity, `limit` dibatasi 1–50. Keluaran per item: `product_id`, brand, nama, varian, ukuran (`pack_count × content_size unit`), `sale_mode`, kategori, similarity. |
| Snapshot, inventaris | `db/schema.sql`, `99_privilege_inventory.sql` | Snapshot `pg_dump` 16. Inventaris anon/authenticated **tidak berubah** (fungsi baru hanya `service_role`). `packages/db-types` tidak berubah (schema `public` tetap). |
| Laporan kalibrasi | `db/scripts/calibration_report.sql` | §8.2 no. 3, dijalankan pemilik proyek (`psql -v since=… -f …`, docs/06 §2.10). Transaksi read only (view sementara dibuat sebelum `set transaction read only`, lalu `rollback`). Saran = baris struk produk / item label-screenshot yang sudah diputuskan, dengan `suggested_product_id`; diterima = produk akhir `price_record` sama dengan saran (mengikuti `merged_into_id`, F-01); koreksi belakangan = tidak diterima. Enam tabel: presisi per tier × sumber, per rentang confidence 0,05, kandidat τ 0,50–1,00 (presisi + coverage), distribusi similarity tier 3 (§8.3), baris tanpa saran, config saat ini. Hanya angka. |
| Matcher tier 4 | `src/extractors/ai-matcher.ts`, `prompts/match.v1.md`, `prompts/index.ts` | `ClaudeAiMatcher` (§7.3): daftar pendek dari `ai_match_shortlist` (screenshot: nama produk + judul listing digabung, F-161) dan `ai_match_max_confidence` dalam satu query; item tanpa daftar pendek tidak dikirim (tanpa panggilan sama sekali jika semua kosong). Satu panggilan per capture lewat `callStructured` (structured outputs, effort `low`, `max_tokens` 2.000, `fallbacks` sesuai model, tenggat lease yang sama dengan ekstraksi). Pesan = JSON {toko, sumber, item bernomor 1..n dengan teks, judul, nominal, kuantitas, kandidat bernomor 1..m}; **tanpa UUID**. Skema `{matches: [{item, choice \| null, confidence, reason}]}` (objek di akar karena structured outputs, F-108). `mapMatches`: item/pilihan di luar daftar pendek, `null`, duplikat, angka bukan bulat dibuang; confidence dijepit 0–1 lalu `min(·, 0,85)`. Error apa pun → `[]` + log `ai.match_failed` (tanpa teks); biaya respons yang sudah diterima tetap dilaporkan. Log `ai.match` (model, versi prompt, jumlah item, biaya). |
| Tipe | `src/pipeline/types.ts`, `src/extractors/stub.ts` | F-112: `UnmatchedItem` + `title`, `amount`, `quantity`; `MatchContext` + `storeName`, `signal`, `onUsage`. Antarmuka `AiMatcher.match` tetap. `StubAiMatcher` mencari kunci fixture di judul listing dulu lalu `raw_text` (perilaku lama untuk screenshot, F-161). |
| Pipeline | `src/pipeline/process-capture.ts` | **Q-133:** matching tier 1–3 satu panggilan `match_products` untuk nama produk (key positif) dan judul listing (key negatif, hanya jika berbeda); `pickMatch` memilih tier lebih kuat lalu confidence, seri → nama produk, kandidat digabung tanpa duplikat (maks 5). Tier 4 hanya jika keduanya tanpa kandidat. Konteks tier 4: nominal (baris struk: `line_amount`; label/screenshot: promo, lalu normal), kuantitas, nama toko (katalog, atau yang terbaca). Biaya tier 4 dijumlahkan ke `processing_run` lewat `record_run_output` kedua dengan output mentah yang sama (F-159). **§12.3:** `BudgetGate` sebelum claim: `ai_spend_today()` ≥ anggaran (`AI_DAILY_BUDGET_USD` atau config) → `processNextCapture` mengembalikan `null` tanpa claim (capture tetap `uploaded`), log `ai.budget_exhausted` maks sekali per jam (F-162). **Lease:** `CAPTURE_LEASE_SECONDS` (bulat positif, default 300) dipakai untuk tenggat AI; `checkLeaseSeconds` saat start menolak nilai > `capture_processing_timeout_seconds` atau ≤ margin 30 dtk. |
| Worker | `src/main.ts`, `.env.example` | `buildDeps` mengisi `leaseSeconds` dan `budget`; `main` memanggil `checkLeaseSeconds` sebelum start. Env baru di `.env.example`. |
| Redaksi | `src/jobs/redact.ts` | §9 lapis 2: nilai `receipt.pii` (semua kunci string, termasuk `member_id`, `member_name`, `customer_name`, `card_masked`, `email`) dicocokkan tanpa beda huruf besar/kecil dan spasi; nilai angka hanya utuh (`4321` tidak menghapus `14321`). Lapis 3: nilai setelah label baris (`NAMA [PELANGGAN/PENERIMA/MEMBER/CUSTOMER]`, `NAME`, `CUSTOMER`, `PELANGGAN`, `MEMBER [NAME/ID/NO]`, `NO MEMBER`, `ID MEMBER`, `KARTU`, `NO KARTU`, `CARD [NO]`, `TELP`, `TELEPON`, `PHONE`, `[NO] HP`, `ALAMAT [PENGIRIMAN]`, `PENERIMA`, `EMAIL`, `APPR [CODE]`, `REF NO`) sampai akhir baris. Label wajib di awal baris dan diikuti `:`/`=`/`#`, atau label kode diikuti angka; nilai harga (`Rp…`) tidak disamarkan (F-163). Pola lama (HP, kartu/NIK, email) tetap. |
| Teks privasi | `features/me/privacy-screen.tsx`, `lib/copy/id.ts` | **Q-114/F-115:** bagian "Pembacaan oleh AI" di `/saya/privasi`: foto dikirim ke Anthropic (Claude) untuk dibaca, pertanyaan Tanya + data harga yang dibutuhkan juga diproses Anthropic, email/data akun tidak dikirim, vendor OCR disebut di sini sebelum dipakai, teks berisi data pribadi disamarkan 7 hari setelah diproses (F-166). |
| Uji live | `test/live/matcher.live.test.ts` | `ClaudeAiMatcher` sungguhan dengan katalog kecil sintetis (Db palsu): ukuran 1 kg vs 500 g, paket 5 × 85 g, item tanpa padanan → tanpa saran, confidence ≤ 0,85. Ikut `test:live` (manual, ±US$0,03). |

### 21.2 Hasil test

| Lapisan | Hasil | Catatan |
|---|---|---|
| L1 `bash db/tests/run.sh` | **650 lulus** (M4: 630) | `88_match_config.sql` 20: default kunci = perilaku lama, `ai_match_max_confidence` < τ; kunci tier diubah → confidence tier 1, 2 (household, global), 2b, 3 ikut berubah, tier 3 dan semua kandidat fuzzy ≤ `fuzzy_max_confidence`; `ai_match_shortlist`: masukan kosong, key dan urutan, produk privat sendiri + ukuran `10 × 25 g`, riwayat beli di toko + kata pertama sama walau similarity rendah, tanpa kandidat → `[]`, brand/kategori, `p_limit`, ambang 0,2, **tidak pernah produk privat household lain** (semua produk privat B dicari dengan namanya sendiri sebagai A, juga setelah B membelinya di toko yang sama), hanya `active`, `authenticated` ditolak (42501); `calibration_report.sql` berjalan di skema terbaru. `70_capture_pipeline` tidak diubah (bukti hasil identik). |
| `snapshot.sh --check`, inventaris | lulus | Inventaris tidak berubah. |
| worker | **168 lulus, 1 dilewati** (M4: 152) | `ai-matcher.test.ts` 13: `mapMatches` (pemetaan + batas 0,85; tujuh kasus buangan), pesan tanpa UUID; matcher + DB (daftar pendek, satu panggilan effort low/`max_tokens` 2.000, teks katalog tanpa id, biaya dilaporkan; household lain → tanpa panggilan; error 500 dan JSON tidak valid → `[]` + biaya tetap dilaporkan); pipeline struk-aeon (hanya SNACK XYZ dikirim, nominal + nama toko, tenggat, saran `ai` 0,85, token/biaya tier 4 masuk run); Q-133 alias judul listing menang atas fuzzy nama produk + kandidat digabung; `pickMatch` tiga kasus; anggaran (tidak claim, capture `uploaded`, log sekali per jam lalu lagi setelah 1 jam, config 2,00 → claim); lease + `parsePositiveEnv`. `unit.test.ts` +3: redaksi lapis 2 (huruf/spasi, angka utuh), lapis 3 positif (18 baris) dan negatif (12 baris: "DISC MEMBER", "HARGA MEMBER 21.000", "Member: Rp21.000", "KARTU UCAPAN", "NAMA BAYI SOAP", "KARTU DEBIT BCA", …). Semua test lama lulus tanpa diubah, termasuk e2e worker screenshot (Q-133). |
| web | **626** | `settings.test.tsx`: bagian "Pembacaan oleh AI" tampil (Anthropic, Tanya). |
| contracts, ai-tools | 70, 55 | Tidak berubah. |
| typecheck, lint + format web, `next build`, `check:bundle`, `check-secrets.sh` | lulus | |
| Uji live | **tidak dijalankan** | Sesi tanpa `ANTHROPIC_API_KEY`; `matcher.live.test.ts` terverifikasi dilewati. |

**Tidak dijalankan di sesi ini:** e2e Playwright dan L4 (job CI `supabase-e2e`), uji live.

### 21.3 Penyimpangan dari desain dan alasannya

| Desain | Dibuat | Alasan |
|---|---|---|
| §11 satu migration `…_ai_integration.sql` | `20261030000100_match_config.sql` | Migration per milestone (F-136, D-95). |
| §7.3 skema output `[{item, choice, confidence, reason}]` | `{matches: [...]}` | Structured outputs butuh objek di akar (F-108). |
| §7.3 "Model: `EXTRACT_MODEL`" | Model lewat `MatcherConfig`, belum dipasang | Model dipilih di D-16; dipasang bersama extractor (F-165). |
| §12.3 biaya tier 4 tercatat | Dijumlahkan ke `processing_run` | Tanpa kolom baru (F-159). |
| Q-133 "judul sebagai cadangan" | Dua teks sekaligus, yang lebih kuat menang | Alias W6 untuk screenshot disimpan dari judul (F-161). |

### 21.4 Temuan baru

| # | Temuan | Dampak | Penanganan | Q |
|---|---|---|---|---|
| F-159 | **Biaya tier 4 tidak punya tempat sendiri.** `ai_spend_today()` menjumlahkan `processing_run.cost_usd`; panggilan matcher terjadi setelah `record_run_output`. | Tanpa pencatatan, anggaran harian kurang hitung (±US$0,02 per capture, §12.2). | `MatchContext.onUsage` → pipeline memanggil `record_run_output` lagi dengan output mentah yang sama dan token/biaya dijumlahkan. Rincian per panggilan hanya di log `ai.match`. Pemisahan per tier (mis. kolom `match_cost_usd`) bisa ditambah di M6 jika analisis biaya membutuhkannya. | Q-139 |
| F-160 | **Aturan daftar pendek (b) "kata pertama sama" memakai kata pertama teks struk vs kata pertama nama produk.** Singkatan kasir ("INDMIE", "SR" untuk Sari Roti) tidak cocok, dan brand tidak dipakai. | Produk yang pernah dibeli bisa tidak masuk daftar pendek jika similarity < 0,2 dan kata pertama berbeda. | Diterima untuk M3; data masa kalibrasi (baris tanpa saran, laporan §2.10 tabel 5) menunjukkan apakah perlu perluasan (mis. alias produk yang sama di toko lain). | — |
| F-161 | **Q-133 tidak bisa murni "judul sebagai cadangan".** Alias W6 untuk screenshot disimpan dari judul listing (D-96 tetap), jadi alias user hanya cocok lewat judul. Jika judul hanya dipakai saat nama produk tanpa kandidat, alias user kalah oleh fuzzy nama produk. | Koreksi user tidak pernah "belajar" untuk screenshot. | Kedua teks dicocokkan dalam satu panggilan; tier lebih kuat menang (alias > fuzzy), lalu confidence, seri → nama produk; kandidat digabung. Tier 4 juga menerima judul (konteks). Stub mencari judul dulu supaya fixture lama tetap berlaku. | — |
| F-162 | **Gerbang anggaran berlaku untuk semua extractor, termasuk `stub`.** Anggaran global (worker + Tanya, §12.3). | Di dev dengan Tanya sungguhan, anggaran yang habis karena Tanya juga menghentikan worker stub (biaya stub 0). e2e tidak terpengaruh (`ASK_ENGINE=stub`, biaya 0). | Sesuai desain (satu anggaran global). Override `AI_DAILY_BUDGET_USD` untuk dev. | Q-140 |
| F-163 | **Redaksi lapis 3 sengaja sempit.** Label harus di awal baris + pemisah (atau label kode + angka). "MEMBER ANI SUSANTI" tanpa titik dua tidak tertangkap lapis 3; hanya lapis 2 jika `pii.member_name` terbaca, atau lapis 1 (transkripsi). | Kebocoran mungkin pada struk dengan format label tanpa pemisah. | Diukur di harness (metrik kebocoran §4.7, target 0) pada foto asli; pola ditambah sesuai temuan. Pola lebar ("MEMBER" di mana saja) ditolak karena menghapus "DISC MEMBER", "HARGA MEMBER". | — |
| F-164 | **`ai_match_shortlist` menghitung `word_similarity` untuk setiap produk aktif per item tanpa indeks** (sama dengan tier 3). | Linear terhadap ukuran katalog × item tanpa kandidat; cukup untuk katalog pribadi (ribuan). | Indeks trigram/batas kandidat ditinjau di Tahap 7 (SaaS) bersama tier 3. | — |
| F-165 | **Versi prompt matcher terpisah (`match.v1`, `MATCH_PROMPT_VERSION`)** dari `promptVersion` ekstraksi yang tercatat di `processing_run.prompt_version` (F-119: satu versi gabungan per deployment). `ClaudeAiMatcher` tidak dipasang ke `buildDeps`. | Versi prompt matcher hanya terlihat di log `ai.match`. | Prompt matcher berubah tanpa mengubah ekstraksi (dan sebaliknya), jadi versi terpisah lebih jujur. Dipasang di M2 dengan env yang sama dengan extractor. | Q-141 |
| F-166 | **Teks privasi Q-114 dibuat sekarang, sebelum extractor sungguhan dipakai**, dan juga menyebut Tanya (sudah memakai Anthropic sejak M5 jika kunci diisi). Vendor OCR tidak disebut (D-16 belum diputuskan). Retensi di sisi Anthropic tidak diklaim. | Teks benar untuk keadaan sekarang dan setelah M2 dengan `vision`. Jika D-16 memilih `ocr+parse`, teks harus diperbarui sebelum dipakai. | Kalimat "Jika nanti dipakai layanan pembaca teks (OCR) lain, namanya dicantumkan di sini lebih dulu." Retensi menyesuaikan pengaturan org (§17). | Q-142 |

### 21.5 Pertanyaan (Q-139 dst.)

| # | Pertanyaan | Usulan default |
|---|---|---|
| Q-139 | Biaya tier 4 dijumlahkan ke `processing_run` (token + biaya), rincian hanya di log `ai.match`, tanpa kolom baru (F-159)? | **Ya**; kolom terpisah ditinjau di M6 jika perlu. |
| Q-140 | Gerbang anggaran harian berlaku untuk semua extractor termasuk `stub` (F-162)? | **Ya** (satu anggaran global, §12.3); dev memakai `AI_DAILY_BUDGET_USD`. |
| Q-141 | Versi prompt matcher terpisah (`match.v1`), tercatat di log `ai.match`, bukan di `processing_run.prompt_version` (F-165)? | **Ya**. |
| Q-142 | Teks privasi "Pembacaan oleh AI" dipakai sekarang, menyebut Anthropic untuk foto dan Tanya, tanpa vendor OCR sampai D-16 (F-166)? | **Ya**; diperbarui sebelum `ocr+parse` dipakai. |

**Hasil review (2026-10-30):** pemilik proyek menerima semua usulan default Q-139 s/d Q-142 → **D-97**.

### 21.6 Berikutnya

Pemilik proyek: tetap §20.6 (foto, kunci, `test:live`, harness, kirim `*.agg.json`); `test:live` kini juga menguji matcher tier 4. Sesudah D-16: M2 memasang extractor terpilih + `ClaudeAiMatcher` ke `buildDeps` (env model), lalu masa kalibrasi M3 (`auto_save_min_confidence` = 1,01, laporan docs/06 §2.10).

---

## 22. Tahap 6b D-16 + M2: hasil dan temuan baru (F-167 dst.)

> Status: **Bagian B (M2) B1–B3 selesai dan disetujui** (2026-10-30; Q-143–Q-146 → **D-98**). **Bagian A (D-16) belum dikerjakan**: laporan agregat `reports/<waktu>.agg.json` (+ `.md`) dan ringkasan `.data/live/*.json` belum diterima di sesi ini. Lampiran A tetap kosong dan keputusan D-16 (D-99) belum diusulkan; tidak ada angka yang dikarang. B4 (teks privasi untuk `ocr+parse`, F-166) menunggu D-16. Basis: `master` setelah D-97 (PR #25). Satu migration baru (hanya data `app.config`). RLS, RPC, dan kontrak tidak berubah. `EXTRACTOR` dan `AI_MATCHER` default tetap `stub`; CI tetap tanpa API berbayar dan tanpa kunci.

### 22.1 Yang dibangun

| Bagian | File | Isi |
|---|---|---|
| Pemilihan AI (B1) | `apps/worker/src/extractors/select.ts`, `src/main.ts` | `selectAi(env, db, factories)`: `EXTRACTOR=stub \| vision \| ocr+parse` dan `AI_MATCHER=stub \| claude` (default `stub`, nilai lain → gagal start). Kunci **`WORKER_ANTHROPIC_API_KEY`** (F-167) wajib jika extractor ≠ `stub` atau matcher `claude`; `ANTHROPIC_API_KEY` (web) tidak pernah dibaca worker, pesan error menyebutnya jika hanya kunci web yang terisi. `EXTRACT_MODEL` (default `claude-opus-5-5`) harus ada di tabel harga (F-169). `EXTRACT_EFFORT_RECEIPT`/`_OBSERVATION` (`low`/`medium`/`high`, default `medium`/`low`). `ocr+parse`: `OCR_ENGINE=google-vision` + `GOOGLE_VISION_API_KEY`. Satu klien Claude untuk extractor dan `ClaudeAiMatcher` (model sama, effort `low`, §7.3). Log start `worker.ai` (extractor, engine, model, effort, matcher; tanpa kunci). Cek kunci + model saat start lewat `GET /v1/models/{model}` (gratis): 401/403/404 → worker berhenti; jaringan/5xx → `ai.verify_skipped`, tetap jalan (F-170). Factory klien bisa diganti, jadi semua jalur diuji tanpa jaringan. |
| Env | `.env.example` | `AI_MATCHER`, `WORKER_ANTHROPIC_API_KEY`, `EXTRACT_MODEL`, `EXTRACT_EFFORT_*`, `OCR_ENGINE`; `GOOGLE_VISION_API_KEY` juga untuk worker `ocr+parse`. |
| Error/tenggat §5.4 (B2) | `apps/worker/test/m2-pipeline.test.ts`, `test/select.test.ts` | L3: extractor dari `selectAi` (vision **dan** ocr+parse, `describe.each`) + `ClaudeAiMatcher` lewat pipeline penuh dengan klien Claude palsu dan OCR palsu. Lihat §22.2. Kode pipeline/extractor tidak diubah: tabel §5.4 sudah dipenuhi implementasi M0–M3, test ini membuktikannya end-to-end untuk kedua extractor. |
| Masa kalibrasi (B3) | `supabase/migrations/20261030000200_calibration_period.sql` | `auto_save_min_confidence` = **1,01** (§8.2 no. 1) + kunci baru `calibration_started_on` = `"2026-10-30"` (F-173). Hanya data `app.config`. |
| Laporan kalibrasi | `db/scripts/calibration_report.sql` | Tanpa `-v since` → sejak `calibration_started_on` (sebelumnya: semua data); tanggal awal dicetak; tabel 6 memuat `calibration_started_on`. |
| Test τ | `db/tests/lib/seed.sql`, `db/tests/flows/89_calibration_period.sql`, `.github/workflows/ci.yml` | Seed test memasang τ 0,90 (perilaku auto-save setelah kalibrasi) untuk L1 dan L3 (`buildTestDb`); `89` menguji nilai migration dan perilaku masa kalibrasi. Job `supabase-e2e`: langkah `psql` τ 0,90 sebelum worker/e2e (F-171). |
| Snapshot | `db/schema.sql` | Data `app.config` (urutan baris ikut berubah karena `update`). |
| Dokumen | `docs/06` §2.10 (masa kalibrasi + membaca laporan), §2.11 (worker mode B dengan extractor sungguhan), §3.2, §4.2 (τ untuk e2e lokal) | |
| Komentar | `vision.ts`, `ocr-parse.ts`, `ai-matcher.ts`, `types.ts`, header test | "belum dipasang ke buildDeps" diganti cara pemasangan lewat env. |

### 22.2 Hasil test

| Lapisan | Hasil | Catatan |
|---|---|---|
| L1 `bash db/tests/run.sh` | **660 lulus** (M2/M3: 650) | `89_calibration_period.sql` 10: migration → τ 1,01 dan `calibration_started_on`, `ai_match_max_confidence` < τ, R2 `get_client_config` memberi 1,01; struk dengan header + baris confidence 1 dan tier barcode → `needs_confirmation`, 0 auto-save, tanpa `price_record`, saran (`suggested_product_id`, tier, confidence) tersimpan; label di sesi aktif confidence 1 → `pending` dengan saran; `calibration_report.sql` tanpa `-v since` memakai `calibration_started_on`. Flow lain tidak diubah (τ 0,90 dari seed). |
| `snapshot.sh --check`, inventaris | lulus | Inventaris tidak berubah. |
| worker | **206 lulus, 1 dilewati** (M2/M3: 168) | `select.test.ts` 12: default stub tanpa klien; nilai tidak dikenal; kunci worker wajib, kunci web tidak dipakai, kunci tidak ada di log; model di luar tabel harga; vision model/effort dari env + matcher klien/model sama; ocr+parse engine `gcv+claude`; factory asli tanpa `GOOGLE_VISION_API_KEY`/engine lain → gagal; matcher claude + extractor stub; cek start 200/401/403/404/koneksi/503. `m2-pipeline.test.ts` 26 (11 × vision dan ocr+parse, ditambah 4 khusus): berhasil (model + effort `high` dari env, tier 4 klien/model/tenggat sama, ocr+parse: gambar hanya ke OCR, biaya run = ekstraksi + tier 4 (+ US$0,0015 OCR)); 429/500/529/koneksi/timeout → `uploaded`; 401/403/400 parameter → sementara + `ai.config_error`, percobaan 3 → `failed` `other` (F-170), 404 → sementara; refusal → `other`; `max_tokens` → diulang 32.000 lalu sukses; tenggat sudah lewat (vision: Claude menerima signal aborted; ocr+parse: OCR berhenti, Claude tidak dipanggil); tenggat habis di tengah panggilan → abort ±1 dtk; tenggat habis sebelum tier 4 → item tanpa saran AI, capture tetap diterapkan, `ai.match_failed`; vision 400 gambar / 413 → `unsupported`; OCR sementara → `uploaded` tanpa Claude; OCR menolak gambar → `unsupported`. |
| web, contracts, ai-tools | **626**, 70, 55 | Tidak berubah. Test L3 web memakai `buildTestDb` (τ 0,90 dari seed). |
| typecheck, lint + format web, `next build`, `check:bundle`, `check-secrets.sh` | lulus | JS `/` 337 KiB modul (tidak berubah). |
| Uji live | **tidak dijalankan** | Sesi tanpa kunci; `test:live` tidak berubah. |

**Tidak dijalankan di sesi ini:** e2e Playwright dan L4 (job CI `supabase-e2e`, termasuk langkah τ 0,90 yang baru), uji live, worker mode B dengan foto asli (kriteria selesai §14 M2, butuh pemilik proyek).

### 22.3 Penyimpangan dari desain dan alasannya

| Desain | Dibuat | Alasan |
|---|---|---|
| §5.1 worker memakai `ANTHROPIC_API_KEY` | `WORKER_ANTHROPIC_API_KEY` | Nama sama dengan kunci web di `.env` yang di-`source` ke shell (F-167). |
| §5.1 hanya cek "kunci kosong" saat start | + cek kunci/model `GET /v1/models` | Kunci salah membuat capture gagal setelah 3 percobaan (F-170). |
| §8.2 masa kalibrasi tanpa catatan | `calibration_started_on` + default `since` laporan | Data auto-save sebelum masa kalibrasi mengacaukan presisi (F-173). |
| §13.1 "test L1 tidak diubah" (M2/M3) | Seed test τ 0,90 + flow `89` | Migration masa kalibrasi mengubah τ semua database (F-171). |

### 22.4 Temuan baru

| # | Temuan | Dampak | Penanganan | Q |
|---|---|---|---|---|
| F-167 | **Kunci worker dan web memakai nama env yang sama** (`ANTHROPIC_API_KEY`, §5.1 dan §10). `.env.example` root berisi `ANTHROPIC_API_KEY` = kunci web, dan docs/06 §2.2 me-`source` `.env` ke shell sebelum menjalankan worker. | Worker diam-diam memakai kunci web: pemakaian tidak bisa dibedakan atau dicabut terpisah (§3.1, §15 no. 5). | Worker hanya membaca `WORKER_ANTHROPIC_API_KEY`; pesan error menyebut jika hanya kunci web yang ada. Harness `ocr-eval` dan `test:live` (alat dev di shell) tetap membaca `ANTHROPIC_API_KEY` dan didokumentasikan sebagai kunci worker (docs/06 §2.8–§2.9). | Q-143 |
| F-168 | **Satu extractor + model per deployment.** `claim_next_capture` mencatat `ocr_engine`/`ai_model`/`prompt_version` sebelum jenis capture diketahui (F-119). | Jika D-99 (keputusan D-16) memilih engine/model berbeda per jenis (struk vs label vs screenshot), `selectAi` butuh extractor perute dan pencatatan engine/model setelah claim (RPC aditif). | Tidak dibangun sebelum D-16; diperkirakan kecil (perute + satu RPC atau parameter tambahan) jika D-99 memerlukannya. | — |
| F-169 | **Model di luar tabel harga** membuat `cost_usd` null, sehingga `ai_spend_today()` dan anggaran harian (§12.3) kurang hitung. | Anggaran tidak menahan pengeluaran. | Worker menolak start jika `EXTRACT_MODEL` tidak ada di `packages/ai-tools/src/pricing.ts`. Model cadangan server-side fallback sudah ada di tabel. | — |
| F-170 | **Kunci salah/dicabut → capture gagal setelah 3 percobaan.** §5.4 memetakan 401/403/400 parameter ke sementara supaya capture tidak gagal karena kunci, tetapi `fail_run` (D-70) menggagalkan capture pada percobaan maksimum apa pun kelasnya (`failed` `other`, ±2,5 menit backoff). | Kunci yang dicabut saat worker berjalan menggagalkan semua capture yang masuk sampai kunci diganti; user bisa "Ulangi" (D-59). | Cek saat start (`GET /v1/models/{model}`, gratis) menangkap kunci/model salah sebelum ada capture yang di-claim. Kunci dicabut di tengah jalan tidak ditangani (jeda claim otomatis setelah `ai.config_error` belum dibuat). | Q-144 |
| F-171 | **Migration masa kalibrasi mengubah τ di semua database**, termasuk test L1/L3 dan e2e yang menguji auto-save (D-12, alur 4 sesi). | Tanpa penanganan: 4 flow L1 (`10`, `70`, `80`, `87`) gagal, dan e2e alur 4 (auto-accept label sesi) akan gagal. | Seed test (`db/tests/lib/seed.sql`, dipakai flow L1 dan `buildTestDb`) dan langkah CI `supabase-e2e` memasang τ 0,90; perilaku masa kalibrasi diuji di `89`. Asersi flow lama tidak diubah. | — |
| F-172 | **Selama masa kalibrasi semua field dan saran ditandai "ragu".** UI menandai field/saran dengan confidence < τ (U-15, `doubtfulFields`, `isDoubtfulMatch`); τ 1,01 > semua confidence. | Tanda "ragu" kehilangan arti selama ±2 minggu; user tetap cukup menekan "Benar" untuk saran yang tepat. | Diterima untuk masa kalibrasi (tanpa perubahan UI). Alternatif: kunci R2 terpisah untuk tanda ragu (kontrak + RPC aditif). | Q-145 |
| F-173 | **Tanggal mulai masa kalibrasi.** Migration hanya bisa memuat tanggal tetap (snapshot `db/schema.sql` memuat data config); worker sungguhan baru dipakai setelah D-16. | Tanpa koreksi, laporan memuat periode sebelum foto asli diproses (tanpa data, jadi tidak salah, tetapi "2 minggu" dihitung dari tanggal yang keliru). | `calibration_started_on` = 2026-10-30; pemilik proyek mengubahnya lewat SQL ke tanggal worker sungguhan pertama kali dipakai (docs/06 §2.10). | Q-146 |
| F-174 | **`AI_MATCHER` default `stub` juga saat extractor sungguhan dipakai.** Matcher stub mencari fixture per sha256 gambar, jadi untuk foto asli tidak pernah memberi saran. | Lupa mengisi `AI_MATCHER=claude` = tier 4 mati diam-diam (tanpa biaya, tanpa error). | Sesuai permintaan (stub default untuk CI/e2e); `worker.ai` mencatat matcher saat start dan docs/06 §2.11 menyebut keduanya. | — |

### 22.5 Pertanyaan (Q-143 dst.)

| # | Pertanyaan | Usulan default |
|---|---|---|
| Q-143 | Kunci worker lewat `WORKER_ANTHROPIC_API_KEY` (bukan `ANTHROPIC_API_KEY`), harness/`test:live` tetap `ANTHROPIC_API_KEY` di shell (F-167)? | **Ya**; harness ikut diganti di Tahap 7 jika kunci per lingkungan dibuat. |
| Q-144 | Kunci/model dicek saat start; kunci dicabut saat berjalan tetap membuat capture gagal setelah 3 percobaan (F-170)? | **Ya** untuk MVP; jeda claim otomatis setelah `ai.config_error` ditinjau di Tahap 7 (hosting). |
| Q-145 | Selama masa kalibrasi semua field/saran tampil "ragu", tanpa perubahan UI (F-172)? | **Ya** (±2 minggu). |
| Q-146 | `calibration_started_on` diubah pemilik proyek lewat SQL ke tanggal worker sungguhan pertama kali memproses foto asli (F-173)? | **Ya**. |

**Hasil review (2026-10-30):** pemilik proyek menerima semua usulan default Q-143 s/d Q-146 → **D-98**.

Keputusan D-16 (engine/model per jenis, effort, τ ekstraksi, Q-34/Q-110, Q-122) diusulkan setelah agregat diterima, sebagai pertanyaan berikutnya (Q-147 dst.), lalu dicatat sebagai **D-99**.

### 22.6 Berikutnya

Pemilik proyek: kirim `reports/<waktu>.agg.json` + `.md` dan ringkasan `.data/live/*.json` (agregat saja). Lalu Bagian A: Lampiran A, usulan keputusan D-16 sebagai pertanyaan (→ D-99), F-168 jika D-99 memilih per jenis, dan B4 (teks privasi) jika `ocr+parse` dipilih. Sesudah D-99 disetujui: worker mode B dengan foto asli (docs/06 §2.11) sebagai kriteria selesai M2, ubah `calibration_started_on`, mulai masa kalibrasi M3.

---

## 23. Struk tempelan dari Gemini: mode pribadi tanpa anggaran AI (D-100)

> Status: **Selesai dan disetujui (2026-10-31; Q-147–Q-150 → D-100, semua usulan default).** Pemakai hanya pemilik proyek sampai ada anggaran. Foto struk/label/screenshot di app **dimatikan lewat saklar** (kode tetap ada dan diuji di CI), struk dibaca di Gemini di luar app, lalu JSON jawabannya ditempel di S-21. Uji OCR D-16 (Lampiran A) dan pemasangan extractor sungguhan ditunda; tidak ada keputusan lama yang dibatalkan.

### 23.1 Alur

```
S-21 /tempel: "Salin prompt" (GEMINI_RECEIPT_PROMPT)
  → user: Gemini + foto struk + prompt → salin jawaban → tempel
  → parsePastedReceipt di klien (format salah ditolak, Q-149) + pratinjau
  → W1b submit_text_capture (capture.source = 'text', pasted_text)
  → worker claim → TextExtractor (tanpa AI, biaya 0)
       parsePastedReceipt → pastedToLlm → convert.ts (cek §5.3) → ParsedReceipt
  → matching tier 1–3 (SQL); tier 4 mati (AI_MATCHER=off)
  → apply_extraction → S-10 konfirmasi struk (sama dengan foto)
```

Format tempelan = satu objek JSON `priceatlas-struk-v1` (`packages/contracts/src/paste.ts`): `store`, `date`, `time`, `total`, `subtotal`, `payment_method`, `lines[]` (`type`, `text`, `quantity`, `unit_price`, `amount`, `applies_to`, `barcode`, `member_discount`), `adjustments[]`, `member`. Tidak ada field PII. Parser toleran: pembungkus ```` ```json ````, kalimat di sekitar JSON, angka sebagai teks rupiah (`"Rp 15.900"`, `"12.345,00"`), kuantitas berkoma (`"0,512"`), field opsional tidak ditulis.

### 23.2 Saklar dan env

| Tempat | Env | Mode pribadi | Menyalakan lagi |
|---|---|---|---|
| Web (build-time) | `NEXT_PUBLIC_PHOTO_CAPTURE` | kosong/`off` (default) | `on` |
| Worker | `EXTRACTOR` | `off`: hanya capture teks yang diklaim | `vision` / `ocr+parse` (D-16) |
| Worker | `AI_MATCHER` | `off`: tanpa tier 4 | `claude` |
| Web (server) | `ASK_ENGINE` | `off` ("Segera hadir") | `claude` + `ANTHROPIC_API_KEY` |

Foto mati: S-06 hanya berisi "Tempel struk dari Gemini"; tombol tengah tab bar menjadi "Tambah struk"; `/kamera?jenis=struk|label|screenshot` menampilkan "Foto sedang dimatikan" + tautan ke S-21; scan barcode tetap ada (gratis, Q-148); tombol foto label di cek harga rak disembunyikan; pintasan manifest menuju `/tempel`; S-09 "Tempel ulang" untuk capture teks; privasi menyebut Gemini dan menyatakan foto tidak dikirim ke AI dari app. Capture teks diproses TextExtractor **apa pun** nilai `EXTRACTOR`, jadi worker stub di CI/e2e juga memprosesnya.

### 23.3 Temuan (F-175 dst.)

| ID | Temuan | Penanganan |
|---|---|---|
| F-175 | Teks bebas dari Gemini butuh AI lagi untuk dibaca (berbayar). | Format JSON tetap + parser deterministik; prompt ditulis di kontrak dan diuji bahwa contohnya lolos parser. |
| F-176 | Gemini tidak memberi confidence. | Confidence tetap `PASTE_CONFIDENCE` = 0,90 per field/baris, lalu dibatasi cek konverter (total, aritmetika, diskon lepas, tanggal). Selama masa kalibrasi (τ = 1,01) semua tetap dikonfirmasi. |
| F-177 | Tabel `capture` punya UPDATE untuk authenticated (RLS): `source`/`pasted_text` bisa diubah lewat REST. | Trigger `capture_source_guard`: `source` tetap, `pasted_text` hanya boleh dikosongkan (retensi). |
| F-178 | `claim_next_capture` menulis engine/model extractor foto ke `processing_run`. | Parameter baru `p_text_engine`, `p_text_prompt_version` (run teks: `paste`, `paste-v1`, model null) dan `p_sources` (EXTRACTOR=off → `{text}`); pemanggil lama 1–4 argumen tetap jalan. |
| F-179 | Teks tempelan bisa memuat PII jika Gemini tidak patuh. | Prompt melarang PII, format tidak punya field PII, `raw_ocr_text` ikut redaksi berkala (§9), `pasted_text` dikosongkan 12 bulan setelah unggah (Q-150, sama dengan gambar). Isi teks tidak pernah dicatat di log. |
| F-180 | Kirim tempelan tanpa antrean offline. | S-21 butuh online (teks tetap di kolom); antrean offline untuk teks tidak dibuat (pemakai tunggal). |
| F-181 | Duplikat: tidak ada hash gambar (U-10/D-71). | Sidik jari D-20 (toko + tanggal + total) di S-10 tetap berlaku. |
| F-182 | e2e Playwright tidak menguji S-21 (CI membangun web dengan foto aktif untuk alur foto). | S-21 diuji di L5b (komponen + axe), W1b/claim/retensi di L1 (`72_text_capture.sql`), pipeline di L3 worker (`text-capture.test.ts`). e2e S-21 ditambahkan jika mode ini dipakai lama. |

### 23.4 Perubahan

* Migration `20261031000100_text_capture.sql`: `capture.source`, `capture.pasted_text` (≤ 50.000 karakter), trigger penjaga, W1b `submit_text_capture` (hanya struk, Q-147), `claim_next_capture` versi baru, R13 `list_captures` + `source`, `enqueue_retention` + `purge_text`. Snapshot, inventaris hak akses, `db-types` diperbarui.
* Kontrak: `paste.ts` (skema, parser, `pastedTotalMatches`, `GEMINI_RECEIPT_PROMPT`), `SubmitTextCaptureInput`, `CaptureSourceSchema`; R13/R14 `source`/`pasted_text` opsional (cache lama, F-150).
* Worker: `src/extractors/text.ts` (`TextExtractor`, `OffExtractor`, `NoAiMatcher`), `EXTRACTOR=off`, `AI_MATCHER=off`, cabang teks di `process-capture.ts`.
* Web: `lib/features.ts`, S-21 `/tempel` (`features/paste/`), saklar di S-06, tab bar, `/kamera`, S-01/S-08 kosong, S-09, cek harga rak, manifest, privasi; `/tempel` di shell SW.

### 23.5 Pertanyaan (dijawab → D-100)

| ID | Pertanyaan | Keputusan |
|---|---|---|
| Q-147 | Cakupan tempel: struk saja, atau label dan screenshot juga? | **Struk dulu.** Label di toko lewat input manual yang sudah ada. |
| Q-148 | Scan barcode (tanpa AI) tetap aktif? | **Ya.** |
| Q-149 | Tempelan yang bukan JSON valid: tolak di layar atau kirim lalu gagal? | **Tolak di layar**; worker tetap memeriksa ulang (gagal `unsupported`). |
| Q-150 | Teks tempelan dihapus otomatis seperti foto (12 bulan)? | **Ya.** |

---

## Lampiran A. Hasil uji OCR

*Belum diisi: agregat belum diterima (§22). Diisi setelah pemilik proyek menjalankan harness pada split test (§4.2, docs/06 §2.8). Sumber: `reports/<waktu>.agg.json` (agregat, tanpa teks struk, nama toko, PII, atau id). Contoh bentuk dari set sintetis + klien palsu: `apps/worker/eval/examples/report-synthetic.md` — **bukan** hasil model.*

### A.1 Data

| | Struk | Label | Screenshot |
|---|---|---|---|
| Ground truth terverifikasi (test) | — | — | — |
| Per kategori toko | — | | |
| Kondisi (panjang, pudar, timbang, member, void, …) | — | | |
| Tanggal uji · versi prompt · harga per | — · v1 · — | | |
| Biaya uji kumulatif (`spend.json`) | — dari US$75 | | |

### A.2 Struk (split test)

| Arm | Sempurna | Toko | Tanggal | Total | Recall baris | Nominal baris | Presisi @τ 0,90 | Coverage @τ | τ min 98 % | ECE | Gagal | Bocor PII | Biaya/struk | p50 | p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| vision-opus-low | | | | | | | | | | | | | | | |
| vision-opus-medium | | | | | | | | | | | | | | | |
| vision-sonnet | | | | | | | | | | | | | | | |
| vision-haiku | | | | | | | | | | | | | | | |
| ocr-gcv+opus-low | | | | | | | | | | | | | | | |

Rincian (diskon, void, non-produk, timbang, member, stabilitas) dan per kategori/kondisi: dari laporan markdown.

### A.3 Label dan screenshot (split test)

| Arm | Label: harga | Label: recall item | Label: presisi @τ | Screenshot: harga | Screenshot: presisi @τ | Biaya label | Biaya screenshot |
|---|---|---|---|---|---|---|---|
| … | | | | | | | |

### A.4 Keputusan §4.8 (usulan, keputusan pemilik proyek, Q-102)

| Jenis | Lolos batas | Terpilih | Alasan | Risiko |
|---|---|---|---|---|
| Struk | | | | |
| Label | | | | |
| Screenshot | | | | |

### A.5 Pertanyaan terbuka yang dijawab data

| ID | Data | Usulan |
|---|---|---|
| Q-34/Q-110 | recall regex D-74 pada diskon member asli: — | ≥ 95 % → tetap D-74; < 95 % → kolom `receipt_line.is_member_discount` (§11.1 #7) |
| Q-122 | p95 latensi struk arm terpilih: — | > 60 dtk → streaming ekstraksi |
| §8.1 | τ ekstraksi minimum untuk presisi 98 %, tabel isotonic dari dev: — | Disimpan bersama versi prompt (M2) |
| §4.2 | Bias pra-isi (error arm pra-isi tanpa vs dengan pra-isi): — | > 1 poin → periksa ulang tanpa pra-isi |
| §12 | Biaya per struk/label/screenshot terukur: — | Perbarui perkiraan §12.2 |
