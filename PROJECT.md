# Price Intelligence — Project Brief

> Dokumen sumber utama (single source of truth) untuk requirement dan keputusan produk.
> Setiap perubahan requirement harus didiskusikan dulu, lalu dicatat di **Decision Log**.

| | |
|---|---|
| Nama sementara | Price Intelligence (repo: PriceAtlas) |
| Status | Tahap 4b (implementasi backend) draft, menunggu review |
| Terakhir diperbarui | 2026-10-19 |

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
| OCR | Belum ditentukan. Lihat D-16. |
| Analytics DB | Belum memakai ClickHouse |

---

## 3. Sumber Data

1. Foto struk → **Purchase** (barang dibeli)
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
| 4 | Backend | 🔄 4b draft ([desain backend](docs/05-backend-design.md), [pertanyaan 4b](docs/05-backend-design.md#10-tahap-4b--implementasi-penyimpangan-dan-pertanyaan), [menjalankan lokal](docs/06-local-dev.md)) |
| 5 | Frontend | — |
| 6 | AI Integration (termasuk uji OCR, D-16) | — |
| 7 | Production | — |

### Cara Kerja Tim

Untuk setiap tahap: analisis requirement → cari potensi masalah → beri rekomendasi → diskusikan trade-off → **tunggu persetujuan** → baru lanjut.
