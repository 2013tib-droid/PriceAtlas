# Tahap 6a — Desain AI Integration (termasuk uji OCR D-16)

> Status: **Disetujui (2026-10-27).** Semua usulan default §16 diterima → **D-92**. Dokumen ini tidak mengubah keputusan D-01 s/d D-91. **6b M0 selesai (2026-10-27), menunggu review:** §18. Q-122, Q-124, Q-125 → **D-93** (default); Q-120, Q-121, Q-123, Q-126 masih terbuka.
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

> Status: **selesai, menunggu review** (2026-10-27). Basis: branch desain 6a (`D-92`). Tidak ada migration, perubahan RPC, atau perubahan RLS. Kontrak `packages/contracts` hanya bertambah dua field opsional. `EXTRACTOR` produksi tetap hanya `stub`; CI tidak memanggil API berbayar dan tidak butuh `ANTHROPIC_API_KEY`.

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
| F-124 | Daftar folder gambar F-117 tidak memuat file gambar yang **sudah** dilacak: `apps/web/public/icons/*.png` (ikon PWA) dan `apps/web/test/fixtures/worker/struk-tanpa-toko.jpg`. `apps/web/e2e/fixtures/` belum ada. | Guard akan langsung gagal di CI. | Allowlist ditambah dua folder itu; `apps/web/e2e/fixtures/` tetap diizinkan untuk nanti. | Q-126 |
| F-125 | **Fixture web ikut bergantung pada fixture palsu (F-40):** `struk-tanpa-toko.jpg` (web), test L5a/L5c yang mengharapkan `undecodable`/`sniffMime = null`, dan sha256 di `rpc.json`. `scenario.ts` juga menyalin isi folder fixture tanpa melewati subfolder (akan gagal begitu `heic/` ada). | Test web rusak setelah fixture diganti. | Fixture web diganti JPEG sintetis; dua test diperbarui ke perilaku JPEG sungguhan (`kept`, ukuran terbaca); di `rpc.json` hanya nilai sha256 yang diganti (membangkitkan ulang penuh mengubah semua tanggal relatif dan jam sesi yang dipakai M4, F-75); `scenario.ts` hanya menyalin file. Prosedur di docs/06 §2.6. | selesai |
| F-126 | **Timeout 120 dtk tanpa streaming vs output struk panjang.** Output struk ±3.400–4.600 token (§12.1) + thinking; percobaan kedua menaikkan `max_tokens` ke 32.000 tetapi timeout tetap 120 dtk. | Struk sangat panjang bisa habis waktu (sementara, diulang) walaupun model masih menulis. | Ukur latensi p50/p95 per jenis di harness M1. Jika p95 struk > 60 dtk: ekstraksi pakai streaming (`stream().finalMessage()`) dengan tenggat yang sama, timeout per panggilan dinaikkan. | Q-122 → D-93 |
| F-127 | Pipeline lama menyimpan `processing_run` mentah **hanya jika extract berhasil**. Refusal/`max_tokens`/output tidak valid sudah memakan biaya. | Biaya dan bukti audit hilang untuk run gagal; anggaran harian (§12.3) jadi kurang hitung. | `TransientError`/`PermanentError` membawa `runOutput` opsional; pipeline menulis `record_run_output` sebelum `fail_run`. `raw_ai_output` vision = `{ llm, meta }` (kontrak `Extraction.rawOutput` aditif). Job redaksi sudah mengosongkan kunci `pii` di kedalaman mana pun. | selesai |
| F-128 | Aturan `max_tokens` §5.4 butuh tahu alasan percobaan sebelumnya, yang tidak disimpan di claim. | — | `max_tokens` = 16.000 di percobaan 1, 32.000 di percobaan ≥ 2 (apa pun alasan gagal sebelumnya); `max_tokens` di percobaan ≥ 2 → permanen. Batas lebih besar tidak menambah biaya kecuali dipakai. | Q-121 |
| F-129 | **Cek total §5.3 menghitung salah untuk struk dengan voucher** yang dicetak di bawah sebagai adjustment (TOTAL tercetak sudah dikurangi voucher), dan model kadang menulis diskon tanpa tanda minus. | Peringatan total palsu (`field_confidence.total` ≤ 0,7) dan Σ salah. | Konverter menerima Σ baris = total **atau** Σ baris − voucher = total; diskon/void selalu dinormalkan negatif; baris `other` tidak dihitung; prompt: `tax` hanya untuk pajak yang menambah total. Diukur di harness (metrik "Σ baris = total"). | Q-123 |
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

Q-120, Q-121, Q-123, Q-126 masih menunggu jawaban (usulan default tetap berlaku sebagai rencana).

### 18.6 Berikutnya

M1 (uji OCR D-16) dan M5 (Tanya) bisa dimulai paralel sesuai §14. M1 butuh dari pemilik proyek: foto (§15 no. 1–4), kunci Anthropic + Google Vision, dan akses jaringan sesi bila uji live dijalankan di sesi cloud (§15 no. 7).

---

## Lampiran A. Hasil uji OCR

*Diisi di 6b M1 (laporan agregat, tanpa teks struk).*
