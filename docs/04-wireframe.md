# Tahap 3 — Wireframe

> Status: **Draft (2026-10-19). Menunggu review.**
> Dasar: `PROJECT.md` (D-01 s/d D-46), `docs/02-domain-model.md`, `docs/03-database-design.md`, `db/schema.sql`.
> Prototipe yang bisa diklik: [`docs/wireframes/index.html`](wireframes/index.html). Buka langsung di browser HP, tanpa build.

Dokumen ini tidak mengubah requirement, keputusan, maupun skema. Setiap celah ditulis sebagai pertanyaan (bagian 9) atau kandidat perubahan skema (bagian 8.3).

Penomoran **U-xx** di dokumen ini adalah usulan UX Tahap 3. Penomoran ini terpisah dari U-01 s/d U-04 di Tahap 2a, yang sudah menjadi D-22 s/d D-25. Pertanyaan diberi kode **W-xx**.

---

## Daftar Isi

1. [Ringkasan](#1-ringkasan)
2. [Analisis dan Potensi Masalah](#2-analisis-dan-potensi-masalah)
3. [Daftar Layar](#3-daftar-layar)
4. [Peta Navigasi](#4-peta-navigasi)
5. [Pola Global](#5-pola-global)
6. [Spesifikasi per Layar](#6-spesifikasi-per-layar)
7. [Keputusan UX yang Diusulkan (U-xx)](#7-keputusan-ux-yang-diusulkan-u-xx)
8. [Uji Telusur](#8-uji-telusur)
9. [Pertanyaan untuk Didiskusikan](#9-pertanyaan-untuk-didiskusikan)
10. [Alur yang Belum Bisa Dirancang Penuh](#10-alur-yang-belum-bisa-dirancang-penuh)

---

## 1. Ringkasan

**Prinsip yang dipegang setiap layar:** *bantu user memutuskan murah atau mahal SEBELUM membeli.* Karena itu:

- Layar pertama adalah **pencarian**, bukan daftar pengeluaran. Tidak ada total belanja bulanan, grafik pengeluaran, atau kategori anggaran di mana pun.
- Struk diperlakukan sebagai **sumber histori harga**, bukan catatan pengeluaran. Setelah dikonfirmasi, yang ditonjolkan adalah "12 harga baru tersimpan", bukan "Total belanja Rp185.900".
- Angka yang paling besar di layar selalu **harga terbaik** dan **harga per satuan**, karena dua angka itulah yang dipakai untuk membandingkan.

**Ringkasan rancangan:**

| | |
|---|---|
| Jumlah layar | 27 (termasuk 3 *sheet*/dialog) |
| Alur inti (cari → jawaban) | 1 ketukan + mengetik. Hasil search langsung menjawab 4 dari 6 pertanyaan inti. |
| Navigasi | 4 tab bawah + tombol kamera di tengah (U-01) |
| Usulan UX | 22 (U-01 s/d U-22) |
| Pertanyaan | 6 blocking untuk Tahap 4, 18 non-blocking |
| Kandidat perubahan skema | 13 (bagian 8.3), 4 di antaranya blocking |

**Cara membaca prototipe:**

- Bilah atas (di luar "layar HP") berisi: menu layar, pilihan **keadaan** (state) untuk layar itu, tombol **Peta data** (menampilkan `tabel.kolom` di samping setiap data), dan **Sesi aktif** (mensimulasikan sesi belanja yang sedang berjalan di semua layar).
- Semua elemen grayscale dan kotak. Teks seperti `[foto]` atau kotak bergaris adalah placeholder.

---

## 2. Analisis dan Potensi Masalah

Temuan saat merancang alur. Temuan yang menyentuh skema atau keputusan **tidak diputuskan di sini**. Semuanya diteruskan ke bagian 9.

| # | Temuan | Dampak ke UI | Ke |
|---|---|---|---|
| T-1 | **Item observasi yang confidence-nya rendah tidak punya tempat penampungan.** Untuk struk, kandidat ada di `receipt_line.suggested_product_id`. Untuk label dan screenshot, satu-satunya tempat adalah `price_record`, yang wajib punya `product_id` dan langsung ikut ringkasan. Pilihan lainnya hanya `processing_run.raw_ai_output`, tetapi kolom ini tidak terstruktur dan nanti disamarkan (D-32). | Halaman konfirmasi label/screenshot (S-11) belum punya sumber data. | W-01 |
| T-2 | **`receipt.store_id` NOT NULL, dan tidak ada confidence di level header.** Struk yang tokonya gagal dikenali tidak bisa disimpan sebagai draft. UI juga tidak tahu field header mana (toko, tanggal, total) yang meragukan. | S-10 tidak bisa menandai "tanggal ini meragukan", dan tidak bisa menampilkan struk yang tokonya belum dikenali. | W-02 |
| T-3 | **Ambang "confidence rendah" (D-12) tidak ada di `app.config`.** | Penentuan item mana yang masuk "Perlu dicek" belum punya parameter. | W-03 |
| T-4 | **Opt-in berbagi publik tidak punya tempat penyimpanan di level household.** Yang ada hanya `price_record.visibility` per record. Belum jelas juga apakah opt-in berlaku surut. | Toggle di S-19c tidak punya kolom. Efek ke data lama belum terdefinisi. | W-04 |
| T-5 | **Definisi tren tidak seragam.** Ringkasan memakai 30 hari terakhir vs 30 hari sebelumnya (D-44). Query §9 no. 3 di desain fisik memakai bulan kalender. Pertanyaan inti berbunyi "dibanding bulan lalu". | Label tren harus jujur. UI memakai "vs 30 hari sebelumnya", bukan "vs bulan lalu". | W-07 |
| T-6 | **`product.search_text` tidak memuat nama brand.** Pencarian "nestle" tidak menemukan Milo. Query §9 no. 1 juga memakai *inner join* ke `price_summary`, jadi produk tanpa histori tidak pernah muncul di hasil search. | Search tidak bisa menampilkan produk katalog yang belum punya harga ("Belum ada data harga"). | W-06 |
| T-7 | **Harga member hanya bisa disimpan jika programnya ada di katalog.** `member_program` hanya bisa ditulis sistem, dan `member_price` wajib menyebut `member_program_id`. | Label "Harga Member Alfagift" untuk program yang belum di-seed tidak bisa disimpan sebagai harga member. | W-05 |
| T-8 | **Struk duplikat bisa lolos lewat auto-save.** D-12 menyimpan item confidence tinggi secara otomatis, sedangkan D-20 meminta user memilih sendiri jika struk duplikat. | Struk yang terdeteksi duplikat harus dipaksa masuk `needs_confirmation`. Ini perilaku backend, bukan perubahan aturan. | U-10 |
| T-9 | **Merge beda ukuran merusak harga per satuan.** `merge_product` memindahkan record, lalu trigger menghitung ulang `unit_price` dengan ukuran produk target. Jika Milo 200g di-merge ke Milo 500g, semua harga 200g ikut dibagi 500. | Layar merge wajib memperingatkan jika ukurannya berbeda. | U-16 |
| T-10 | **Query §9 no. 6 ("lebih hemat di mana" per group) tidak memfilter dimensi dan mata uang.** | Untuk MVP aman, karena group biasanya satu dimensi. Perlu dicatat untuk Tahap 4. | Catatan 8.4 |
| T-11 | **Data publik (`public_price_fact`) dikumpulkan, tetapi tidak ada requirement tentang siapa yang membacanya.** | Keadaan awal (histori kosong) tidak bisa memakai data publik, kecuali diputuskan lain. | W-09 |
| T-12 | **Toko di supermarket basement sering tanpa sinyal.** Ini tidak disebut di requirement, tetapi konsisten dengan asumsi §9.3. | Foto harus bisa diambil saat offline dan diunggah belakangan. | U-17 |

---

## 3. Daftar Layar

| ID | Layar | Alur | Jenis |
|---|---|---|---|
| S-00a | Masuk | 8 | Layar |
| S-00b | Selamat datang | 8 | Layar |
| S-00c | Program member (onboarding) | 8, 7 | Layar (memakai ulang S-19b) |
| S-01 | Beranda / Cari | 1, 8 | Tab |
| S-02 | Hasil cari | 1 | Layar |
| S-03 | Detail produk | 2 | Layar |
| S-03b | Cek harga rak | 1, 2 | Sheet |
| S-04 | Bandingkan ukuran (Product Group) | 2 | Layar |
| S-05 | Lebih hemat di mana | 2 | Layar |
| S-06 | Pilih jenis foto | 3, 4, 5 | Sheet |
| S-07 | Kamera | 3, 4, 5 | Layar penuh |
| S-07b | Pilih dari galeri | 3, 5 | Dialog |
| S-08 | Unggahan | 3 | Tab |
| S-09 | Detail unggahan (status) | 3 | Layar |
| S-10 | Konfirmasi / detail struk | 3, 6 | Layar |
| S-11 | Konfirmasi label & screenshot | 4, 5 | Layar |
| S-12 | Pilih toko & cabang | 4, 3, 5 | Layar |
| S-13 | Sesi belanja | 4 | Tab |
| S-14 | Pilih produk | 3, 6 | Layar |
| S-15 | Produk baru | 3, 6 | Layar |
| S-16 | Detail & koreksi harga | 6 | Layar |
| S-17 | Gabungkan produk | 6 | Layar |
| S-18 | Pisahkan produk | 6 | Layar |
| S-19 | Saya (pengaturan) | 7 | Tab |
| S-19b | Program member | 7 | Layar |
| S-19c | Berbagi harga publik | 7 | Layar |
| S-20 | Tanya | 1 (opsional) | Layar |

---

## 4. Peta Navigasi

```
                      ┌─────────────────── pertama kali ───────────────────┐
                      │  S-00a Masuk → S-00b Selamat datang → S-00c Member │
                      └───────────────────────────┬────────────────────────┘
                                                  ▼
 Tab bar   ┌──────────┬────────────┬──────────────┬────────────┬──────────┐
 (bawah)   │ Cari     │ Unggahan(•)│   ( 📷 )     │ Belanja    │ Saya     │
           │ S-01     │ S-08       │   S-06 sheet │ S-12/S-13  │ S-19     │
           └────┬─────┴─────┬──────┴──────┬───────┴─────┬──────┴────┬─────┘
                │           │             │             │           │
  ALUR 1–2      │           │             │             │           ├─> S-19b Program member
  S-01 ─ketik─> S-02 Hasil cari           │             │           └─> S-19c Berbagi publik
                │  ├─tap kartu────────> S-03 Detail produk
                │  │                      ├─"Cek harga rak"──> S-03b (sheet)
                │  │                      ├─"Bandingkan ukuran"──> S-04 ─tap SKU─> S-03
                │  │                      ├─"Lebih hemat di mana"──> S-05
                │  │                      ├─tap baris histori──> S-16 Detail & koreksi
                │  │                      └─menu ⋯ ──> S-17 Gabungkan │ S-18 Pisahkan
                │  ├─"Bandingkan ukuran" di header group──> S-04
                │  ├─ikon barcode──> S-07 (mode scan, U-22) ──> S-03
                │  └─baris "Tanya: …"──> S-20 Tanya ─tap sumber─> S-03 / S-04 / S-05
                │
  ALUR 3        │  S-06 ─"Struk"──> S-07 (multi-bagian) ──Selesai──> kembali + toast
                │      └─"Dari galeri"──> S-07b ──> S-08
                │  S-08 Unggahan ─tap──> S-09 Status
                │      ├─ needs_confirmation ──> S-10 (struk) │ S-11 (label/screenshot)
                │      └─ failed ──> S-09 (ulangi / hapus)
                │  S-10 ─"Ganti produk"──> S-14 ─"Tidak ada"──> S-15
                │
  ALUR 4        │  S-13 ─"Mulai belanja"──> S-12 (mode sesi) ──> S-13 aktif
                │      └─tombol kamera besar──> S-07 (label) ──> S-13 (kartu hasil)
                │  Tanpa sesi: S-06 "Label" ──> S-12 (mode manual / "cabang tidak tahu")
                │
  ALUR 5        │  S-06 "Screenshot" ──> S-07b ──> S-08 ──> S-11 (mode marketplace)
                │
  ALUR 6        │  S-03 / S-10 / S-11 ──> S-16 ──"Ganti produk"──> S-14
                │  S-03 ⋯ ──> S-17 (privat saja) ──> S-14 (target) ──> pratinjau
                │  S-03 ⋯ ──> S-18 ──> S-15 (produk baru) ──> pilih record
```

**Jangkauan ketukan dari tab Cari:**

| Tujuan | Ketukan |
|---|---|
| Harga terbaik, toko/cabang, tanggal, per satuan, tren | 1 (fokus search) + mengetik |
| Bandingkan ukuran | +1 dari hasil search |
| Lebih hemat di mana | +2 dari hasil search (kartu → bagian di detail) |
| Mulai foto struk | 1 (tombol kamera) + 1 (Struk) |
| Foto label saat sesi aktif | 1 (tombol di banner sesi) |

---

## 5. Pola Global

### 5.1 Zona jempol

```
┌───────────────────────┐
│  judul / kembali      │  ← zona sulit: hanya info, bukan aksi utama
│                       │
│  konten               │  ← zona sedang: scroll, tap kartu
│                       │
│ [banner sesi aktif]   │  ← zona mudah
│ [ search / aksi utama]│  ← zona mudah
│ Cari Ungg (📷) Bel Saya│  ← zona mudah
└───────────────────────┘
```

Aturannya: **aksi utama selalu di sepertiga bawah layar.** Tombol kembali tetap di kiri atas karena itu konvensi, tetapi gesture usap ke kanan juga didukung.

### 5.2 Label harga (konsisten di semua layar)

| Label | Arti | Sumber |
|---|---|---|
| `PROMO` | `price_basis = 'promo'` | D-02 |
| `NORMAL` | `price_basis = 'normal'` | D-02 |
| `MEMBER · AEON Member` | `price_basis = 'member'` + `member_program.name` | D-10 |
| `MEMBER · tidak dihitung` | `member_price` terisi tetapi `price_basis ≠ 'member'` | D-27 |
| `BUNDLE · tidak dihitung` | `is_bundle = true` | D-08 |
| `PROMO 2+` | `promo_min_qty` terisi | D-34 |
| `cabang tidak diketahui` | `branch_id IS NULL` | D-28 |
| `PRIBADI` | `product.household_id IS NOT NULL` (juga untuk store/branch) | D-03, D-29 |
| `(tutup)` | `branch.status = 'closed'` | §5.6 |

Wireframe grayscale, jadi label tidak boleh bergantung pada warna (U-15). Di Tahap 5 pun, warna hanya boleh memperkuat teks.

### 5.3 Format angka

- Rupiah: `Rp19.500`. Titik sebagai pemisah ribuan, tanpa desimal untuk harga.
- Harga per satuan: `Rp97,5/g`. Koma desimal, maksimal 1 desimal (2 jika di bawah Rp1). Satuan dasar sesuai dimensi (g, ml, pcs, m). Lihat U-20.
- Produk timbang: harga utama `Rp45.000/kg` (`effective_price` per `content_unit`), dengan harga per satuan dasar sebagai info kedua.
- Tanggal: relatif jika kurang dari 7 hari ("3 hari lalu"), selain itu `12 Okt 2026`. Selalu **tanggal transaksi** (§5.4).

### 5.4 Notasi peta data

| Notasi | Arti |
|---|---|
| `tabel.kolom` | Diambil langsung dari kolom di `db/schema.sql` |
| **ƒ** | Turunan: dihitung di query atau di klien dari kolom yang ada |
| **⛔** | **Tidak ada di skema.** Kandidat perubahan. Lihat bagian 8.3. |
| **💾** | Disimpan di perangkat (localStorage/IndexedDB), tidak perlu skema |

### 5.5 Keadaan standar

Setiap layar memakai pola yang sama untuk keadaan umum:

| Keadaan | Pola |
|---|---|
| Memuat | Kerangka abu-abu (skeleton) dengan bentuk seperti konten aslinya. Tanpa spinner di tengah layar. |
| Kosong | Satu kalimat tentang apa yang akan muncul di sini, plus satu aksi utama. |
| Gagal (jaringan) | Pesan singkat + tombol "Coba lagi". Konten terakhir yang sempat dimuat tetap tampil. |
| Offline | Strip tipis di atas: "Offline. Foto tetap tersimpan dan diunggah otomatis." |
| Sedang diperbarui | Teks kecil "Ringkasan sedang diperbarui…" saat `price_summary.refreshed_at` lebih lama dari perubahan terakhir user (antrean D-31). |

### 5.6 Banner sesi belanja

Saat ada `shopping_session` aktif (`ended_at IS NULL` dan `expires_at > now()`), banner tipis muncul **di atas tab bar** di semua layar:

```
● Belanja di AEON BSD · 1j 12m · 4 label        [📷 Foto label]
```

Tombol di banner langsung membuka kamera label. Ini membuat foto label cukup **1 ketukan** dari layar mana pun (U-13).

---

## 6. Spesifikasi per Layar

Format setiap layar: **Tujuan**, **Data**, **Aksi**, **Keadaan**, **Satu tangan**.

### S-00a Masuk

- **Tujuan:** masuk atau daftar. Pertanyaan user: *"Bagaimana cara mulai?"*
- **Data:** tidak ada. Signup membuat `profile`, `household`, dan `household_member` (trigger `on_auth_user_created`).
- **Aksi utama:** "Lanjut dengan email" (kode OTP). **Sekunder:** "Lanjut dengan Google". Metode final: W-17.
- **Keadaan:** memasukkan email → menunggu kode → kode salah → gagal jaringan.
- **Satu tangan:** field dan tombol di setengah bawah layar.

### S-00b Selamat datang

- **Tujuan:** menjelaskan nilai produk dalam satu layar. Pertanyaan user: *"Aplikasi ini untuk apa?"*
- **Isi:** "Cek dulu sebelum beli. Foto struk dan label harga, lalu lihat apakah harga di depanmu murah atau mahal **menurut histori belanjamu sendiri**." Ditambah tiga poin: harga terbaik 90 hari, harga per gram, toko termurah.
- **Data:** tidak ada.
- **Aksi utama:** "Mulai". **Sekunder:** "Lewati".
- **Keadaan:** tunggal. Status "sudah dilihat" 💾.

### S-00c Program member (onboarding)

Sama dengan S-19b, tetapi dengan judul "Kamu member di mana?" dan tombol "Lewati". Alasan ditanyakan di awal: keanggotaan menentukan apakah harga member dihitung (D-27), dan bergabung belakangan tidak menghitung ulang data lama (D-41).

### S-01 Beranda / Cari

- **Tujuan:** titik awal alur inti. Pertanyaan user: *"Barang ini biasanya berapa?"*
- **Data:**

| Elemen | Sumber |
|---|---|
| Kolom search (di bawah, U-02) | — |
| Pencarian terakhir | 💾 |
| "Baru dicek" (5 produk terakhir dibuka) | 💾 daftar `product.id`, isinya dari `price_summary` |
| "Harga baru masuk" (record terbaru) | `price_record` (`price_record_recent_idx`): `transaction_date`, `product_id`, `effective_price`, `price_basis`, `store_id` |
| Badge "3 perlu dicek" | ƒ hitung `capture` dengan `status = 'needs_confirmation'` |
| Banner sesi | `shopping_session` aktif + `branch.name` + `store.name` |

- **Aksi utama:** mengetik di search. **Sekunder:** scan barcode (U-22), tap pencarian terakhir, tap badge "perlu dicek" → S-08.
- **Keadaan:**
  - **Kosong (pengguna baru, U-19):** tidak ada histori. Tiga kartu ajakan: (1) "Foto struk belanja terakhirmu", cara tercepat mengisi histori. (2) "Lagi di toko? Mulai sesi belanja". (3) "Coba cari produk". Teks: "Histori harga masih kosong. Setiap struk yang kamu foto menambah data pembanding."
  - **Normal:** pencarian terakhir + baru dicek + harga baru masuk.
  - **Sesi aktif:** banner sesi + kartu "Label di sesi ini".
  - **Offline:** strip offline. Pencarian hanya terhadap produk yang tersimpan di cache 💾 (W-22).
  - **Memuat:** skeleton untuk bagian "harga baru masuk".
- **Satu tangan:** kolom search menempel di atas tab bar. Keyboard yang muncul tidak menutupi hasil, karena hasil tampil di atas kolom.

### S-02 Hasil cari

- **Tujuan:** menjawab pertanyaan inti **tanpa membuka detail** (§7). Pertanyaan user: *"Berapa termurah, di mana, kapan, per gram berapa, naik atau turun?"*
- **Struktur (U-03):** hasil dikelompokkan per Product Group. Header group menampilkan "Paling hemat per gram: 500g". Setiap SKU berupa satu kartu.

```
┌ Milo Original ·················· [Bandingkan ukuran ›] ┐
│  Paling hemat per gram: 500g (Rp91,8/g)                │
├─────────────────────────────────────────────────────────┤
│ Milo Original 200g                         ↓ 4% turun   │
│ Rp19.500  PROMO        Rp97,5/g                        │
│ AEON · BSD City · 12 Okt                                │
│ Termurah sepanjang masa: Rp18.900 NORMAL · Alfamart ·   │
│   Mar 2026                                              │
│ 9 data · terakhir 3 hari lalu                           │
└─────────────────────────────────────────────────────────┘
```

- **Data per kartu:**

| Elemen | Sumber |
|---|---|
| Nama, varian | `product.name`, `product.variant` |
| Ukuran | `product.pack_count`, `content_size`, `content_unit` → `unit.code` |
| Badge PRIBADI | ƒ `product.household_id IS NOT NULL` |
| Header group | `product_group.name` (via `product.product_group_id`) |
| "Paling hemat per gram" | ƒ min `price_summary.best_90d_unit_price` dalam group, dimensi sama (`unit.dimension`) |
| Harga terbaik 90 hari | `price_summary.best_90d_effective_price` |
| Label harga | `price_summary.best_90d_price_basis`. Untuk `member`, nama program: ƒ join `best_90d_record_id` → `price_record.member_program_id` → `member_program.name` |
| Harga per satuan | `price_summary.best_90d_unit_price` + ƒ satuan dasar dari `unit.dimension` |
| Toko · cabang | `best_90d_store_id` → `store.name`; `best_90d_branch_id` → `branch.name` (NULL → "cabang tidak diketahui") |
| Tanggal | `price_summary.best_90d_date` |
| All-time | `best_all_effective_price`, `best_all_price_basis`, `best_all_unit_price`, `best_all_date`, `best_all_store_id`, `best_all_branch_id` |
| Tren | `price_summary.trend_direction`, `trend_pct` |
| Jumlah data, data terakhir (D-15) | `price_summary.record_count`, `last_transaction_date` |
| Info toko online | `store.channel = 'online'` → teks kecil "belum termasuk ongkir" (D-36) |
| Petunjuk member tidak dihitung | ƒ query `price_record` (`member_price IS NOT NULL AND price_basis <> 'member'`) dalam 90 hari. **Tidak ada di `price_summary`** (X-07). |
| Petunjuk hanya bundle | ƒ query `price_record` (`is_bundle`). Produk tanpa record non-bundle tidak punya baris summary (X-07). |

- **Aksi utama:** tap kartu → S-03. **Sekunder:** "Bandingkan ukuran" di header group → S-04. Ikon "Cek harga rak" di kartu → S-03b. Baris terakhir "Tanya: *milo paling murah di mana?*" → S-20.
- **Keadaan:**

| Keadaan | Tampilan |
|---|---|
| Memuat | 3 kartu skeleton |
| Normal | Seperti di atas |
| **Tren belum cukup** (`trend_direction IS NULL`) | Ganti teks tren dengan "Tren: data belum cukup". Jumlah data dan tanggal terakhir **tetap** tampil (D-15). |
| **Tidak ada data 90 hari** (`best_90d_* IS NULL`) | Angka utama diganti "Belum ada harga 90 hari terakhir". All-time naik menjadi angka utama dengan teks "terakhir dicatat 5 bln lalu". |
| **Cabang tidak diketahui** | "Indomaret · cabang tidak diketahui" (D-28). Tetap ikut harga terbaik. |
| **Produk privat** | Badge `PRIBADI` di samping nama |
| **Harga member belum berlaku** | Baris kecil: "Ada harga member AEON Rp17.900 · tidak dihitung karena kamu belum terdaftar · [Atur]" (D-27) → S-19b |
| **Hanya bundle** | "Hanya ada 2 data bundle · tidak dipakai untuk harga terbaik" (D-08) |
| **Produk ada, histori kosong** | Kartu tipis: nama + "Belum ada data harga di historimu" + tombol "Cek harga rak". Butuh perubahan query (W-06). |
| Tidak ditemukan | "Tidak ada produk 'milo actv'. Coba kata lain, scan barcode, atau foto labelnya." + baris "Tanya: …" |
| Gagal | Pesan + "Coba lagi" |
| Offline | Hanya hasil dari cache 💾, diberi label "data tersimpan, mungkin tidak terbaru" |

- **Satu tangan:** kartu bisa di-tap di seluruh area. Tidak ada tombol kecil di pojok kanan atas.

### S-03 Detail produk

- **Tujuan:** pembuktian. Pertanyaan user: *"Kenapa ini dianggap termurah? Bagaimana riwayatnya? Ukuran mana yang lebih hemat? Di mana belinya?"*
- **Bagian (urut dari atas):**
  1. **Header:** nama, varian, ukuran, brand, kategori, badge `PRIBADI`.
  2. **Ringkasan:** harga terbaik 90 hari (besar), all-time, harga terakhir, tren + "9 data · terakhir 3 hari lalu".
  3. **Tombol "Cek harga rak"** (U-06), menempel di bawah layar.
  4. **Grafik** harga per satuan (titik per record, sumbu = tanggal transaksi). Toggle "Hanya harga normal" (D-33).
  5. **Lebih hemat di mana**: 3 toko teratas + "Lihat semua" → S-05.
  6. **Ukuran lain di group ini**: 1 baris per SKU + "Bandingkan" → S-04.
  7. **Histori**: semua record, terbaru di atas.
  8. Menu ⋯ (di bawah, bukan pojok kanan atas): Gabungkan (S-17), Pisahkan (S-18), Edit produk (jika privat → S-15).
- **Data:**

| Elemen | Sumber |
|---|---|
| Header | `product.*`, `brand.name`, `category.name`, `product_group.name` |
| Ringkasan | `price_summary.*` (sama dengan S-02) + `last_effective_price`, `last_unit_price`, `last_transaction_date` |
| Toko harga terakhir | ƒ dari record terbaru di `price_record` (tidak ada di summary, X-06) |
| Grafik | `price_record.transaction_date`, `unit_price` (aktif, non-bundle) |
| Grafik "hanya normal" | ƒ `normal_price ÷ ukuran produk`, dihitung saat query (§7.1 desain fisik) |
| Baris histori | `price_record.transaction_date`, `source_type` (ikon struk/label/screenshot), `store_id`, `branch_id`, `normal_price`, `promo_price`, `promo_min_qty`, `promo_valid_from/until`, `member_price` + `member_program.name`, `effective_price`, `price_basis`, `unit_price`, `quantity`, `actual_weight`, `is_bundle`, `status`, `extra` (ongkir/cashback) |
| Lebih hemat di mana (ringkas) | Query §9 no. 6, per produk |
| Ukuran lain | Query §9 no. 5 |

- **Aksi utama:** "Cek harga rak". **Sekunder:** tap baris histori → S-16. "Bandingkan ukuran" → S-04. "Lebih hemat di mana" → S-05. Menu ⋯.
- **Keadaan:**

| Keadaan | Tampilan |
|---|---|
| Memuat | Skeleton per bagian |
| Normal | Semua bagian |
| **Tren belum cukup** | Kotak tren: "Tren muncul setelah ada minimal 2 data di 30 hari terakhir **dan** 2 data di 30 hari sebelumnya." ƒ jumlah per jendela dihitung dari histori. Parameter D-44. |
| **Hanya all-time** | "Belum ada harga 90 hari terakhir" + all-time sebagai angka utama |
| **Belum ada data** (produk katalog, belum ada record) | Ringkasan diganti ajakan: "Foto label atau struk yang memuat produk ini." Tombol "Cek harga rak" tetap ada, tetapi hanya menghitung harga per satuan, tanpa perbandingan. |
| **Produk privat** | Badge `PRIBADI`. Menu: Edit, Gabungkan, Pisahkan, Hapus. |
| **Produk global** | Tanpa badge. Menu: Pisahkan saja. "Gabungkan" tampil nonaktif dengan teks "Produk katalog umum hanya bisa digabung oleh kurator" (D-30). |
| **Produk sudah digabung** (`status = 'merged'`) | Alih otomatis ke `merged_into_id`, dengan toast "Milo 200 gr sudah digabung ke Milo Original 200g". |
| **Baris bundle** | Diberi tag `BUNDLE · tidak dihitung`, warna teks lebih pudar. Tidak muncul di grafik. |
| **Baris member belum berlaku** | Tag `MEMBER Rp17.900 · tidak dihitung`. Harga efektif yang dipakai ditampilkan di sebelahnya. |
| **Baris cabang tidak diketahui** | "Indomaret · cabang tidak diketahui" |
| **Baris void** | Disembunyikan secara default. Toggle "Tampilkan yang dibatalkan". |
| **Ringkasan sedang diperbarui** | Teks kecil di bawah ringkasan (pola 5.5) |
| **Produk timbang** | Harga utama `Rp45.000/kg`. Baris histori: "0,535 kg · Rp24.075". |

- **Satu tangan:** "Cek harga rak" menempel di bawah. Menu ⋯ dibuka dari tombol di bawah, bukan pojok kanan atas.

### S-03b Cek harga rak (sheet)

- **Tujuan:** inti prinsip produk. User berdiri di depan rak, melihat label Rp21.900, lalu bertanya: *"Ini murah atau mahal buat saya?"*
- **Isi:** keypad angka (besar). Hasil langsung dihitung saat mengetik.

```
Harga di rak: Rp 21.900
→ Rp109,5/g
→ 12% lebih mahal dari termurahmu 90 hari (Rp19.500 PROMO · AEON BSD · 12 Okt)
→ 3% lebih mahal dari harga terakhir (Rp21.200 · Alfamart · 3 hari lalu)
→ Ukuran 500g di historimu: Rp91,8/g (16% lebih hemat per gram)
```

- **Data:** semua ƒ di klien dari `product` (ukuran) dan `price_summary` (`best_90d_unit_price`, `last_unit_price`, `best_all_unit_price`), ditambah summary SKU lain di group. **Tidak menyimpan apa pun** (U-06).
- **Aksi utama:** tidak ada. Hasilnya muncul langsung. **Sekunder:** "Foto labelnya untuk disimpan" → S-07 mode label. Tombol ini membuat harga yang dilihat masuk histori lewat jalur resmi (§3), tanpa sumber data baru.
- **Keadaan:**
  - **Lebih murah** dari termurah 90 hari: "Lebih murah dari semua harga di historimu 90 hari terakhir."
  - **Mendekati** (≤ 5%, W-08): "Mendekati harga terbaikmu."
  - **Lebih mahal**: persentase + harga pembanding.
  - **Belum ada data**: hanya harga per satuan, dengan teks "Belum ada pembanding di historimu."
  - **Produk timbang**: input berupa "harga per kg".
- **Satu tangan:** keypad memenuhi setengah bawah layar.

### S-04 Bandingkan ukuran

- **Tujuan:** pertanyaan inti no. 5. *"Apakah 500g lebih murah daripada 200g?"*
- **Isi:** daftar SKU dalam satu Product Group, diurutkan menurut harga per satuan terbaik 90 hari. Baris teratas diberi tanda "paling hemat". Selisih dalam persen terhadap baris teratas.

```
Milo Original                 per gram, harga terbaik 90 hari
1. 500 g     Rp45.900   Rp91,8/g   paling hemat   AEON BSD
2. 200 g     Rp19.500   Rp97,5/g   +6%            AEON BSD
   1 kg      belum ada harga di historimu
   Toggle: [90 hari] [sepanjang masa]
```

- **Data:** query §9 no. 5: `product.pack_count`, `content_size`, `content_unit`, `unit.dimension`, `price_summary.best_90d_unit_price`, `best_all_unit_price`, `best_90d_effective_price`, `best_90d_store_id`. "Harga per isi" untuk multipack: ƒ `effective_price ÷ pack_count` (§5.1).
- **Aksi utama:** tap SKU → S-03. **Sekunder:** toggle 90 hari / sepanjang masa.
- **Keadaan:**
  - Normal.
  - **Sebagian ukuran tanpa data:** baris "Belum ada harga", ditaruh paling bawah, tidak ikut peringkat.
  - **Dimensi berbeda:** dikelompokkan per dimensi, dengan teks "Tidak dibandingkan: satuan berbeda (ml vs g)" (§5.2).
  - **Mata uang berbeda:** dipisah, tidak dikonversi (domain model 2.6).
  - **Hanya satu ukuran:** "Baru ada satu ukuran di group ini."
  - **Ukuran lama (shrinkflation):** teks "data terakhir Mar 2026" di baris SKU lama, supaya user paham SKU itu mungkin sudah tidak dijual (D-18).
  - **Produk privat** dalam group global: badge `PRIBADI`.

### S-05 Lebih hemat di mana

- **Tujuan:** pertanyaan inti no. 6, per produk atau per Product Group (D-39).
- **Isi:** toggle `[Produk ini] [Semua ukuran (group)]` dan `[90 hari] [sepanjang masa]`. Daftar toko · cabang diurutkan menurut rata-rata harga per satuan, dengan angka termurah, rata-rata, jumlah data, dan tanggal terakhir.
- **Data:** query §9 no. 6: `price_record.store_id`, `branch_id`, ƒ `min(unit_price)`, `avg(unit_price)`, `count(*)`, ƒ `max(transaction_date)`; `store.name`, `store.channel`; `branch.name`, `branch.status`, `branch.successor_branch_id`.
- **Aksi utama:** membaca daftar. **Sekunder:** tap baris → S-03 dengan histori difilter ke toko itu.
- **Keadaan:**
  - Normal.
  - **Cabang tidak diketahui:** baris terpisah "Indomaret · cabang tidak diketahui".
  - **Toko online:** baris diberi teks "harga belum termasuk ongkir" (D-36).
  - **Cabang tutup:** "AEON Sentul (tutup) → AEON Sentul City" (`successor_branch_id`).
  - **Data sedikit:** baris dengan jumlah data 1 diberi teks "baru 1 data". Usulan: urutan tetap memakai rata-rata, tetapi ditampilkan apa adanya.
  - **Kosong:** "Belum ada histori 90 hari. Lihat sepanjang masa?"
- **Catatan:** Alfamart dan Alfamidi tampil sebagai toko terpisah (Store), bukan digabung per grup (§10). Di MVP, `store_group` tidak dipakai di layar ini.

### S-06 Pilih jenis foto (sheet)

- **Tujuan:** memilih jenis capture dengan sekali tap. *"Saya mau mencatat apa?"*
- **Isi (tombol besar, urutannya ditentukan konteks, U-08):**
  - **Struk** · "barang yang sudah dibeli"
  - **Label harga** · "harga di rak toko"
  - **Screenshot marketplace** · "Shopee, Tokopedia, dll."
  - Bawah: "Pilih dari galeri".
- **Data:** `capture.kind`. Jika sesi aktif: "Label harga akan masuk ke AEON BSD" (`shopping_session.branch_id`).
- **Keadaan:**
  - **Tanpa sesi:** urutan Struk, Label, Screenshot. Memilih "Label" menanyakan lokasi (S-12, mode manual).
  - **Sesi aktif:** Label paling atas dan sudah terpilih. Konteks sesi ditampilkan.
- **Satu tangan:** sheet muncul dari bawah, semua tombol di setengah bawah layar.

### S-07 Kamera

- **Tujuan:** memotret secepat mungkin dengan satu tangan.
- **Isi:** jendela bidik penuh. Semua kontrol berada di sepertiga bawah: tombol shutter besar di tengah, galeri di kiri, "Selesai" di kanan. Strip thumbnail di atas shutter.
- **Mode:**
  - **Struk:** "Struk panjang? Foto per bagian, lalu ketuk **Tambah bagian**." Setiap bagian menjadi satu `capture_image.position`.
  - **Label:** satu foto = satu capture. Kamera tetap terbuka setelah memotret ("Foto label berikutnya"), sehingga beberapa label bisa diambil berturut-turut dalam sesi.
  - **Scan barcode (U-22):** bingkai garis. Begitu terbaca, langsung ke S-03, atau ke S-14 jika barcode tidak dikenal.
- **Data yang dibuat:** `capture` (`kind`, `shopping_session_id`, `store_id`, `branch_id`, `uploaded_at`), `capture_image` (`position`, `storage_path`, `sha256`, `byte_size`). `sha256` dihitung di klien sebelum upload.
- **Keadaan:**
  - Membidik.
  - **Struk: 2 bagian sudah diambil.** Strip thumbnail "1 · 2 · [+]".
  - **Gambar duplikat (hash, D-20):** ƒ `capture_image.sha256` sama dengan unggahan sebelumnya. Dialog: "Foto ini sudah pernah diunggah pada 12 Okt (struk AEON BSD). [Lihat yang lama] [Tetap unggah]". User yang memilih (U-10).
  - **Offline (U-17):** "Foto disimpan di HP. Akan diunggah saat ada sinyal." Belum ada baris `capture`. Status ini hanya ada di klien 💾.
  - **Izin kamera ditolak:** penjelasan + "Pilih dari galeri".
  - **Panduan kualitas:** teks "Pastikan seluruh struk terlihat dan tidak terlipat". Deteksi buram di klien bersifat opsional (Tahap 5).
- **Setelah "Selesai":** kembali ke layar sebelumnya dengan toast "Struk diunggah. Kami kabari kalau perlu dicek." Tidak ada layar tunggu (U-11).

### S-07b Pilih dari galeri (dialog)

- **Tujuan:** menangani unggahan banyak gambar sekaligus (U-09).
- **Isi:** setelah memilih lebih dari 1 gambar: "5 gambar dipilih. Ini **5 struk berbeda** atau **1 struk panjang**?" Pilihan ketiga: "Atur sendiri" (gambar dikelompokkan dengan cara di-tap).
- **Data:** 5 baris `capture` dengan masing-masing 1 `capture_image`, **atau** 1 `capture` dengan 5 `capture_image`.
- **Untuk screenshot marketplace:** default "beberapa screenshot berbeda".

### S-08 Unggahan

- **Tujuan:** melihat status pemrosesan asinkron. *"Fotoku sudah diproses belum? Mana yang perlu saya cek?"*
- **Isi:** daftar capture terbaru, dengan bagian **Perlu dicek** selalu di atas.

```
PERLU DICEK (2)
[struk] AEON BSD · 12 Okt              3 item perlu dicek  ›
[label] Indomaret · hari ini           1 item perlu dicek  ›
SEDANG DIPROSES (1)
[struk] diunggah 2 menit lalu          Diproses…
SELESAI
[struk] Alfamart Pamulang · 10 Okt     14 harga tersimpan  ›
[ss]    Shopee · 9 Okt                 2 harga tersimpan   ›
GAGAL (1)
[struk] diunggah kemarin               Gambar tidak terbaca  [Ulangi]
```

- **Data:**

| Elemen | Sumber |
|---|---|
| Jenis, status | `capture.kind`, `capture.status` |
| Toko, cabang | `receipt.store_id/branch_id` (struk) atau `capture.store_id/branch_id`, atau via `shopping_session.branch_id` |
| Tanggal | `receipt.transaction_date` jika ada. Jika belum diproses, `capture.uploaded_at` dengan teks "diunggah …" |
| Jumlah perlu dicek | ƒ untuk struk: baris `receipt_line` produk tanpa `price_record`. Untuk label/screenshot: **⛔ belum ada sumber** (X-01). |
| Jumlah harga tersimpan | ƒ `count(price_record)` per `capture_id` |
| Alasan gagal | `capture.error_message` (teks bebas). Kategori alasan: **⛔** (X-08) |
| Antre di perangkat | 💾 |

- **Aksi utama:** tap item "Perlu dicek" → S-10 / S-11. **Sekunder:** "Ulangi" pada item gagal (membuat `processing_run` baru). Filter jenis.
- **Keadaan:**
  - Normal (campuran status).
  - **Kosong:** "Belum ada unggahan. Foto struk pertamamu untuk mulai mengisi histori." + tombol kamera.
  - **Memuat:** skeleton.
  - **Offline:** bagian paling atas "Menunggu sinyal (3)".
  - **Semua beres:** bagian "Perlu dicek" hilang. Teks "Semua sudah dicek".
- **Badge tab:** jumlah `needs_confirmation`.

### S-09 Detail unggahan

- **Tujuan:** melihat status satu capture beserta gambarnya. *"Kenapa yang ini belum selesai atau gagal?"*
- **Isi:** thumbnail gambar (bisa digeser), linimasa status, info jenis dan lokasi, serta aksi.
- **Data:** `capture.*`, `capture_image.position`, `storage_path`, `purged_at`; `processing_run.status`, `started_at`, `finished_at`, `error_message` (jumlah percobaan = ƒ `count(processing_run)`).
- **Keadaan (satu per status, §3):**

| Status | Tampilan | Aksi |
|---|---|---|
| `uploaded` | "Menunggu antrean" | Hapus |
| `processing` | "Sedang dibaca…" + bilah tak tentu | — (boleh ditinggal) |
| `needs_confirmation` | "3 item perlu dicek" | **Cek sekarang** → S-10 / S-11 |
| `done` | "14 harga tersimpan" + daftar ringkas | Lihat struk → S-10 (mode tersimpan) |
| `failed` | Alasan (`error_message`), percobaan ke-n | **Ulangi**, Foto ulang, Hapus |
| Gambar dihapus (retensi, D-32) | "Gambar dihapus setelah 12 bulan. Data harga tetap ada." | — |

### S-10 Konfirmasi / detail struk

- **Tujuan:** memastikan item yang confidence-nya rendah benar (D-12), dengan usaha seminimal mungkin. *"Barang yang dibaca sudah benar? Struk ini dobel?"*
- **Struktur (U-12):**

```
⚠ Mungkin duplikat: struk AEON BSD 12 Okt, total Rp185.900 sudah ada.
   [Lihat]  [Ini struk berbeda]  [Buang yang ini]

AEON · BSD City                       ✎
12 Okt 2026 · 14:32    (diunggah hari ini)
Total struk Rp185.900 · jumlah item Rp185.900 ✓

PERLU DICEK (3)
  "MILO ACT 200G"      → Milo Original 200g?  ragu
  1 × Rp22.900  diskon −3.400  = Rp19.500 PROMO
  [Benar]  [Ganti produk]  [Bukan produk]   ⋯ bundle

TERSIMPAN OTOMATIS (11)   ▸ (terlipat)
BUKAN PRODUK (2)          ▸ KANTONG PLASTIK, DONASI
VOUCHER & POIN            ▸ Voucher −Rp10.000 · Poin +185 (info, tidak mengurangi harga item)

[ Simpan 14 harga ]
```

- **Data:**

| Elemen | Sumber |
|---|---|
| Peringatan duplikat (sidik jari) | ƒ `receipt` lain dengan `household_id`, `store_id`, `transaction_date`, `total_amount` sama (`receipt_fingerprint_idx`) |
| Keputusan duplikat | "Buang" → `receipt.status = 'discarded'`, `duplicate_of_receipt_id`. "Berbeda" → lanjut. |
| Header | `receipt.store_id` → `store.name`, `branch_id` → `branch.name`, `transaction_date`, `transaction_time`, `total_amount`, `subtotal_amount`, `payment_method` |
| Field header yang meragukan | **⛔** tidak ada confidence per field (X-02) |
| Toko belum dikenali | **⛔** `receipt.store_id` NOT NULL (X-02) |
| Tanggal unggah | `capture.uploaded_at` |
| Cek total | ƒ `sum(receipt_line.line_amount)` vs `receipt.total_amount` (§5.7) |
| Baris | `receipt_line.line_no`, `line_type`, `raw_text`, `quantity`, `unit_amount`, `line_amount` |
| Diskon dan void menempel | `receipt_line.applies_to_line_id` |
| Saran produk | `receipt_line.suggested_product_id` → `product.*`, `match_tier`, `match_confidence` |
| Batas "ragu" | **⛔** ambang tidak ada di `app.config` (X-03) |
| Hasil per baris | `price_record` (`receipt_line_id`): `effective_price`, `price_basis`, `unit_price`, `is_bundle`, `match_outcome` |
| Alias baru | Saat "Benar" atau "Ganti": `product_alias` (`household_id`, `store_id`, `alias_text = raw_text`, `product_id`) (§5.9) |
| Voucher, cashback, poin | `receipt_adjustment.kind`, `amount`, `points`, `description` |
| PII | `receipt.pii` **tidak pernah ditampilkan**. Teks kecil: "Nomor kartu dan data pribadi di struk disamarkan." |

- **Aksi utama:** "Benar" per item. "Simpan N harga" menempel di bawah. **Sekunder:** "Benarkan semua saran" (untuk 3 item atau lebih), "Ganti produk" → S-14, "Bukan produk" (`line_type = 'non_product'`), tandai bundle, edit header (S-12 untuk toko/cabang, pemilih tanggal).
- **Keadaan:**

| Keadaan | Tampilan |
|---|---|
| Normal (ada yang perlu dicek) | Seperti di atas |
| **Kemungkinan duplikat** | Banner di paling atas. Tombol simpan nonaktif sampai user memilih. |
| **Toko tidak dikenali** | Header kosong: "Toko belum dikenali · [Pilih toko]". **Butuh W-02.** |
| **Total tidak cocok** | "Jumlah item Rp182.400 · total struk Rp185.900 · selisih Rp3.500. Mungkin ada baris yang terlewat." + "Lihat gambar". Tidak memblokir simpan. |
| **Cabang tidak diketahui** | "AEON · cabang tidak diketahui · [Pilih]". Boleh disimpan (D-28). |
| **Struk multi-gambar** | Thumbnail "bagian 1/3", bisa di-tap untuk melihat gambar asli |
| **Baris kuantitas** | "2 × Rp19.500" |
| **Baris void** | Dicoret, teks "dibatalkan di struk" |
| **Produk timbang** | "JERUK MEDAN 0,535 kg × Rp45.000/kg = Rp24.075" |
| **Diskon member terdeteksi, user belum terdaftar** | Kotak: "Struk ini memakai harga member AEON. Kamu member AEON? [Ya, tandai]" (U-21) |
| **Semua beres** | "Semua item sudah dikenali." + "Simpan 14 harga" |
| **Mode tersimpan** (dibuka dari histori) | Sama, tanpa bagian "perlu dicek". Setiap baris bisa di-tap → S-16. Header bisa dikoreksi. Perubahan tanggal mengalir ke semua harga (trigger `receipt_propagate_header`). |
| Menyimpan | Tombol "Menyimpan…" |
| Gagal menyimpan | Pesan + "Coba lagi". Pilihan user tidak hilang. |

- **Setelah simpan:** "14 harga baru tersimpan · 2 lebih murah dari harga terbaikmu sebelumnya" (ƒ dibandingkan dengan `price_summary` sebelum simpan). Tidak menampilkan total pengeluaran.
- **Satu tangan:** tombol "Benar" lebar di bawah setiap item. "Simpan" menempel di bawah layar.

### S-11 Konfirmasi label & screenshot

> ⚠️ **Rancangan layar lengkap, tetapi sumber datanya belum ada di skema (T-1, W-01).** Lihat bagian 10.

- **Tujuan:** memastikan produk dan harga dari label atau screenshot benar. *"Harga ini dicatat dengan benar? Harga mana yang berlaku untuk saya?"*
- **Isi per item (satu foto bisa berisi beberapa label, domain model 2.6):**

```
[crop label]
Milo Original 200g?                       ragu   [Ganti]
Harga normal   Rp22.900
Harga promo    Rp19.500   berlaku 10–16 Okt
Harga member   Rp17.900   AEON Member
→ Dihitung untukmu: Rp19.500 PROMO
  Harga member tidak dihitung: kamu belum terdaftar AEON Member. [Saya member]
Lokasi: AEON BSD (dari sesi)                         [Ubah]
Tanggal: hari ini                                     [Ubah]
☐ Ini bundle (paket campuran)
```

- **Data yang akan disimpan (`price_record`):** `product_id`, `store_id`, `branch_id`, `source_type` (`price_label`/`marketplace`), `capture_id`, `transaction_date`, `normal_price`, `promo_price`, `promo_min_qty`, `promo_valid_from`, `promo_valid_until`, `member_price`, `member_program_id`, `effective_price` dan `price_basis` (ƒ D-26/D-27, dihitung aplikasi), `is_bundle`, `match_tier`, `match_confidence`, `match_outcome`, `visibility` (ƒ dari preferensi household, X-04).
- **Data kandidat sebelum disimpan:** **⛔** (X-01).
- **Asal lokasi:** `shopping_session.branch_id` (sesi), `capture.store_id/branch_id` (manual), atau "cabang tidak diketahui".
- **Mode marketplace (alur 5):**

```
Judul listing: "MILO ACTIV-GO 500G ORIGINAL SUSU COKELAT BUBUK"
→ Milo Original 500g?                      [Ganti]
Toko: Shopee · Seller: Nestlé Official Store
Harga  Rp46.500 (promo, normal Rp52.000)
Ongkir Rp12.000 · Voucher toko −Rp5.000   (info, tidak mengubah harga)
```

  - Seller: `branch` (`kind = 'seller'`, `name`, `external_ref`) (D-06). Seller baru dibuat privat (D-29).
  - Ongkir dan voucher: `price_record.extra` (D-36). Kuncinya belum didefinisikan (X-10).
  - Judul listing: `product_alias.alias_text` (per `store_id` Shopee).
- **Aksi utama:** "Simpan N harga". **Sekunder:** Ganti produk (S-14), Ubah lokasi (S-12), Saya member (S-19b, lalu kembali dan dihitung ulang untuk item yang belum disimpan), tandai bundle, Hapus item ("bukan label harga").
- **Keadaan:**

| Keadaan | Tampilan |
|---|---|
| **Harga member belum berlaku** | Seperti contoh di atas (D-27). Setelah "Saya member", hanya item di layar ini yang dihitung ulang. Harga lama tidak berubah (D-41), dan ini dijelaskan dalam satu kalimat. |
| **Cabang tidak diketahui** | "AEON · cabang tidak diketahui · [Pilih cabang]". Boleh disimpan (D-28). |
| **Toko tidak diketahui** (label tanpa logo, tanpa sesi) | Wajib memilih toko (S-12) sebelum simpan. Store wajib, Branch opsional (D-28). |
| **Promo kuantitas** | "Rp14.500 untuk 5 pcs (min. 5)" → `promo_min_qty`. Tetap ikut harga terbaik (D-34). |
| **Bundle** | Toggle aktif + teks "tidak dipakai untuk harga terbaik dan tren" (D-08) |
| **Barang berbeda dari judul listing** | Peringatan jika ukuran di judul tidak cocok dengan produk yang dipilih: "Judul menyebut 500G, produk yang dipilih 200 g." |
| **Beberapa label dalam satu foto** | Item ditumpuk, dengan nomor "1/3" |
| **Produk tidak dikenali** | "Produk belum dikenali" + "Pilih produk" / "Buat produk baru" |
| **Sudah di luar periode promo** | Jika tanggal observasi di luar `promo_valid_*`: "Promo sudah berakhir. Dihitung harga normal." (D-26) |

### S-12 Pilih toko & cabang

- **Tujuan:** menentukan lokasi untuk sesi atau untuk satu capture (D-11).
- **Mode:** **sesi** (judul "Kamu belanja di mana?"), **manual** (judul "Label ini dari mana?"), **koreksi** (dari S-10/S-11/S-16).
- **Isi:** langkah 1, pilih toko: "Terakhir dipakai" (ƒ dari `shopping_session` dan `price_record` terbaru), lalu semua toko (`store`, global dan privat) beserta kolom search. Langkah 2, pilih cabang: cabang terakhir dipakai di toko itu, semua cabang (`branch.name`, `city`, `region`, `status`), "**+ Cabang baru**" (hanya nama + kota, privat), dan "**Tidak tahu cabangnya**" (mode manual saja).
- **Data:** `store.name`, `channel`, `household_id` (badge PRIBADI); `branch.name`, `city`, `region`, `kind`, `status`, `household_id`. Disimpan ke `shopping_session.branch_id` atau `capture.store_id` + `capture.branch_id`.
- **Keadaan:**
  - Toko terakhir ada / kosong.
  - **Toko baru:** "+ Toko baru" (nama, offline/online), privat (D-29).
  - **Cabang tutup:** di bawah, dengan label "(tutup)". Tidak bisa dipilih untuk sesi baru.
  - **Mode sesi:** opsi "Tidak tahu cabangnya" **tidak ada**, karena `shopping_session.branch_id` wajib. Penggantinya "+ Cabang baru" yang cepat (W-19).
- **Satu tangan:** daftar "terakhir dipakai" di bagian bawah, dekat jempol. Search ada di bawah daftar.

### S-13 Sesi belanja

- **Tujuan:** mode "sedang di toko" (D-11). *"Saya di AEON BSD, mau cek dan foto beberapa label."*
- **Isi saat aktif:**

```
Belanja di AEON · BSD City
Mulai 14:05 · berakhir otomatis 18:05
──────────────────────────────
Label di sesi ini (4)
[foto] Milo 200g     Rp19.500 PROMO   12% lebih murah dari biasanya
[foto] Bimoli 2L     diproses…
[foto] ?             perlu dicek ›
[foto] Ultra Milk 1L Rp18.900 NORMAL  setara harga terbaikmu
──────────────────────────────
[ Akhiri sesi ]          [  📷  Foto label  ]
```

- **Data:** `shopping_session.branch_id`, `started_at`, `expires_at`, `ended_at`; `branch.name`, `store.name`; capture sesi (`capture.shopping_session_id`) + `capture.status`; hasil: `price_record` per `capture_id`; perbandingan ƒ dengan `price_summary.best_90d_unit_price` dan rata-rata (lihat W-08).
- **Aksi utama:** "Foto label" (tombol besar di kanan bawah). **Sekunder:** "Akhiri sesi" (`ended_at = now()`), "Ganti cabang", "Cek harga rak" (search).
- **Keadaan:**

| Keadaan | Tampilan |
|---|---|
| **Tidak ada sesi** | "Lagi di toko? Mulai sesi supaya label harga otomatis tercatat di cabang yang benar." + "Mulai belanja" → S-12. Daftar sesi terakhir untuk mulai lagi dengan 1 tap. |
| **Aktif, belum ada label** | "Foto label harga pertama." |
| **Aktif, ada label** | Seperti di atas |
| **Hampir kedaluwarsa** (< 30 menit) | "Sesi berakhir 25 menit lagi. [Perpanjang]". Perpanjang berarti mengubah `expires_at`. Lihat W-20. |
| **Kedaluwarsa** (D-43) | Saat membuka app: "Sesi di AEON BSD berakhir otomatis pukul 18:05. 4 label tersimpan." + "Mulai sesi baru". Foto label berikutnya **tidak** masuk ke sesi lama. |
| **Offline** | Kartu "menunggu sinyal". Sesi tetap berjalan, dan capture di antrean klien tetap membawa `shopping_session_id`. |

- **Satu tangan:** tombol foto berada di jangkauan jempol kanan. "Akhiri sesi" dibuat lebih kecil dan berada di kiri, supaya tidak tertekan tanpa sengaja.

### S-14 Pilih produk

- **Tujuan:** memilih produk yang benar untuk sebuah baris struk, label, atau target merge.
- **Isi:** kolom search (terisi dari `raw_text` atau judul listing), saran dari matching (`suggested_product_id` + kandidat lain), dan hasil search. Setiap hasil menampilkan ukuran dan badge PRIBADI. Baris terakhir: "**+ Buat produk baru**" → S-15.
- **Data:** `product.*`, `product_group.name`, `brand.name`. Kandidat lain selain saran utama: **⛔** hanya ada `suggested_product_id` tunggal. Daftar kandidat dari AI ada di `processing_run.raw_ai_output` (tidak terstruktur, X-01).
- **Keadaan:** saran ada / tidak ada; hasil kosong ("Tidak ditemukan · Buat produk baru"); **ukuran berbeda dari teks** ("Teks struk menyebut 200G, produk ini 500 g") sebagai peringatan, bukan blokir.
- **Mode target merge:** hanya menampilkan produk global atau privat milik household (aturan `merge_product`), tidak termasuk produk sumber.

### S-15 Produk baru

- **Tujuan:** membuat produk privat (D-29) ketika katalog belum punya produk itu.
- **Field:**

| Field | Kolom |
|---|---|
| Nama | `product.name` |
| Varian | `product.variant` |
| Brand (pilih atau baru) | `product.brand_id` → `brand` (baru = privat) |
| Group (pilih, baru, atau "sama dengan nama") | `product.product_group_id` → `product_group` |
| Kategori | `product.category_id` → `category` (sistem atau milik sendiri, §5.8) |
| Cara jual: per kemasan / timbang | `product.sale_mode` |
| Isi: `[1] × [200] [g ▾]` | `pack_count`, `content_size`, `content_unit` → `unit` |
| Timbang: harga per `[kg ▾]` | `content_unit` (`content_size` kosong) |
| Barcode (opsional, bisa lebih dari 1) | `barcode_assignment.code`, `code_type` |

- **Pratinjau:** "Milo Original · 1 × 200 g · harga per gram akan dihitung". Untuk multipack: "10 × 35 g = 350 g".
- **Keadaan:** kemasan / multipack / timbang; validasi (ukuran wajib untuk kemasan); "Produk serupa sudah ada: Milo Original 200g (katalog)" sebagai pencegah duplikat (ƒ search trigram); mode **edit** untuk produk privat. Mengubah ukuran akan memunculkan teks "Harga per satuan semua data produk ini akan dihitung ulang" (job `recompute_unit_price`).
- **Catatan:** produk baru selalu `PRIBADI`, dengan penjelasan satu kalimat (D-29).

### S-16 Detail & koreksi harga

- **Tujuan:** melihat dan mengoreksi satu titik harga (alur 6). *"Data ini salah, bagaimana memperbaikinya?"*
- **Isi:** semua field satu `price_record`, gambar sumber (crop, jika belum dihapus), info matching ("dikenali otomatis dari alias"), dan riwayat perubahan.
- **Data:** `price_record.*`; sumber: `capture_image` via `capture_id`; struk: `receipt_line` via `receipt_line_id`; riwayat: `audit_log` (`entity_type = 'price_record'`, `entity_id`, `action`, `before`, `after`, `created_at`, `actor_id`).
- **Aksi:**

| Aksi | Efek data |
|---|---|
| Ganti produk | `price_record.product_id` (+ tawarkan "Perbarui juga alias 'MILO ACT 200G' di AEON?" → `product_alias.product_id`). `match_outcome = 'corrected'`. |
| Ubah harga normal/promo/member | Observasi: `price_record.*_price` + hitung ulang `effective_price`/`price_basis`. **Struk: koreksi di `receipt_line`, lalu record dibentuk ulang** (D-23). UI tidak membedakan cara mengedit, tetapi teks kecilnya: "mengubah baris struk". |
| Ubah tanggal | Observasi: `transaction_date`. Struk: membuka header di S-10 (berlaku untuk semua item). |
| Ubah toko/cabang | S-12 mode koreksi. Struk: lewat header. |
| Tandai bundle | `is_bundle` |
| Hapus / batalkan ("label salah tempel") | `status = 'void'` |

- **Keadaan:** dari label; dari struk; dari screenshot (menampilkan ongkir); **gambar sudah dihapus** (retensi); **produk global** (tidak bisa mengubah produknya, hanya record ini); **menyimpan → "Ringkasan diperbarui dalam beberapa detik"** (§5.10, D-31).
- **Satu tangan:** "Simpan perubahan" menempel di bawah.

### S-17 Gabungkan produk

- **Tujuan:** menggabungkan produk privat yang dobel (D-21, D-30). *"Ini sebenarnya produk yang sama."*
- **Langkah:** (1) dari S-03 produk privat, pilih "Gabungkan dengan…" → S-14 mode target. (2) Pratinjau:

```
"Milo 200 gr" (PRIBADI)  →  Milo Original 200g (katalog)
Pindah: 6 harga · 2 alias · 1 barcode
"Milo 200 gr" akan menjadi rujukan ke produk tujuan. Tidak bisa dibatalkan.
[ Gabungkan ]
```

- **Data:** pratinjau ƒ `count` dari `price_record`, `product_alias`, `barcode_assignment` per `product_id`. Eksekusi: RPC `merge_product(p_from, p_into)`, tercatat di `audit_log` (`action = 'merge'`).
- **Keadaan:**
  - Pilih target, pratinjau, menggabungkan, selesai (alih ke produk tujuan).
  - **Ukuran berbeda (U-16):** "Ukuran berbeda: 200 g vs 500 g. Menggabungkan akan membuat harga per gram salah. Jika ini ukuran lain dari produk yang sama, masukkan ke **group** yang sama." Tombol gabung tetap ada, tetapi harus dikonfirmasi dua kali. Opsi lain: "Pindahkan ke group" (`product.product_group_id`).
  - **Produk global:** tidak bisa memulai merge. Teks D-30.
  - **Gagal** (mis. target sudah di-merge): pesan dari server.

### S-18 Pisahkan produk

- **Tujuan:** memisahkan histori yang tercampur ke produk baru (D-37). *"Sebagian data ini sebenarnya Milo 3in1, bukan Milo bubuk."*
- **Langkah:** (1) Buat produk baru (S-15, terisi salinan) atau pilih produk lain (S-14). (2) Centang record yang dipindah (daftar histori, dengan filter toko dan sumber). (3) Opsi "Teks struk 'MILO 3IN1' di AEON selanjutnya dikenali sebagai produk baru" (`product_alias.product_id`, alias milik household saja). (4) Konfirmasi.
- **Data:** `price_record.product_id` diperbarui per record terpilih (milik household, termasuk pada produk global); `product_alias` milik household. Semua tercatat di `audit_log` lewat trigger.
- **Keadaan:** belum ada yang dicentang (tombol nonaktif); N dicentang; **produk global** (boleh, hanya record milik sendiri yang dipindah); selesai.
- **Tidak ada pemindahan otomatis** (D-37).

### S-19 Saya (pengaturan)

- **Isi minimal:** Program member (S-19b) · Berbagi harga publik (S-19c) · Privasi & data (info retensi 12 bulan D-32, hapus akun) · Keluar.
- **Data:** `profile.display_name`; ringkasan ƒ jumlah program; status berbagi (X-04).
- Sengaja **tidak ada** total pengeluaran, anggaran, atau laporan belanja.

### S-19b Program member

- **Tujuan:** menandai program member yang diikuti (D-10, D-27).
- **Isi:** daftar per toko dengan toggle: AEON · AEON Member; Alfamart · Alfagift; Indomaret · Klik Indomaret / Poinku; Superindo · Superindo Member (contoh nama. Isinya berasal dari seed katalog).
- **Penjelasan (satu kalimat, wajib):** "Harga member hanya dihitung sebagai harga terbaik untuk program yang kamu ikuti. Menandai sekarang tidak mengubah harga yang sudah tercatat." (D-27, D-41)
- **Data:** `member_program.name`, `store_id` → `store.name`, `status`; toggle → insert/delete `household_program_membership`.
- **Keadaan:** normal; **program dihentikan** (`status = 'discontinued'`, toggle nonaktif + label); **program tidak ada di daftar** → teks "Program belum ada di katalog" (W-05).

### S-19c Berbagi harga publik

> ⚠️ **Sebagian bergantung pada W-04.** Toggle dirancang. Perilaku terhadap data lama belum dirancang.

- **Tujuan:** opt-in berbagi harga secara anonim (D-07, D-25).
- **Isi:** toggle "Bagikan harga secara anonim" (default **mati**). Penjelasan: apa yang dibagikan (produk dan toko katalog umum, tanggal, cabang, harga, D-46) dan apa yang **tidak** (identitas, struk, produk/toko pribadi, bundle).
- **Data:** preferensi household **⛔** (X-04); per record: `price_record.visibility`; hasil: `public_price_fact` (via trigger).
- **Keadaan:** mati (default); aktif; mematikan → "Harga yang sudah dibagikan akan ditarik" (trigger menghapus fakta publik). **Data lama:** belum dirancang (W-04).

### S-20 Tanya

- **Tujuan:** menjawab pertanyaan bahasa sehari-hari, **hanya lewat tools yang sudah didefinisikan** (D-05). Diakses dari baris "Tanya: …" di hasil search, bukan dari tab sendiri.
- **Isi:**

```
Kamu: milo 500 atau 200 yang lebih hemat?
──────────────────────────────
500 g lebih hemat per gram: Rp91,8/g vs Rp97,5/g (6% lebih murah).
Berdasarkan harga terbaik 90 hari di historimu (9 data, terakhir 12 Okt).
[Lihat perbandingan ukuran ›]
Dijawab dengan: bandingkan_ukuran(Milo Original)
──────────────────────────────
Contoh pertanyaan:  [termurah di mana?] [naik atau turun?] [harga per gram?]
```

- **Tools (= query §9, didefinisikan di Tahap 4/6):** `cari_harga_terbaik`, `tren_harga`, `harga_per_satuan`, `bandingkan_ukuran`, `lebih_hemat_di_mana`, `histori_harga`.
- **Data:** hasil tool (sama dengan S-02 s/d S-05). Percakapan tidak disimpan di DB 💾.
- **Keadaan:**
  - **Jawaban:** selalu menyebut angka, jumlah data, tanggal terakhir, nama tool, dan tautan ke layar sumber.
  - **Di luar kemampuan** (mis. "resep pakai milo", "berapa total belanjaku bulan ini"): "Saya hanya bisa menjawab dari histori hargamu: harga termurah, di mana, tren, per satuan, perbandingan ukuran." Pengeluaran sengaja tidak dijawab (prinsip produk).
  - **Data kurang:** "Baru ada 1 data untuk Milo 200g. Belum cukup untuk tren."
  - **Produk ambigu:** "Maksudmu Milo Original atau Milo 3in1?" (chip pilihan).
  - **Memuat:** "Mencari di historimu…"
- **Tidak ada:** jawaban dari pengetahuan umum AI tentang harga pasar. AI tidak menulis atau mengubah data.
- Masuk MVP atau tidak: W-11.

---

## 7. Keputusan UX yang Diusulkan (U-xx)

| ID | Usulan | Alasan | Trade-off |
|---|---|---|---|
| **U-01** | **Navigasi: 4 tab (Cari, Unggahan, Belanja, Saya) + tombol kamera di tengah.** | Kamera adalah aksi paling sering di toko. Tab "Belanja" membuat sesi mudah ditemukan. | Lima slot cukup padat. Alternatifnya, "Belanja" digabung ke lembar kamera, tetapi sesi jadi kurang terlihat. |
| **U-02** | **Kolom search di bawah layar** (di atas tab bar), bukan di atas. | Satu tangan di toko, sambil memegang keranjang. | Tidak lazim. Hasil search tampil di atas kolom, sehingga urutan visualnya terbalik dibanding app lain. Bisa diuji di Tahap 5. |
| **U-03** | **Hasil search dikelompokkan per Product Group**, dengan "paling hemat per gram" di header. | Pertanyaan no. 5 terjawab di hasil search. Sesuai D-09. | Produk tanpa group tampil sendiri. Kartu lebih tinggi. |
| **U-04** | **Angka utama = harga terbaik 90 hari + harga per satuan.** All-time lebih kecil di bawahnya. Jika 90 hari kosong, all-time naik menjadi angka utama dengan keterangan umur data. | D-02, §5.5. | Dua angka harga per kartu. Diselesaikan dengan hierarki ukuran teks. |
| **U-05** | **Tren selalu dengan teks** ("↓ 4% vs 30 hari sebelumnya"), tidak hanya panah. Jika data kurang: "Tren: data belum cukup", ditambah jumlah data dan tanggal terakhir. | D-15, D-44, T-5. | Teks lebih panjang dari ikon. |
| **U-06** | **"Cek harga rak"**: kalkulator di S-03b. Hasilnya dalam persen terhadap harga terbaik 90 hari dan harga terakhir. **Tidak menyimpan data.** | Inti prinsip "sebelum membeli". Hasilnya instan, tidak perlu menunggu OCR. Tidak ada sumber data baru (§3 tetap 3 sumber). | User mungkin berharap harga yang diketik ikut tersimpan. Solusinya: tombol "Foto labelnya untuk disimpan". Lihat W-10. |
| **U-07** | **Semua kontrol kamera di sepertiga bawah.** Shutter besar. Mode label tetap terbuka untuk foto berikutnya. | Satu tangan, beberapa label berturut-turut. | — |
| **U-08** | **Lembar kamera mengikuti konteks:** saat sesi aktif, "Label" terpilih lebih dulu. | Mengurangi 1 ketukan di alur paling sering di toko. | User yang ingin foto struk saat sesi aktif perlu 1 ketukan tambahan. |
| **U-09** | **Unggah banyak gambar: tanya "beberapa struk atau 1 struk panjang?"** | Kebutuhan "upload banyak gambar" bisa berarti dua hal. Menebak salah lebih mahal daripada bertanya sekali. | 1 dialog tambahan. |
| **U-10** | **Deteksi duplikat dua tahap.** (1) Hash gambar: langsung di klien sebelum upload. (2) Sidik jari struk: di S-10 setelah OCR. **Struk yang dicurigai duplikat tidak pernah di-auto-save**, selalu masuk `needs_confirmation`. User yang memilih (D-20). | Menutup T-8 tanpa mengubah D-12. | Struk yang benar-benar berbeda tetapi bertotal sama (jarang) perlu 1 ketukan. |
| **U-11** | **Pemrosesan tidak memblokir.** Setelah unggah, user langsung kembali ke layar sebelumnya. Status terlihat di tab Unggahan, dengan badge "perlu dicek". | OCR/AI bisa memakan waktu puluhan detik. Di toko, user tidak boleh menunggu. | Butuh badge yang jelas, dan mungkin notifikasi (W-13). |
| **U-12** | **Konfirmasi: "perlu dicek" di atas, auto-save dilipat.** Satu tombol "Benar" per item, plus "Benarkan semua saran". Setelah dibenarkan, tampil teks "Selanjutnya 'MILO ACT 200G' di AEON dikenali otomatis". | Usaha minimal. Transparan bahwa keputusan user menjadi alias (§5.9). | "Benarkan semua" berisiko diterima tanpa dibaca. Tombol ini hanya muncul jika ada 3 item atau lebih. |
| **U-13** | **Banner sesi di atas tab bar, di semua layar, dengan tombol "Foto label".** | Foto label cukup 1 ketukan dari mana pun. Mengingatkan user bahwa sesi masih aktif (domain model 2.6, sesi lupa ditutup). | Memakan ±40 px tinggi layar. |
| **U-14** | **"Tidak tahu cabangnya" adalah pilihan eksplisit** di mode manual. | D-28. Lebih jujur daripada memaksa user menebak. | Bisa disalahgunakan karena malas. Diterima, sebab D-28 memang mengizinkan. |
| **U-15** | **Status, confidence, dan label harga tidak pernah hanya berupa warna.** Selalu ada teks ("ragu", "PROMO"). | Wireframe grayscale, dan aksesibilitas di Tahap 5. | — |
| **U-16** | **Peringatan merge beda ukuran**, dengan opsi "Pindahkan ke group". | T-9. Mencegah kerusakan harga per satuan. | — |
| **U-17** | **Antrean offline di perangkat untuk foto.** Foto disimpan di klien dan diunggah otomatis saat ada sinyal. ID capture dibuat di klien (UUID, desain fisik §2). | Supermarket basement. Foto tidak boleh hilang. | Kompleksitas PWA (Service Worker, IndexedDB) di Tahap 5. |
| **U-18** | **"Tanya" lewat baris di hasil search**, bukan tab sendiri. Setiap jawaban menyebut tool, jumlah data, tanggal, dan tautan ke layar sumber. | D-05: AI menjelaskan hasil query, bukan sumber kebenaran. Fitur sekunder, karena layar biasa sudah menjawab 6 pertanyaan. | Kurang terlihat. Itu disengaja. |
| **U-19** | **Keadaan awal = ajakan "foto struk terakhir".** Setiap layar kosong menjelaskan apa yang akan muncul nanti. | Struk memberi 10–30 harga sekaligus. Ini cara tercepat keluar dari kondisi histori kosong. | — |
| **U-20** | **Satuan tampilan = satuan dasar** (Rp97,5/g, sesuai contoh §5.4). Produk timbang juga tampil per `content_unit` (Rp45.000/kg). | Konsisten dengan requirement. | Harga per gram untuk barang besar (beras 5 kg = Rp14,6/g) kurang intuitif. Opsi per 100 g / per kg: W-12. |
| **U-21** | **Deteksi harga member di struk → tawarkan menandai keanggotaan.** | Mengurangi kasus "harga member tidak dihitung" (D-27). Tidak mengubah data lama (D-41). | Butuh sinyal dari parsing (baris diskon bertuliskan "MEMBER"). |
| **U-22** | **Scan barcode di kolom search** → langsung ke detail produk. | Paling cepat di depan rak. Memakai `barcode_assignment` yang sudah ada. | Ini **tambahan fitur**, bukan sekadar tata letak. Butuh persetujuan (W-14). Dukungan BarcodeDetector di browser berbeda-beda. |

---

## 8. Uji Telusur

### 8.1 Enam pertanyaan inti (§1)

| # | Pertanyaan | Layar & ketukan | Data | Status |
|---|---|---|---|---|
| 1 | Berapa harga termurah produk ini? | **S-01** tap search (1) → ketik "milo" → **S-02** kartu: "Rp19.500 PROMO · 90 hari" + all-time | `price_summary.best_90d_*`, `best_all_*` | ✅ 1 ketukan |
| 2 | Di toko dan cabang mana saya pernah mendapat harga termurah? | Kartu yang sama: "AEON · BSD City · 12 Okt" | `best_90d_store_id`, `best_90d_branch_id`, `best_90d_date` | ✅ 1 ketukan. Branch kosong → "cabang tidak diketahui". |
| 3 | Harga sekarang naik atau turun dibanding bulan lalu? | Kartu yang sama: "↓ 4% vs 30 hari sebelumnya". Detail: S-03 grafik (+1). | `trend_direction`, `trend_pct` | ⚠️ 1 ketukan, tetapi definisinya 30 vs 30 hari (D-44), bukan bulan kalender. Lihat W-07. |
| 4 | Berapa harga per gram / per satuan? | Kartu yang sama: "Rp97,5/g". Untuk harga di rak: S-03b (+1). | `best_90d_unit_price`; ƒ di S-03b | ✅ 1 ketukan |
| 5 | Apakah kemasan 500 g lebih murah daripada 200 g? | **S-02** header group: "Paling hemat per gram: 500g" (1). Rincian: "Bandingkan ukuran" → **S-04** (2). | Query §9 no. 5 | ✅ 1–2 ketukan |
| 6 | Saya lebih hemat membeli di mana? | **S-02** tap kartu → **S-03** bagian "Lebih hemat di mana" (2). Lengkap: → **S-05** (3). Per group: toggle di S-05. | Query §9 no. 6 | ✅ 2 ketukan (3 untuk daftar lengkap). Per keranjang ditunda (D-39). |

Keenam pertanyaan juga bisa diajukan lewat **S-20 Tanya**, dengan jawaban dari tool yang sama.

### 8.2 Edge case §10 yang relevan dengan UI

| Edge case | Layar | Penanganan |
|---|---|---|
| **Struk:** baris non-produk | S-10 | Bagian "Bukan produk" (terlipat). User bisa memindahkannya ke produk atau sebaliknya. |
| Baris diskon di bawah item | S-10 | Ditampilkan menempel di bawah item: "diskon −3.400 = Rp19.500 PROMO" |
| Void / refund | S-10 | Baris dicoret, "dibatalkan di struk" |
| Kuantitas "2 × 19.500" | S-10, S-03 | "2 × Rp19.500". Histori menampilkan harga per kemasan + kuantitas. |
| Struk panjang multi-gambar | S-07, S-07b, S-10 | "Tambah bagian". Thumbnail "bagian 1/3". |
| Struk pudar / miring | S-07, S-09, S-10 | Panduan di kamera; status `failed` + Ulangi/Foto ulang; item "ragu" di konfirmasi |
| Tanggal transaksi ≠ tanggal upload | S-10, S-08 | Header menonjolkan tanggal transaksi, "diunggah hari ini" lebih kecil. Semua daftar memakai tanggal transaksi. |
| **Barcode:** satu produk banyak barcode | S-15 | "+ barcode lain" |
| Shrinkflation | S-04 | SKU lama tampil dengan "data terakhir Mar 2026" |
| PLU produk timbang | S-10, S-03 | "0,535 kg × Rp45.000/kg". Harga utama per kg. |
| **Label:** tanpa info cabang | S-11, S-12 | Sesi → manual → "Tidak tahu cabangnya" (D-28) |
| Dua harga dalam satu label | S-11 | Field normal + promo + member, dengan "Dihitung untukmu" (D-26) |
| Periode promo | S-11, S-03 | Field periode. "Promo sudah berakhir" jika di luar periode. |
| Label salah tempel | S-16 | "Batalkan data ini" (`status = 'void'`) atau ganti produk |
| **Marketplace:** belum termasuk ongkir/voucher | S-11, S-02, S-05 | Ongkir/voucher sebagai info. "belum termasuk ongkir" di hasil. |
| Barang berbeda dari judul listing | S-11, S-14 | Judul ditampilkan. Peringatan jika ukuran tidak cocok. Ganti produk. |
| **Toko:** hierarki grup (Alfamart vs Alfamidi) | S-05, S-12 | Tampil sebagai toko terpisah. Grup tidak dipakai di UI MVP. |
| Cabang tutup / rebrand | S-05, S-12, S-03 | "(tutup) → penerus". Tidak bisa dipilih untuk sesi baru. |
| Harga zona per wilayah | — | Tidak relevan untuk UI MVP. Kota/wilayah tampil di pemilih cabang. |
| **Data:** koreksi data lama | S-16, S-10 (mode tersimpan) | Semua field bisa dikoreksi. Riwayat dari `audit_log`. |
| Merge produk | S-17 | Privat saja, peringatan beda ukuran |
| Split produk | S-18 | Manual (D-37) |
| Struk duplikat | S-07 (hash), S-10 (sidik jari) | U-10 |
| *Tambahan 2a:* beberapa label dalam satu foto | S-11 | Item ditumpuk "1/3" |
| *Tambahan 2a:* sesi lupa ditutup | S-13 | Kedaluwarsa 4 jam (D-43) + banner + peringatan |
| *Tambahan 2a:* mata uang berbeda | S-04 | Dipisah, tidak dikonversi |

### 8.3 Data yang dibutuhkan layar tetapi tidak ada di skema

Ini **kandidat perubahan skema. Skema tidak diubah.** Kolom "Blocking" berarti Tahap 4 sulit dimulai tanpa keputusan.

| ID | Data | Dibutuhkan oleh | Usulan | Blocking |
|---|---|---|---|---|
| **X-01** | **Kandidat item observasi sebelum dikonfirmasi** (produk saran, kandidat lain, harga terbaca, confidence) | S-11, S-08 (jumlah perlu dicek), S-14 | Tabel staging baru, mis. `capture_item`. Lihat W-01. | **Ya** |
| **X-02** | **Confidence per field header struk** + struk draft yang tokonya belum dikenali | S-10 | `receipt.store_id` boleh NULL selama `status = 'draft'` + kolom `receipt.field_confidence jsonb`. Lihat W-02. | **Ya** |
| **X-03** | **Ambang confidence auto-save** (D-12) | S-10, S-11, S-08 | Kunci `app.config` `auto_save_min_confidence`. Lihat W-03. | **Ya** (kecil) |
| **X-04** | **Preferensi berbagi publik per household** | S-19c, insert `price_record.visibility` | Kolom `household.share_prices_public boolean default false`. Lihat W-04. | **Ya** (kecil) |
| X-05 | Nama brand dalam teks pencarian produk | S-02, S-14 | Ikut sertakan `brand.name` di search (trigger atau join di RPC search). Lihat W-06. | Tidak |
| X-06 | Toko/cabang harga **terakhir** di ringkasan | S-03 (dan S-02 jika diinginkan) | `price_summary.last_store_id`, `last_branch_id`, atau cukup query ke `price_record`. | Tidak |
| X-07 | Petunjuk "ada harga member yang tidak dihitung" dan "hanya bundle" | S-02 | Query saat search (default), atau kolom di `price_summary` jika terlalu lambat. | Tidak |
| X-08 | Kategori alasan gagal proses | S-08, S-09 | `capture.error_code` (`blurry`, `not_a_receipt`, `unsupported`, `timeout`) di samping `error_message`. | Tidak |
| X-09 | Program member yang belum ada di katalog | S-11, S-19b | Lihat W-05 | Tidak |
| X-10 | Kunci `price_record.extra` (ongkir, voucher, judul listing, URL listing, cashback) | S-11, S-16, S-03 | Kolomnya ada. Kuncinya perlu didefinisikan sebagai kontrak di Tahap 4. | Tidak |
| X-11 | Foto/thumbnail produk | S-02, S-03, S-14 | Tidak untuk MVP. Wireframe memakai placeholder. Lihat W-16. | Tidak |
| X-12 | Kandidat produk lain (lebih dari 1 saran) untuk baris struk | S-14 | `receipt_line` hanya punya `suggested_product_id`. Cukup dari X-01 jika staging dipakai juga untuk struk, atau dari `raw_ai_output`. | Tidak |
| X-13 | Langganan notifikasi push | S-08 (jika W-13 = ya) | Tabel `push_subscription`. | Tidak |

**Data yang sengaja disimpan di perangkat (💾, bukan kandidat skema):** pencarian terakhir, produk baru dicek, status onboarding, toggle tampilan ("hanya harga normal"), antrean foto offline, riwayat percakapan Tanya.

### 8.4 Catatan untuk Tahap 4 (bukan perubahan skema)

1. **Query search** (§9 no. 1) perlu *left join* ke `price_summary` supaya produk tanpa histori tetap muncul, dan perlu menyaring produk `merged`/`archived`.
2. **Query "lebih hemat di mana" per group** (§9 no. 6) perlu menyaring dimensi dan mata uang yang sama.
3. **Query tren bulanan** (§9 no. 3) sebaiknya diselaraskan dengan D-44 (W-07).
4. **Struk yang dicurigai duplikat tidak boleh di-auto-save** (U-10).
5. **Harga efektif observasi (D-26)** dihitung ulang di S-11 saat user mengubah keanggotaan sebelum menyimpan. Record yang sudah tersimpan tidak berubah (D-41).

---

## 9. Pertanyaan untuk Didiskusikan

Setiap pertanyaan punya usulan default. Jawab "setuju semua" jika semua default sudah cocok.

### 9.1 Blocking untuk Tahap 4 (Backend)

| ID | Pertanyaan | Usulan default |
|---|---|---|
| **W-01** | **Di mana kandidat item label/screenshot disimpan sebelum dikonfirmasi?** (T-1, X-01) Pilihan: (a) tabel staging baru `capture_item` (kandidat produk, harga terbaca, confidence, status `pending/accepted/rejected`, rujukan ke `price_record` setelah diterima); (b) dibaca dari `processing_run.raw_ai_output`; (c) `price_record` dengan status baru `pending`. | **(a)**. (b) tidak terstruktur dan nanti disamarkan (D-32). (c) mencemari ringkasan, fakta publik, dan metrik, karena semua trigger harus diberi pengecualian. |
| **W-02** | **Bagaimana struk draft yang tokonya belum dikenali, dan bagaimana UI tahu field header mana yang meragukan?** (T-2, X-02) | `receipt.store_id` boleh NULL **hanya** selama `status = 'draft'` (CHECK). Tambah `receipt.field_confidence jsonb` (mis. `{"store":0.4,"date":0.95,"total":0.99}`). |
| **W-03** | **Ambang confidence untuk auto-save (D-12)?** Dan apakah selisih total struk ikut memaksa konfirmasi? | Kunci `app.config` `auto_save_min_confidence = 0.90`. Nilai final ditentukan setelah uji OCR (D-16). Selisih total > 1% **tidak** memaksa konfirmasi, cukup ditampilkan sebagai peringatan. |
| **W-04** | **Opt-in berbagi publik disimpan di mana, dan apakah berlaku surut?** (T-4, X-04) | Kolom `household.share_prices_public` (default `false`). Hanya berlaku untuk record **baru**. Tombol terpisah "Bagikan juga data lama" sebagai aksi eksplisit. Mematikan opt-in menarik semua fakta yang sudah dibagikan. |
| **W-05** | **Harga member dari program yang belum ada di katalog?** (T-7) | Kurator men-seed program member toko besar sebelum rilis. Jika programnya tidak ada, harga member disimpan di `extra` sebagai catatan (`member_note`), tidak sebagai `member_price`, dan tidak ikut harga terbaik. Program privat per household tidak dibuat di MVP. |
| **W-06** | **Search: ikut mencari nama brand, dan menampilkan produk katalog yang belum punya histori?** (T-6, X-05) | **Ya dan ya.** Brand ikut dicari lewat RPC search (join), bukan dengan mengubah kolom generated. Produk tanpa histori tampil di bawah hasil yang punya data. |

### 9.2 Non-blocking

| ID | Pertanyaan | Usulan default |
|---|---|---|
| W-07 | Tren "dibanding bulan lalu": label UI dan query AI memakai D-44 (30 vs 30 hari) atau bulan kalender? (T-5) | **D-44 di semua tempat.** Label UI: "vs 30 hari sebelumnya". Query §9 no. 3 diselaraskan di Tahap 4. |
| W-08 | Ambang "mendekati harga terbaik" di Cek harga rak dan kartu sesi? | **≤ 5%** di atas harga terbaik 90 hari. Masuk `app.config`. |
| W-09 | Apakah data publik dari pengguna lain ditampilkan (mis. saat histori kosong)? (T-11) | **Tidak di MVP.** Prinsipnya histori pribadi. Ditinjau ulang setelah ada cukup data publik. |
| W-10 | Apakah harga yang diketik di "Cek harga rak" boleh disimpan sebagai observasi? | **Tidak.** Butuh `source_type` baru dan mengubah §3. Penggantinya tombol "Foto labelnya". |
| W-11 | Layar **Tanya** (AI) masuk MVP? | Dirancang sekarang, **dibangun di Tahap 6** bersama integrasi AI. Tool-nya memakai query §9. |
| W-12 | Satuan tampilan untuk produk besar: per gram, per 100 g, atau per kg? (U-20) | **Per satuan dasar** seperti contoh §5.4. Opsi "per 100 g / per kg" ditunda. |
| W-13 | Notifikasi push saat pemrosesan selesai atau perlu dicek? | **Tidak di MVP.** Badge di tab Unggahan sudah cukup. |
| W-14 | Scan barcode untuk mencari (U-22)? | **Ya**, jika browser mendukung BarcodeDetector. Jika tidak, ikonnya disembunyikan. |
| W-15 | Undo merge? | **Tidak di MVP.** Konfirmasi dua kali + peringatan ukuran. `audit_log` menyimpan keadaan sebelum merge untuk pemulihan manual oleh admin. |
| W-16 | Foto produk? | **Tidak di MVP.** Placeholder ikon kategori. |
| W-17 | Metode login? | **Email OTP + Google** (Supabase Auth). |
| W-18 | Screenshot **pesanan** marketplace (barang sudah dibeli) diperlakukan sebagai pembelian atau observasi? | **Observasi** sesuai §3. Ditinjau ulang setelah MVP. |
| W-19 | Sesi belanja tanpa cabang (toko saja)? | **Tidak.** `shopping_session.branch_id` wajib. "+ Cabang baru" cukup dengan nama. |
| W-20 | Perpanjang sesi sebelum kedaluwarsa? | **Ya**, +2 jam, dengan mengubah `expires_at`. Tidak bertentangan dengan D-43 karena yang otomatis tetap 4 jam. |
| W-21 | Laporkan kesalahan produk katalog global? | **Tidak di MVP.** Teks penjelasan saja. User bisa memisahkan record miliknya (S-18). |
| W-22 | Cakupan cache offline untuk search? | Ringkasan produk yang **pernah dibuka** + 50 produk dengan data terbanyak. |
| W-23 | Lebih hemat di mana: baris dengan 1 data tetap diurutkan bersama yang lain? | **Ya**, dengan teks "baru 1 data". |
| W-24 | Tanggal untuk screenshot marketplace yang diunggah belakangan? | Default tanggal unggah, bisa diubah di S-11. Tanggal dari metadata gambar dipakai jika tersedia. |

---

## 10. Alur yang Belum Bisa Dirancang Penuh

| Alur | Yang sudah dirancang | Yang berhenti | Apa yang kurang |
|---|---|---|---|
| **3/4/5 — Konfirmasi label & screenshot (S-11)** | Tata letak, field, semua keadaan, aksi | **Sumber data kandidat** dan cara menghitung "N perlu dicek" | W-01. Tanpa keputusan ini, UI tidak punya tempat membaca kandidat item yang belum disimpan. |
| **3 — Struk dengan toko tidak dikenali (S-10)** | Keadaan "Toko belum dikenali" dan penanda field ragu | Penyimpanan draft tanpa toko dan sumber penanda field | W-02 |
| **7 — Berbagi publik (S-19c)** | Toggle, penjelasan, efek mematikan | **Perilaku terhadap data lama** saat dinyalakan | W-04. Requirement (D-07, D-25) menetapkan opt-in dan anonim, tetapi tidak menyebut cakupan waktu. |

Alur lainnya (1, 2, 4 tanpa konfirmasi, 6, 8) sudah dirancang lengkap terhadap skema yang ada.

---

**Langkah berikutnya:** review dokumen ini dan prototipe. Setelah U-xx dan pertanyaan blocking W-01 s/d W-06 diputuskan, keputusan dicatat di Decision Log, lalu Tahap 3 ditutup sebelum masuk Tahap 4.
