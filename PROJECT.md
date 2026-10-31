# Price Intelligence — Project Brief

> Dokumen sumber utama (single source of truth) untuk requirement dan keputusan produk.
> Setiap perubahan requirement harus didiskusikan dulu, lalu dicatat di **Decision Log**.

| | |
|---|---|
| Nama sementara | Price Intelligence (repo: PriceAtlas) |
| Status | Tahap 6b M1-harness + M4 selesai dan disetujui (D-96): [`docs/08-ai-integration.md` §20](docs/08-ai-integration.md#20-tahap-6b-m1-harness--m4-hasil-dan-temuan-baru-f-148-dst). Uji OCR D-16 menunggu foto + anotasi pemilik proyek (docs/06 §2.8; `test:live` dulu, Q-138). Bagian M2/M3 yang tidak bergantung pada D-16 (kunci tier di config, daftar pendek + matcher tier 4, anggaran harian, lease, matching screenshot Q-133, laporan kalibrasi, redaksi lapis 2–3, teks privasi Q-114) selesai dan disetujui (D-97): [`docs/08` §21](docs/08-ai-integration.md#21-tahap-6b-m2m3-bagian-tanpa-d-16-hasil-dan-temuan-baru-f-159-dst). **D-16 + M2:** extractor/matcher dipilih lewat env (`EXTRACTOR`, `AI_MATCHER`, kunci `WORKER_ANTHROPIC_API_KEY`), uji §5.4 untuk vision dan ocr+parse, dan masa kalibrasi (τ = 1,01) selesai dan disetujui (D-98): [`docs/08` §22](docs/08-ai-integration.md#22-tahap-6b-d-16--m2-hasil-dan-temuan-baru-f-167-dst). Lampiran A dan usulan keputusan D-16 (→ D-99) menunggu laporan agregat uji OCR. M5 dan M0 selesai dan disetujui (D-93–D-95); set pertanyaan emas menunggu pemilik proyek (Q-129). Cek manual pembaca layar (F-105, Q-101) belum dilakukan; tidak memblokir Tahap 6 |
| Terakhir diperbarui | 2026-10-28 |

---

## 1. Visi Produk

Membantu pengguna mengetahui apakah harga suatu barang **murah atau mahal** berdasarkan **histori harga pribadi**, sehingga bisa mengambil keputusan **sebelum membeli**.

- Ini **bukan** aplikasi budgeting.
- Ini **bukan** aplikasi pencatat pengeluaran.
- MVP untuk penggunaan pribadi. Desain harus siap menjadi SaaS multi-user (target ratusan ribu pengguna).

### Prinsip Utama

> "Gunakan histori harga pribadi sebagai dasar pengambilan keputusan belanja."

**AI bukan database.** Database adalah sumber kebenaran. AI hanya membantu:

- memahami hasil OCR
- mencocokkan produk, toko, dan cabang
- memahami pertanyaan user
- memanggil query yang sudah didefinisikan (bukan menulis SQL bebas)
- menjelaskan hasil query

### Pertanyaan yang Harus Bisa Dijawab

- Berapa harga termurah produk ini?
- Di toko dan cabang mana saya pernah mendapat harga termurah?
- Harga sekarang naik atau turun dibanding bulan lalu?
- Berapa harga per gram / per satuan?
- Apakah kemasan 500 gram lebih murah daripada 200 gram?
- Saya lebih hemat membeli di mana?

---

## 2. Teknologi

| Komponen | Pilihan |
|---|---|
| Frontend | Next.js (mobile-first, kemungkinan PWA) |
| Database | Supabase PostgreSQL |
| Storage | Supabase Storage |
| AI | Claude |
| OCR | Belum ditentukan. Lihat D-16; rancangan uji di `docs/08-ai-integration.md` §4. |
| Analytics DB | Belum memakai ClickHouse |

---

## 3. Sumber Data

1. Foto struk → **Purchase** (barang dibeli). Mode pribadi tanpa anggaran AI (D-100): struk dibaca di Gemini, JSON-nya ditempel di app
2. Foto label harga → **Observation** (harga hanya diamati)
3. Screenshot marketplace → **Observation**

### Alur Pemrosesan

```
Upload gambar
  → antrean (asinkron)
  → OCR / vision
  → parsing oleh AI
  → matching bertingkat:
      1. barcode exact
      2. alias exact (per toko)
      3. fuzzy match di database
      4. AI matching
  → confidence tinggi : auto-save (tetap bisa dikoreksi)
  → confidence rendah : halaman konfirmasi → keputusan user jadi alias baru
```

Gambar asli, teks OCR mentah, dan output AI mentah **selalu disimpan** supaya bisa diproses ulang, diaudit, dan dipakai untuk mengukur akurasi.

Status pemrosesan gambar: `uploaded → processing → needs_confirmation → done / failed`.

---

## 4. Glosarium dan Definisi

| Istilah | Definisi |
|---|---|
| **Household** | Pemilik data. Bisa berisi beberapa user. MVP: 1 household = 1 user. |
| **Product Group** | Keluarga produk lintas ukuran, misalnya "Milo Original". Dasar perbandingan antar ukuran. |
| **Product (SKU)** | Identitas produk yang punya harga, misalnya "Milo Original 500g". Ukuran adalah bagian dari identitas. |
| **Store** | Jaringan toko atau platform (AEON, Alfamart, Shopee). Punya jenis `offline` / `online`. |
| **Branch** | Cabang toko (AEON BSD) atau seller di marketplace. |
| **Receipt (Struk)** | Header transaksi: toko, cabang, tanggal transaksi, total, voucher, metode bayar. Berisi banyak item. |
| **Purchase** | Histori harga dari barang yang benar-benar dibeli. Berasal dari struk. |
| **Observation** | Histori harga yang hanya diamati (label harga, screenshot). Tidak punya struk. |
| **Harga normal** | Harga sebelum diskon. |
| **Harga promo** | Harga setelah promo level item. |
| **Harga member** | Tipe harga terpisah, terikat ke program member tertentu. |
| **Harga efektif** | Harga yang benar-benar dibayar untuk item **setelah diskon level item**. Voucher level struk dan cashback **tidak** mengurangi harga efektif. |
| **Harga per satuan** | Harga efektif ÷ total ukuran dalam satuan dasar. Dihitung otomatis. |
| **Alias** | Teks OCR yang dipetakan ke produk. Disimpan **per jaringan toko**. |

---

## 5. Business Rules

### 5.1 Produk

- Satu produk punya: brand, nama, varian, ukuran, satuan, banyak barcode, dan banyak alias.
- Ukuran adalah bagian dari identitas. Milo Original 200g ≠ Milo Original 500g, tetapi keduanya berada di **Product Group** yang sama.
- **Multipack** disimpan sebagai `jumlah isi × ukuran per isi`. Contoh: Milo 3in1 = 10 × 35g. Sistem bisa menghitung harga per gram dan harga per isi.
- Perbandingan antar ukuran hanya dilakukan dalam satu Product Group. Perbandingan lintas brand dilakukan lewat kategori.
- **Shrinkflation:** ukuran baru menjadi SKU baru di group yang sama. Hubungan barcode ke produk punya periode berlaku.
- **Merge:** produk yang dihapus tetap ada sebagai rujukan ke produk pengganti. Alias, barcode, dan histori pindah ke produk pengganti.

### 5.2 Satuan

- Minimal mendukung: gram, kg, ml, liter, pcs, pack, box, lembar, meter, dan satuan lain bila diperlukan.
- Setiap satuan punya **dimensi**: massa, volume, jumlah, atau panjang. Konversi dan perbandingan hanya valid **dalam dimensi yang sama**.
- `pack` dan `box` adalah kemasan, bukan satuan ukur. Isi kemasan diukur lewat model multipack.

### 5.3 Produk Timbang

- Produk punya flag `dijual_per_berat` (jeruk, daging, permen kiloan).
- Yang disimpan adalah berat aktual, harga per kg/satuan, dan total yang dibayar.
- Varian kualitas dibedakan sebagai produk berbeda, misalnya Jeruk Medan dan Jeruk Sunkist.

### 5.4 Harga

- Setiap histori harga menyimpan harga normal, harga promo, harga efektif, dan harga per satuan.
- Contoh: Rp19.500 ÷ 200g = **Rp97,5/gram**. Tipe angka harus mendukung desimal.
- Kolom mata uang disimpan dari awal. Default IDR.
- Voucher level struk disimpan di struk, tidak dialokasikan ke item.
- Cashback dan poin dicatat sebagai info, tidak mengurangi harga efektif.
- Harga member disimpan sebagai tipe harga sendiri beserta nama programnya. User bisa menandai program member yang dia ikuti.
- Tren dan analisis memakai **tanggal transaksi**, bukan tanggal upload.

### 5.5 Harga Terbaik dan Tren

- **Harga terbaik** ditampilkan dua: termurah dalam **90 hari terakhir** sebagai angka utama, dan termurah **sepanjang masa** sebagai pembanding. Keduanya diberi label promo atau normal.
- Perbandingan default memakai **harga per satuan**.
- **Tren** hanya ditampilkan jika data minimal terpenuhi. Jumlah data dan tanggal data terakhir selalu ditampilkan.
- **Bundle** dicatat dengan flag dan ditampilkan di histori, tetapi **tidak** ikut perhitungan harga terbaik dan tren.

### 5.6 Store dan Branch

- Store dipisah dari Branch karena harga antar cabang bisa berbeda.
- Marketplace: platform = Store (jenis `online`), seller = Branch.
- Cabang yang tutup atau pindah tetap menyimpan historinya.
- **Cabang untuk label harga** ditentukan lewat **sesi belanja** ("Mulai belanja di AEON BSD"), dengan pilihan manual sebagai cadangan.

### 5.7 Struk

- Struk adalah entitas header + item.
- Jumlah item dicek terhadap total struk sebagai sinyal kualitas OCR.
- Baris non-produk (kantong plastik, donasi, poin, PPN terpisah) dikenali dan tidak dicatat sebagai produk.
- Baris diskon ditempelkan ke item di atasnya. Baris void/refund (negatif) ditangani.
- **Duplikat** dideteksi lewat hash gambar dan sidik jari struk (toko + tanggal + total). User diberi peringatan dan memilih sendiri.
- Satu struk boleh terdiri dari beberapa gambar.

### 5.8 Kategori

- Ada kategori bawaan sistem: makanan, minuman, bayi, rumah tangga, kesehatan, elektronik, dan lainnya.
- User boleh menambah kategori sendiri.

### 5.9 AI dan Matching

- Matching bertingkat. AI hanya dipanggil jika cara deterministik gagal (kontrol biaya).
- Item dengan confidence tinggi langsung disimpan. Item dengan confidence rendah masuk halaman konfirmasi.
- Keputusan user menjadi alias baru, **berlaku untuk household itu dulu**. Alias baru dipromosikan ke global setelah dikonfirmasi banyak user.
- AI menjawab pertanyaan user hanya lewat **tools/fungsi yang sudah didefinisikan**.

### 5.10 Koreksi Data

- Setiap koreksi oleh user dicatat di audit log.
- Ringkasan harga terbaik dan tren dihitung ulang otomatis setiap ada koreksi.

---

## 6. Multi-Tenancy dan SaaS Readiness

- Semua data milik **household**. Isolasi data di level database lewat Row Level Security.
- **Katalog hybrid:** katalog produk global bersama, plus produk privat per household.
- Harga dan histori **privat** secara default.
- Berbagi data harga ke publik bersifat **opt-in** dan anonim. Kolom visibilitas disiapkan dari awal.
- Data struk mengandung PII (digit kartu, nama member, nomor HP, lokasi) dan harus diperlakukan sebagai data sensitif sesuai UU PDP.
- Ringkasan harga per produk per household dihitung di muka (pre-aggregated) supaya search tetap cepat.
- Metrik kualitas AI dicatat sejak hari pertama: persentase auto-match, dikonfirmasi, dan dikoreksi.

---

## 7. Search

Hasil search langsung menampilkan, tanpa perlu membuka halaman detail:

- harga terbaik (90 hari dan all-time, dengan label promo)
- toko dan cabang
- tanggal
- harga per satuan
- tren harga (jika data cukup)

---

## 8. Decision Log

| ID | Topik | Keputusan |
|---|---|---|
| D-01 | Harga efektif | Setelah diskon item. Voucher struk disimpan terpisah, tidak dialokasikan. |
| D-02 | Harga terbaik | 90 hari terakhir (utama) + all-time (pembanding), dengan label promo/normal. |
| D-03 | Katalog produk | Hybrid: global + privat per household. Harga tetap privat. |
| D-04 | Pemilik data | Household/workspace. MVP: 1 household = 1 user. |
| D-05 | Akses AI ke database | Hanya lewat tools yang sudah didefinisikan. Tidak ada SQL bebas. |
| D-06 | Marketplace | Platform = Store (online), seller = Branch. |
| D-07 | Berbagi data publik | Opt-in, anonim, default privat. Kolom visibilitas disiapkan dari awal. |
| D-08 | Bundle | Disimpan dengan flag, tidak ikut perhitungan harga terbaik dan tren. |
| D-09 | Pengelompokan produk | Product Group + SKU. Lintas brand lewat kategori. |
| D-10 | Harga member | Tipe harga terpisah dengan nama program. User bisa menandai keanggotaannya. |
| D-11 | Cabang untuk label harga | Sesi belanja, dengan pilihan manual sebagai cadangan. GPS tidak dipakai di MVP. |
| D-12 | Auto-save | Confidence tinggi langsung disimpan; confidence rendah dikonfirmasi; semua bisa dikoreksi. |
| D-13 | Cakupan alias | Per jaringan toko. |
| D-14 | Cashback / poin | Dicatat sebagai info, tidak mengurangi harga efektif. |
| D-15 | Tren | Hanya jika data minimal terpenuhi; jumlah data dan tanggal terakhir selalu ditampilkan. |
| D-16 | OCR | Uji Claude vision langsung vs OCR khusus + Claude dengan 30–50 struk asli, lalu putuskan. |
| D-17 | Multipack | `jumlah isi × ukuran per isi`. |
| D-18 | Shrinkflation | Ukuran baru = SKU baru di group yang sama; barcode punya periode berlaku. |
| D-19 | Struk | Entitas header + item. Label harga dan screenshot = observasi tanpa struk. |
| D-20 | Struk duplikat | Deteksi lewat hash + sidik jari, user diberi peringatan dan memilih. |
| D-21 | Merge produk & koreksi | Produk yang di-merge menjadi rujukan ke produk pengganti; audit log; ringkasan dihitung ulang. *(Default yang diusulkan, belum ada keberatan.)* |
| D-22 | Histori harga | Purchase dan Observation disatukan menjadi satu entity **Price Record** dengan jenis sumber (`receipt` / `price_label` / `marketplace`). |
| D-23 | Baris struk | **Receipt Line** (baris apa adanya, termasuk diskon/non-produk/void) terpisah dari Price Record. Price Record pembelian diturunkan dari Receipt Line, satu arah. |
| D-24 | Kepemilikan vs visibilitas | Dipisah. Owner: System / Household / Hybrid. Visibilitas: privat / publik opt-in. |
| D-25 | Berbagi publik | Lewat proyeksi anonim terpisah (Public Price Fact), bukan membuka baris Price Record lewat RLS. Hanya produk dan toko global. |
| D-26 | Harga efektif observasi | Harga terendah yang berlaku untuk household pada tanggal observasi (promo jika aktif, member jika household ikut programnya). |
| D-27 | Harga member di harga terbaik | Hanya dihitung jika household menandai keanggotaan program tersebut. Selain itu tetap tampil di histori dengan label member. |
| D-28 | Cabang tidak diketahui | Store wajib, Branch opsional. Record tanpa cabang tetap ikut harga terbaik dengan label "cabang tidak diketahui". |
| D-29 | Data baru dari user | Produk, Store, Branch, Brand, Category baru dari user selalu privat. Masuk katalog global hanya lewat kurasi (MVP: pemilik proyek). |
| D-30 | Merge data global | Operasi sistem (service role), bukan operasi user. User hanya boleh merge data privat miliknya. |
| D-31 | Ringkasan 90 hari | Disimpan di Price Summary; dihitung ulang saat data berubah dan oleh job harian untuk pergeseran jendela waktu. |
| D-32 | Retensi gambar | Gambar disimpan 12 bulan lalu dihapus. Teks OCR mentah disimpan setelah PII disamarkan. Hapus akun = hapus gambar. |
| D-33 | Dasar tren | Harga efektif per satuan, dengan opsi tampilan "hanya harga normal". Ambang data minimal adalah parameter konfigurasi. |
| D-34 | Promo kuantitas vs bundle | Promo kuantitas dicatat sebagai harga promo dengan kuantitas syarat dan ikut harga terbaik. Bundle campuran diberi flag dan tidak ikut (D-08). |
| D-35 | Promosi alias | Alias menjadi global jika 3 household berbeda memetakan teks + Store yang sama ke produk global yang sama, tanpa pemetaan tandingan. Alias household menang atas alias global untuk household itu. |
| D-36 | Ongkir marketplace | Disimpan sebagai info, tidak mengubah harga efektif. |
| D-37 | Split produk | Buat produk baru, lalu record dipindahkan manual oleh user. Tidak ada pemindahan otomatis. |
| D-38 | Override kategori | Household tidak bisa mengubah kategori produk global di MVP. |
| D-39 | "Lebih hemat di mana" | MVP per produk dan per Product Group. Perbandingan per keranjang ditunda setelah MVP. |
| D-40 | Brand | Entity sendiri (hybrid), bukan teks bebas di Product. |
| D-41 | Keanggotaan member baru | Bergabung ke program member tidak menghitung ulang harga efektif observasi lama (berlaku "pada tanggal observasi", D-26). |
| D-42 | Jumlah data di ringkasan | Hanya record yang ikut perhitungan (aktif, bukan bundle), konsisten dengan harga terbaik. |
| D-43 | Sesi belanja | Kedaluwarsa otomatis setelah 4 jam. |
| D-44 | Parameter tren | Rata-rata harga per satuan 30 hari terakhir vs 30 hari sebelumnya; minimal 2 data per jendela; perubahan < 2% = stabil. Dapat diubah di `app.config`. |
| D-45 | Partisi `price_record` | Ditunda. Ditinjau ulang di ~50 juta baris atau p95 query > 50 ms; kandidat `HASH (household_id)`. |
| D-46 | Granularitas data publik | Fakta publik menyimpan tanggal transaksi harian dan cabang. |
| D-47 | Pola UX | Usulan U-01 s/d U-22 di `docs/04-wireframe.md` §7 diterima: 4 tab + tombol kamera di tengah, search di bawah layar, hasil search dikelompokkan per Product Group, aksi utama di sepertiga bawah layar, label harga selalu berupa teks (tidak hanya warna). |
| D-48 | Kandidat item observasi | Disimpan di tabel staging baru `capture_item` (kandidat produk, harga terbaca, confidence, status `pending/accepted/rejected`, rujukan ke `price_record` setelah diterima). Diterapkan di Tahap 4. |
| D-49 | Struk draft | `receipt.store_id` boleh NULL hanya selama `status = 'draft'`. Tambah `receipt.field_confidence jsonb` untuk menandai field header yang meragukan. Diterapkan di Tahap 4. |
| D-50 | Ambang auto-save | `app.config.auto_save_min_confidence = 0.90`, nilai final setelah uji OCR (D-16). Selisih total struk hanya ditampilkan sebagai peringatan, tidak memaksa konfirmasi. Struk yang dicurigai duplikat tidak pernah di-auto-save. |
| D-51 | Opt-in berbagi publik | Disimpan di `household.share_prices_public` (default `false`). Hanya berlaku untuk record baru. "Bagikan juga data lama" adalah aksi eksplisit terpisah. Mematikan opt-in menarik semua fakta yang sudah dibagikan. |
| D-52 | Program member di luar katalog | Kurator men-seed program toko besar sebelum rilis. Jika programnya tidak ada, harga member disimpan sebagai catatan di `price_record.extra` (`member_note`) dan tidak ikut harga terbaik. Tidak ada program member privat di MVP. |
| D-53 | Search | Mencari juga nama brand (join di RPC search). Produk katalog tanpa histori tetap tampil, di bawah hasil yang punya data. Produk `merged`/`archived` disaring. |
| D-54 | Label tren | D-44 (30 hari vs 30 hari sebelumnya) dipakai di semua tempat, termasuk tool AI. Label UI: "vs 30 hari sebelumnya". Query bulanan §9 no. 3 desain fisik diselaraskan di Tahap 4. |
| D-55 | Cek harga rak | Kalkulator di detail produk. Tidak menyimpan data, sehingga tidak ada sumber data baru. Ambang "mendekati harga terbaik" ≤ 5% di `app.config`. |
| D-56 | Data publik di UI | Tidak ditampilkan di MVP. Prinsipnya tetap histori pribadi. |
| D-57 | Tanya (AI) | Layar dirancang di Tahap 3, dibangun di Tahap 6. Hanya memakai tools berbasis query §9 desain fisik. Tidak menjawab soal pengeluaran atau dari pengetahuan umum, dan tidak menulis data. |
| D-58 | Scan barcode di search | Ya, jika browser mendukung BarcodeDetector. Jika tidak, ikonnya disembunyikan. |
| D-59 | Foto saat offline | Disimpan di perangkat dan diunggah otomatis saat ada sinyal. ID capture dibuat di klien. |
| D-60 | Default UX lainnya | Satuan tampilan = satuan dasar. Tanpa notifikasi push, undo merge, foto produk, atau laporan produk global di MVP. Login: email OTP + Google. Screenshot pesanan marketplace = observasi. Sesi belanja wajib punya cabang. Sesi bisa diperpanjang +2 jam. Cache offline = produk yang pernah dibuka + 50 produk terbanyak data. Baris dengan 1 data tetap ikut urutan "lebih hemat di mana". Tanggal screenshot default = tanggal unggah dan bisa diubah. Rincian: W-12, W-13, W-15 s/d W-24 di `docs/04-wireframe.md`. |
| D-61 | Arsitektur backend | Klien memanggil Supabase langsung (PostgREST untuk CRUD sederhana, RPC PostgreSQL untuk operasi bisnis) dengan JWT user. Route Handler Next.js hanya untuk operasi bersecret (hapus akun; Tanya di Tahap 6). Worker Node.js long-running dengan koneksi Postgres langsung. pg_cron untuk job SQL. Monorepo pnpm (`supabase/`, `apps/web`, `apps/worker`, `packages/*`). Hosting worker ditunda ke Tahap 7. Status unggahan memakai polling, bukan Realtime. Rincian: `docs/05-backend-design.md` §1. |
| D-62 | Kolom `capture_item` | Sesuai `docs/05-backend-design.md` §2.2, termasuk `region`, `candidate_product_ids` (maks 5), lokasi dan seller per item, `transaction_date`, semua field harga, `extra`, `field_confidence`. |
| D-63 | Turunan struk (D-23) | Ditegakkan di database: trigger turunan `receipt_line → price_record` + trigger konsistensi yang menolak perubahan angka langsung. Aturan turunan §4.3. Neto ≤ 0 tidak menghasilkan record. Diskon member di struk: harga dibayar = harga efektif (D-01), `price_basis = 'promo'`, dicatat di `extra.member_hint`. Parser memisahkan deskripsi item ke `raw_text` (dipakai sebagai teks alias). |
| D-64 | PII dan hak akses | `receipt.pii` dan `processing_run.raw_*` tidak bisa dibaca `authenticated` (hak kolom). `audit_log` tidak menyimpan `pii`. `processing_run` select saja untuk user. `receipt` update hanya kolom header. Transisi `capture.status` dijaga trigger. `receipt.pii` dikosongkan bersama purge gambar 12 bulan. Ekspor data pribadi tidak di MVP. |
| D-65 | Perbaikan merge dan fakta publik | Merge produk privat ke global tidak memindahkan barcode privat; matching barcode mengikuti `merged_into_id`. Penghapusan fakta publik dijalankan di `BEFORE DELETE`. Hapus akun mempertahankan fakta anonim (tautan dilepas dulu); opt-out tetap menarik semua fakta (D-51). |
| D-66 | Kontrak `price_record.extra` | Kunci: `shipping_fee`, `shop_voucher`, `cashback`, `points`, `listing_title`, `listing_url`, `member_note`, `member_eligible` (snapshot kelayakan member saat record dibuat), `member_hint`, `note`. Kunci lain ditolak. Berlaku juga untuk `capture_item.extra`. |
| D-67 | Visibility record baru | Saat insert, `visibility` selalu mengikuti `household.share_prices_public` (nilai dari klien diabaikan). Update manual per record tetap diizinkan, tetapi tidak dipakai UI. Flag household hanya diubah lewat RPC. |
| D-68 | Hardening skema | `CHECK (store_id IS NOT NULL OR branch_id IS NULL)` di `receipt`, `capture`, `capture_item`. Ringkasan harga hanya menghitung mata uang default household. Zona waktu database `Asia/Jakarta` untuk MVP; job harian 17:05 UTC; RPC baru memakai `household.timezone`. |
| D-69 | Storage | Bucket `captures` privat, maks 10 MB, jpeg/png/webp/heic. User hanya `SELECT` + `INSERT` di folder household-nya. Hapus file hanya oleh service role lewat Storage API. |
| D-70 | Job dan konfigurasi | Jenis job baru: `delete_household`, `share_existing_prices`, `purge_storage_paths`. Kunci config operasional §5.6 (percobaan maks 3, timeout 300 dtk, backoff 30/120/600 dtk, fuzzy 0,5, unggahan yatim 24 jam, redaksi OCR 7 hari, perpanjang sesi 2 jam). Nilai confidence per tier adalah placeholder sampai uji OCR (D-16). |
| D-71 | Aturan pipeline | Auto-save struk juga mensyaratkan confidence header toko dan tanggal ≥ ambang. Observasi tanpa harga yang berlaku ditolak (`NO_APPLICABLE_PRICE`); seri diurutkan normal → promo → member. Tambah `capture.error_code` dan `capture.captured_at`. Konfirmasi struk wajib memutuskan semua baris, dengan opsi "lewati". Duplikat hash tetap dicurigai di konfirmasi walaupun user memilih "Tetap unggah". |
| D-72 | Lain-lain Tahap 4 | Merge global oleh sistem tetap satu transaksi di MVP. Satu sesi belanja aktif per household, ditegakkan oleh RPC. `db/schema.sql` menjadi snapshot hasil generate dari migration, dicek CI. |
| D-73 | Hak akses tambahan 4b | `receipt` tetap bisa di-`INSERT` oleh `authenticated` (tanpa `pii`) di MVP; klien tidak punya alur yang menyisipkan struk. Hapus akun dari Route Handler memanggil `public.begin_account_deletion` yang hanya bisa dijalankan `service_role`. Kode error baru `FORBIDDEN` (403) dan `INVALID_INPUT` (400). Penyimpangan lain di `docs/05-backend-design.md` §10.3 diterima. |
| D-74 | Aturan struk 4b | Void ikut dihitung pada baris timbang. `member_hint` dideteksi dari teks baris diskon yang memuat "member" (kolom baru ditinjau di uji OCR, Tahap 6). Duplikat hash ke capture tanpa struk hanya mencegah auto-save, tidak tampil di banner S-10. |
| D-75 | Aturan pipeline 4b | `retry_capture` oleh user memulai putaran baru 3 percobaan. Tier 4 (AI) hanya untuk item tanpa kandidat dari tier 1–3, sampai uji OCR (D-16). |
| D-76 | Hapus akun | Teks konfirmasi `"HAPUS AKUN"` dan login ulang = `last_sign_in_at` ≤ 15 menit. Teks UI final di Tahap 5. |
| D-77 | Tooling dan awal Tahap 5 | `db/schema.sql` = snapshot `public` + `app` + data referensi. `packages/db-types` dibangkitkan di awal Tahap 5. Mode B (Supabase CLI) dan test L4 manual dijalankan di awal Tahap 5; temuan dicatat sebagai F-xx baru. |
| D-78 | Versi database dan Supabase lokal | PostgreSQL 17 di semua tempat (`config.toml`, CI, mode A) karena Supabase hanya menyediakan 15/17 (F-17). `packages/db-types` dan test L4 dibangkitkan/dijalankan di job CI dengan Supabase CLI, dengan cek drift. Perbaikan F-18 s/d F-22 masuk M0. Rincian: `docs/07-frontend-design.md` §1. |
| D-79 | Arsitektur frontend | Shell statis + data diambil di klien lewat supabase-js (JWT user). Id entitas lewat query string (`/produk?id=`). Slug route berbahasa Indonesia, identifier kode bahasa Inggris. `proxy.ts` (segarkan sesi) dan `/auth/callback` (PKCE Google) adalah pengecualian auth pada D-61; tidak ada penulisan data lewat server Next.js. |
| D-80 | Stack UI | Tailwind CSS v4 + primitif Radix (pola shadcn/ui), lucide-react, vaul, sonner. TanStack Query v5 + persist IndexedDB (data struk tidak di-persist). react-hook-form + zod dari `packages/contracts`. Grafik S-03 dengan SVG sendiri. ESLint (flat + jsx-a11y) + Prettier. |
| D-81 | PWA dan offline | Serwist (spike di M0, cadangan workbox). SW tidak meng-cache REST/Storage/Auth. Antrean foto di IndexedDB diunggah dari halaman, bukan Background Sync. Mulai sesi belanja butuh online. Keluar/hapus akun menghapus data lokal (dengan peringatan jika antrean belum kosong). Ajakan pasang PWA di iOS + `storage.persist()`. Batas UI 10 bagian per struk, peringatan antrean > 50 MB. |
| D-82 | Kamera dan gambar | Struk memakai kamera bawaan (`<input capture>`), label dan barcode memakai jendela bidik di app. Scan barcode disembunyikan jika BarcodeDetector tidak ada (D-58, tanpa polyfill di MVP). Kompresi di klien: sisi panjang 2560 px (struk) / 2048 px (lainnya), JPEG 0,85–0,88, target ≤ 1,5 MB, EXIF dibuang, aturan lewati kompresi; HEIC apa adanya di browser non-Safari, konversi di worker pada Tahap 6. |
| D-83 | Login, bahasa, test | Login hanya dengan kode OTP 6 digit (tanpa magic link), template email Indonesia di `supabase/templates/`. UI hanya id-ID tanpa pustaka i18n, teks terpusat di `lib/copy/id.ts`. e2e Playwright memakai Supabase CLI di CI, profil Chromium dan WebKit. |
| D-84 | Hasil review M0 | Pemilik proyek menyerahkan Q-65 s/d Q-67 ke usulan default (`docs/07-frontend-design.md` §13.4). Anggaran JS 200 kB tetap peringatan CI sampai M7, lalu diukur ulang (kandidat: `zod/mini` untuk validasi input `rpcCall`, skema per layar), tanpa mengubah kontrak. Data lokal (IndexedDB, antrean foto) hanya dihapus lewat aksi Keluar atau hapus akun; sesi kedaluwarsa hanya membersihkan cache di memori dan meminta login lagi. Input kode OTP satu kolom (`autocomplete="one-time-code"`), bukan 6 kotak. |
| D-85 | Hasil M1: pertanyaan Q-68 s/d Q-71 | Pemilik proyek menerima usulan default (`docs/07-frontend-design.md` §13.5). Baris "Termurah sepanjang masa" tetap selalu tampil di kartu dan detail (D-02 harfiah, ditinjau di audit M7). SearchDock diuji di iPhone sungguhan; jika tertutup keyboard, posisinya mengikuti `visualViewport` di M7 (tanpa pustaka). Nama group untuk S-04/S-05 tetap diambil di klien lewat R4, tanpa mengubah R11. Tautan ke layar yang belum ada tetap berupa pesan/placeholder/nonaktif (tanpa 404) dan disambungkan per milestone: S-14 dengan kode barcode terisi (M3), S-16 (M5), S-19b (M6), S-20 (M7), kamera (M2/M4). |
| D-86 | Hasil M2: pertanyaan Q-72 s/d Q-75 | Pemilik proyek menerima usulan default (`docs/07-frontend-design.md` §13.6). Fixture gambar worker tetap untuk M2; file yang tidak bisa didekode browser (HEIC di non-Safari, file rusak) diunggah apa adanya jika ≤ 10 MB dan tipenya diizinkan, worker yang menilai (F-40); fixture JPEG sungguhan dipertimbangkan di Tahap 6 bersama uji OCR (D-16). CSP `script-src` memakai `'unsafe-inline'` di MVP karena shell statis (F-44), ditinjau di Tahap 7 (hash skrip atau nonce). Dialog duplikat hash U-10 hanya menyebut tanggal di M2; nama toko ditinjau di M3 lewat R13 di cache, tanpa RPC baru (F-46). S-09 mengambil jumlah "perlu dicek" dan lokasi dari R13 di cache, tanpa mengubah R14 (F-41, pola Q-70); ditinjau di M3. |
| D-87 | Hasil M3: pertanyaan Q-76 s/d Q-79 | Pemilik proyek menerima usulan default (`docs/07-frontend-design.md` §13.7). `category`, `brand`, `product_group` masuk daftar REST langsung sebagai **baca saja** (RLS); tulis tetap lewat W8 (F-51). Harga member dari label tanpa toko (`extra.member_note`) diisi ulang user di S-11; pemetaan ulang otomatis ditinjau bersama uji OCR di Tahap 6 (F-57). e2e alur 5 tetap mencapai S-11 lewat unggahan kedua (duplikat hash, D-71); fixture screenshot ber-confidence rendah dipertimbangkan di Tahap 6 (F-50). Koreksi baris kecil lewat W7 tetap di S-10 mode tersimpan; di M5 baris di-tap membuka S-16 untuk koreksi lengkap (F-52). |
| D-88 | Hasil M4: pertanyaan Q-80 s/d Q-84 | Pemilik proyek menerima usulan default (`docs/07-frontend-design.md` §13.8). `vs_best_pct` R18 tetap dibandingkan dengan ringkasan saat ini (harga terbaik baru tampil "setara harga terbaikmu", F-60) dan status label di S-13 tetap per foto (F-61); keduanya ditinjau sebagai satu perubahan RPC di Tahap 6. e2e alur 4 tetap: foto kamera palsu diperiksa sampai capture terdaftar dengan sesi, isi kartu dari label-milo lewat galeri (F-63); ditinjau saat stub diganti di Tahap 6. Kartu label S-13 tanpa thumbnail di MVP, ditinjau di audit M7 (F-66). Kartu "Label di sesi ini" di beranda tidak dibuat; banner sesi cukup, ditinjau di M6/M7. |
| D-89 | Hasil M5: pertanyaan Q-85 s/d Q-88 | Pemilik proyek menerima usulan default (`docs/07-frontend-design.md` §13.9). `barcode_assignment` masuk daftar REST langsung: select + insert untuk produk privat sendiri (RLS, check `plu ⇒ store_id`, exclusion constraint yang sudah ada), tanpa RPC baru; dibuat di M6 untuk barcode/PLU produk privat yang sudah ada (F-69, F-55). S-15 edit tidak membuat brand/group baru; brand/group baru tetap lewat W8 (F-70). Teks alias R20 untuk label/listing tetap kalimat umum di MVP, ditinjau di Tahap 6 bersama Q-80/Q-81 (F-72). `product` select (RLS: global + privat sendiri) disahkan sebagai REST langsung baca, bersama PATCH produk privat sendiri (F-77, pola D-87). |
| D-90 | Hasil M6: pertanyaan Q-89 s/d Q-92 | Pemilik proyek menerima usulan default (`docs/07-frontend-design.md` §13.10). Status onboarding S-00b tetap per perangkat (💾) di MVP, tanpa kolom server; S-00b boleh tampil lagi setelah Keluar atau di HP baru, ditinjau di audit M7 (F-80). Teks konfirmasi hapus akun tetap persis `HAPUS AKUN` (sama dengan route), dengan input huruf besar otomatis + petunjuk (F-88). Tab bar tetap tampil di S-00b/S-00c (grup `(app)`, §7.1), ditinjau di audit M7 (F-89). `supabase/config.toml` lokal/CI: `email_sent = 100` per jam dan `max_frequency = "1s"` untuk e2e; batas produksi ditetapkan di Tahap 7 (F-86). |
| D-91 | Hasil M7: pertanyaan Q-93 s/d Q-101 | Pemilik proyek menerima usulan default (`docs/07-frontend-design.md` §13.11). Anggaran JS tetap peringatan: dasar ukur = modul saja (polyfill `noModule` ditampilkan terpisah), batas peringatan 350 KiB modul, 200 KiB tetap target; pengurangan zod/kontrak (`"sideEffects": false` + impor lazy di `packages/contracts`, tanpa mengubah skema) ditinjau di Tahap 7 (F-94). Pengganti "Lighthouse PWA installable" = CDP `Page.getInstallabilityErrors` pada profil Chromium persisten + cek manifest di e2e (F-95). Baris "Termurah sepanjang masa" diringkas menjadi "sama dengan 90 hari terakhir" jika `best_all.record_id = best_90d.record_id`, di S-02 dan S-03, tanpa ubah RPC (F-99). SearchDock (dan `StickyAction` saat input di dalamnya fokus) mengikuti `visualViewport` tanpa pustaka; diverifikasi pemilik proyek di iPhone (F-100). Kartu label S-13 tetap ikon; thumbnail ditinjau di Tahap 6 bersama perubahan R18 (Q-80/Q-81) (F-101). Kartu "Label di sesi ini" di beranda tidak dibuat (F-102). Status onboarding dan ajakan pasang iOS tetap per perangkat; status server ditinjau di Tahap 7 (F-103). `/selamat-datang` dan `/selamat-datang/member` pindah ke grup layout `(onboarding)` tanpa `TabBar`/`SessionBanner` (URL dan `SHELL_ROUTES` tetap) (F-104). Cek manual VoiceOver/TalkBack (daftar `docs/07` §1.11) dijalankan pemilik proyek di satu iPhone dan satu Android sebelum Tahap 6 (F-105). |
| D-92 | Hasil Tahap 6a: pertanyaan Q-102 s/d Q-119 | Pemilik proyek menerima usulan default (`docs/08-ai-integration.md` §16). Uji OCR D-16 dengan lima arm (vision Opus 5.5 low/medium, Sonnet 5.5, Haiku 5.5; Google Cloud Vision + Opus 5.5 low) pada 40 struk + 20 label + 10 screenshot, split dev 30 % / test 70 %; kriteria §4.8 (presisi auto-save ≥ 98 %, nominal ≥ 97 %, tanggal/total ≥ 98 %, kebocoran PII 0, kegagalan ≤ 2 %, lalu biaya terendah, vision jika selisih < 1 poin); model produksi dipilih pemilik proyek dari laporan, default `claude-opus-5-5`. Harness dijalankan pemilik proyek di mesinnya; data asli hanya di `.data/ocr-eval/`, yang di-commit hanya laporan agregat. Vision menulis transkripsi dengan PII disamarkan di sumber. Kalibrasi matching lewat masa kalibrasi (τ = 1,01 selama 2 minggu / ≥ 150 baris); tier 4 dibatasi 0,85 dan Q-36 diputuskan sesudahnya; confidence tier pindah ke `app.config` + `fuzzy_max_confidence`. `member_hint` sebagai kolom diputuskan dari data uji (regex recall ≥ 95 % → tetap D-74). Q-77: kolom `read_member_price`/`read_member_program_name` + pemetaan ulang di W18. EXIF/GPS HEIC di bucket dibiarkan; gambar ke AI selalu bersih. Redaksi PII tiga lapis tanpa AI tambahan. Teks privasi menyebut pemroses AI. Tanya: Opus 5.5 effort low, tanpa streaming, jawaban terstruktur, maks 4 putaran tool, timeout 45 dtk, kuota 30/hari dan 300/bulan per household lewat RPC DEFINER; anggaran AI harian global US$2. Fixture JPEG sintetis (Q-72), fixture screenshot ber-confidence rendah (Q-78), `STUB_FALLBACK_FIXTURE` khusus e2e (Q-82). Milestone 6b M0 → (M1 ∥ M5) → M2 → M3 → M4 → M6. |
| D-93 | Hasil review sebagian 6b M0: Q-122, Q-124, Q-125 | Pemilik proyek menerima usulan default (`docs/08-ai-integration.md` §18.5). Streaming ekstraksi diputuskan dari latensi harness M1: p95 struk > 60 dtk → streaming + timeout per panggilan dinaikkan dengan tenggat lease tetap, selain itu tanpa streaming (F-126). Tenggat AI di M2 memakai env `CAPTURE_LEASE_SECONDS` (default 300) dan worker menolak start jika lebih besar dari `app.config.capture_processing_timeout_seconds` (F-130). Test HEIC dilewati sampai `apps/worker/test/fixtures/heic/sample.heic` ada; HEIC diuji lewat uji live/harness M1 dengan foto asli (F-133). Q-120, Q-121, Q-123, Q-126 → D-94. |
| D-94 | Hasil review 6b M0: Q-120, Q-121, Q-123, Q-126 | Pemilik proyek menerima usulan default (`docs/08-ai-integration.md` §18.5). `VisionExtractor` dibuat di M0 tanpa dipasang ke `buildDeps`; pemasangan (`EXTRACTOR=vision`, kunci wajib saat start) di M2. `max_tokens` 16.000 di percobaan 1 dan 32.000 di percobaan ≥ 2; `max_tokens` di percobaan ≥ 2 → gagal permanen (F-128). Cek total menerima Σ baris = total atau Σ baris − voucher = total, diskon/void dinormalkan negatif, `tax` hanya pajak yang menambah total; diukur di harness (F-129). Allowlist gambar F-117: `apps/worker/test/fixtures/`, `apps/web/test/fixtures/`, `apps/web/e2e/fixtures/`, `apps/web/public/icons/`, `docs/wireframes/` (F-124). |
| D-95 | Hasil review 6b M5: Q-127 s/d Q-131 | Pemilik proyek menerima usulan default (`docs/08-ai-integration.md` §19.5). `record_ask_usage` tetap bisa dipanggil user (DEFINER, ≤ US$1 per pertanyaan, maks satu catatan per pertanyaan yang dihitung) di MVP; risiko DoS anggaran global ditinjau di Tahap 7 sebelum ada user lain (service role khusus route atau anggaran per household) (F-138). Pertanyaan dari S-02 (`?q=`) dikirim otomatis sekali saat S-20 terbuka jika online, lalu URL dibersihkan (F-143). Set pertanyaan emas dijalankan pemilik proyek dengan kunci web; M5 selesai penuh setelah target §13.3 tercapai, jika tidak → prompt `ask-v2`; p95 > 10 dtk → streaming ditinjau (F-146). `basis` jawaban berupa objek `{jumlah_data, tanggal_terakhir}` diformat UI, dan pemetaan §10.3 diperluas (data 0 / `not_enough` tanpa tool / ambigu tanpa pilihan → `not_enough` teks tetap; refusal → `out_of_scope`) (F-139, F-140). `app.ai_spend_today()` dibuat di M5, tabel harga dipakai bersama di `packages/ai-tools`, migration per milestone, dan engine/kunci dicek sebelum `begin_ask` (F-134–F-137). |
| D-96 | Hasil review 6b M1-harness + M4: Q-132 s/d Q-138 | Pemilik proyek menerima usulan default (`docs/08-ai-integration.md` §20.5). W18 juga memetakan ulang harga member saat program yang menempel bukan milik toko baru (kembali ke catatan jika tidak ada padanan), pilihan member user di patch yang sama menang (F-151). Matching screenshot memakai nama produk (`raw_text`) dulu dan judul listing sebagai cadangan, dikerjakan di M3 dan diukur di masa kalibrasi (F-154). Pra-isi anotasi dan subset latensi dijalankan realtime (harga penuh; perkiraan uji ±US$26 + iterasi dev, batas keras tetap US$75) (F-158). `custom_id` batch `<slug>__<id>__r<n>` dan mode `run` default `both` (F-148). Field keluaran baru R18/R20 `nullish`, UI kembali ke perilaku lama untuk cache tanpa field, buster cache tidak dinaikkan (F-150). M4 dikerjakan sebelum M2–M3; M2 dimulai setelah D-16 (F-149). Pemilik proyek menjalankan `test:live` sekali sebelum `ocr-eval run`; harness tidak dijalankan sampai lulus (F-155). |
| D-97 | Hasil review 6b M2/M3 bagian tanpa D-16: Q-139 s/d Q-142 | Pemilik proyek menerima usulan default (`docs/08-ai-integration.md` §21.5). Biaya tier 4 (token + biaya) dijumlahkan ke `processing_run` lewat `record_run_output` kedua, rincian per panggilan hanya di log `ai.match`, tanpa kolom baru; kolom terpisah ditinjau di M6 jika perlu (F-159). Gerbang anggaran AI harian berlaku untuk semua extractor termasuk `stub` (satu anggaran global, §12.3); dev memakai `AI_DAILY_BUDGET_USD` (F-162). Versi prompt matcher terpisah (`match.v1`, `MATCH_PROMPT_VERSION`), dicatat di log `ai.match`, bukan di `processing_run.prompt_version` (F-165). Teks privasi "Pembacaan oleh AI" di `/saya/privasi` dipakai sekarang (Anthropic untuk foto dan Tanya); vendor OCR disebut di sana sebelum dipakai, teks diperbarui sebelum `ocr+parse` dipakai (F-166). |
| D-98 | Hasil review 6b M2 (B1–B3): Q-143 s/d Q-146 | Pemilik proyek menerima usulan default (`docs/08-ai-integration.md` §22.5). Worker membaca kunci Anthropic dari `WORKER_ANTHROPIC_API_KEY`, terpisah dari `ANTHROPIC_API_KEY` web; harness `ocr-eval` dan `test:live` tetap membaca `ANTHROPIC_API_KEY` di shell, diganti di Tahap 7 jika kunci per lingkungan dibuat (F-167). Kunci dan model diperiksa saat worker start (`GET /v1/models/{model}`); kunci yang dicabut saat worker berjalan tetap membuat capture gagal setelah 3 percobaan, jeda claim otomatis setelah `ai.config_error` ditinjau di Tahap 7 (F-170). Selama masa kalibrasi (τ = 1,01) semua field dan saran tampil "ragu", tanpa perubahan UI (F-172). `calibration_started_on` diubah pemilik proyek lewat SQL ke tanggal worker sungguhan pertama kali memproses foto asli (F-173). Keputusan D-16 dicatat sebagai D-99. |
| D-100 | Mode pribadi tanpa anggaran AI: Q-147 s/d Q-150 | Pemilik proyek menerima usulan default (`docs/08-ai-integration.md` §23). Selama pemakainya hanya pemilik proyek dan belum ada anggaran, foto struk/label/screenshot di app dimatikan lewat saklar build-time `NEXT_PUBLIC_PHOTO_CAPTURE` (default mati; kode foto tetap ada dan diuji di CI dengan `on`). Struk dibaca di Gemini di luar app dengan prompt tetap, lalu JSON jawabannya ditempel di S-21 `/tempel` (`capture.source = 'text'`); worker membacanya tanpa AI (`TextExtractor`, biaya 0) dan struk masuk matching tier 1–3 + konfirmasi S-10 seperti foto. Worker `EXTRACTOR=off` (hanya mengklaim capture teks) dan `AI_MATCHER=off`; Tanya `ASK_ENGINE=off`. Hanya struk (Q-147); scan barcode tetap aktif (Q-148); tempelan yang tidak sesuai format ditolak di layar dan diperiksa ulang worker (Q-149); teks tempelan dihapus otomatis 12 bulan setelah unggah (Q-150). Uji OCR D-16 dan pemasangan extractor sungguhan ditunda sampai ada anggaran; menyalakan foto lagi cukup lewat env. D-99 tetap dicadangkan untuk D-16. |
---

## 9. Asumsi

1. Target pasar Indonesia, mata uang IDR, toko lokal.
2. Struk mayoritas dari minimarket dan supermarket, bukan restoran.
3. Penggunaan utama di HP (memotret di toko), jadi aplikasi mobile-first.
4. Harga normal tidak selalu tercetak di struk; kadang hanya harga akhir.
5. Claude vision adalah kandidat kuat pengganti OCR terpisah, tapi belum terbukti (lihat D-16).

---

## 10. Edge Case yang Perlu Didukung

**Struk:** baris non-produk, baris diskon di bawah item, void/refund, kuantitas ("2 × 19.500"), struk panjang multi-gambar, struk pudar atau miring, tanggal transaksi ≠ tanggal upload.

**Barcode:** satu produk banyak barcode, shrinkflation, barcode internal toko (PLU) untuk produk timbang.

**Label harga:** tidak ada info cabang, dua harga dalam satu label (normal + promo/member), periode promo, label salah tempel.

**Marketplace:** harga belum termasuk ongkir dan voucher, barang berbeda dari judul listing.

**Toko:** hierarki grup (Alfamart vs Alfamidi), cabang tutup atau rebrand, harga zona per wilayah.

**Data:** koreksi data lama, merge dan split produk, struk duplikat.

---

## 11. Roadmap

| Tahap | Nama | Status |
|---|---|---|
| 1 | Requirement | ✅ Selesai |
| 2 | Database Design | ✅ Selesai ([domain model](docs/02-domain-model.md), [desain fisik](docs/03-database-design.md), [skema](db/schema.sql)) |
| 3 | Wireframe | ✅ Selesai ([spesifikasi](docs/04-wireframe.md), [prototipe](docs/wireframes/index.html)) |
| 4 | Backend | ✅ Selesai ([desain backend](docs/05-backend-design.md), [menjalankan lokal](docs/06-local-dev.md)) |
| 5 | Frontend | 🔄 5a disetujui ([desain frontend](docs/07-frontend-design.md)); 5b M0 selesai dan disetujui (D-84); M1 selesai, Q-68–Q-71 → D-85 ([hasil M1](docs/07-frontend-design.md#15-tahap-5b-m1-hasil-dan-temuan-baru-f-31-dst)); M2 selesai dan disetujui, Q-72–Q-75 → D-86 ([hasil M2](docs/07-frontend-design.md#16-tahap-5b-m2-hasil-dan-temuan-baru-f-40-dst)); M3 selesai dan disetujui, Q-76–Q-79 → D-87 ([hasil M3](docs/07-frontend-design.md#17-tahap-5b-m3-hasil-dan-temuan-baru-f-49-dst)); M4 selesai dan disetujui, Q-80–Q-84 → D-88 ([hasil M4](docs/07-frontend-design.md#18-tahap-5b-m4-hasil-dan-temuan-baru-f-60-dst)); M5 selesai dan disetujui, Q-85–Q-88 → D-89 ([hasil M5](docs/07-frontend-design.md#19-tahap-5b-m5-hasil-dan-temuan-baru-f-68-dst)); M6 selesai dan disetujui, Q-89–Q-92 → D-90 ([hasil M6](docs/07-frontend-design.md#110-tahap-5b-m6-hasil-dan-temuan-baru-f-80-dst)); M7 selesai dan disetujui, Q-93–Q-101 → D-91 ([hasil M7](docs/07-frontend-design.md#111-tahap-5b-m7-hasil-dan-temuan-baru-f-92-dst)) |
| 6 | AI Integration (termasuk uji OCR, D-16) | 🔄 6a disetujui, Q-102–Q-119 → D-92 ([desain AI](docs/08-ai-integration.md)); 6b dibagi M0–M6 (§14); M0 selesai dan disetujui, Q-120–Q-126 → D-93, D-94 ([hasil M0](docs/08-ai-integration.md#18-tahap-6b-m0-hasil-dan-temuan-baru-f-123-dst)); M5 (Tanya) selesai dan disetujui, Q-127–Q-131 → D-95, uji live set emas menunggu pemilik proyek ([hasil M5](docs/08-ai-integration.md#19-tahap-6b-m5-hasil-dan-temuan-baru-f-134-dst)); M1-harness + M4 selesai dan disetujui, Q-132–Q-138 → D-96 ([hasil](docs/08-ai-integration.md#20-tahap-6b-m1-harness--m4-hasil-dan-temuan-baru-f-148-dst)); M2/M3 bagian tanpa D-16 selesai dan disetujui, Q-139–Q-142 → D-97 ([hasil](docs/08-ai-integration.md#21-tahap-6b-m2m3-bagian-tanpa-d-16-hasil-dan-temuan-baru-f-159-dst)); M2 (pemasangan lewat env, uji §5.4, masa kalibrasi) selesai dan disetujui, Q-143–Q-146 → D-98 ([hasil](docs/08-ai-integration.md#22-tahap-6b-d-16--m2-hasil-dan-temuan-baru-f-167-dst)); uji OCR D-16 menunggu foto dan anotasi pemilik proyek; sampai ada anggaran: mode pribadi tanpa AI, foto dimatikan dan struk ditempel dari Gemini, Q-147–Q-150 → D-100 ([§23](docs/08-ai-integration.md#23-struk-tempelan-dari-gemini-mode-pribadi-tanpa-anggaran-ai-d-100)) |
| 7 | Production | — |

### Cara Kerja Tim

Untuk setiap tahap: analisis requirement → cari potensi masalah → beri rekomendasi → diskusikan trade-off → **tunggu persetujuan** → baru lanjut.
