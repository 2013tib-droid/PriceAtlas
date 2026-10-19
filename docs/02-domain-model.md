# Tahap 2a — Domain Model

> Status: **Disetujui (2026-10-19).** Semua usulan U-xx dan default Q-01 s/d Q-16 diterima dan sudah dicatat di Decision Log `PROJECT.md` sebagai D-22 s/d D-40.
> Rujukan `§` dan `D-xx` mengacu ke `PROJECT.md`.

Dokumen ini hanya membahas desain domain. Belum ada SQL, tipe data, index, foreign key, atau ERD fisik. Semua itu masuk Tahap 2b, setelah pertanyaan di bagian 8 terjawab.

---

## Daftar Isi

1. [Ringkasan dan Keputusan Kunci](#1-ringkasan-dan-keputusan-kunci)
2. [Requirement Review](#2-requirement-review)
3. [Domain Model](#3-domain-model)
4. [Relationship](#4-relationship)
5. [Aggregate Boundary](#5-aggregate-boundary)
6. [Data Ownership Matrix](#6-data-ownership-matrix)
7. [Review](#7-review)
8. [Pertanyaan untuk Didiskusikan](#8-pertanyaan-untuk-didiskusikan)

---

## 1. Ringkasan dan Keputusan Kunci

Ada empat keputusan yang paling menentukan bentuk database nanti.

| Kode | Usulan | Alasan singkat |
|---|---|---|
| **U-01** | **Purchase dan Observation disatukan menjadi satu entity: `Price Record`**, dengan atribut jenis sumber (`receipt` / `price_label` / `marketplace`). | Semua fitur inti (harga terbaik, tren, harga per satuan, search, berbagi publik) membaca keduanya sekaligus. Satu entity berarti satu jalur query, satu ringkasan, dan satu aturan RLS. |
| **U-02** | **`Receipt Line` ≠ `Price Record`.** Receipt Line adalah baris *apa adanya di struk* (termasuk baris diskon, non-produk, dan void). Price Record adalah *interpretasinya* (produk mana, harga apa). Price Record pembelian diturunkan dari Receipt Line, satu arah. | Struk butuh semua baris supaya bisa dicek terhadap total (§5.7). Histori harga hanya butuh baris produk yang sudah bersih. |
| **U-03** | **Kepemilikan dan visibilitas dipisah.** Kepemilikan: System / Household / Hybrid. Visibilitas: Private / Public opt-in. | "Public" bukan pemilik. Harga tetap milik household walaupun dibagikan (D-07). |
| **U-04** | **Berbagi publik lewat proyeksi terpisah (`Public Price Fact`)**, bukan dengan membuka baris Price Record lewat RLS. | Baris Price Record selalu membawa identitas household. Anonimitas lebih aman dijamin dengan menyalin field yang aman saja daripada mengandalkan aturan RLS per kolom. |

**Verdict:** Model domain sudah cukup matang untuk didiskusikan. **Desain fisik (Tahap 2b) sebaiknya belum dimulai** sampai 7 pertanyaan *blocking* di bagian 8 dijawab. Alasannya ada di bagian 7.5.

---

## 2. Requirement Review

Requirement tidak diubah. Bagian ini hanya mencatat celah yang muncul saat memodelkan, beserta rekomendasinya.

### 2.1 Requirement yang ambigu

| # | Temuan | Dampak ke desain | Rekomendasi |
|---|---|---|---|
| A-1 | **Harga efektif untuk Observation tidak terdefinisi.** Definisinya "harga yang benar-benar dibayar", padahal pada label harga tidak ada yang dibayar. | Harga terbaik dan tren memakai harga efektif. Tanpa definisi ini, observasi tidak bisa ikut dihitung. | Untuk observasi, harga efektif = harga terendah yang **berlaku untuk household itu** pada tanggal observasi: harga promo jika periode promonya aktif, dan harga member hanya jika household ikut program tersebut. |
| A-2 | **Kapan harga member ikut dihitung sebagai harga terbaik?** D-10 hanya menyebut harga member disimpan terpisah. | Menentukan apakah harga member masuk ke ringkasan. | Harga member ikut dihitung **hanya jika household menandai keanggotaan program tersebut**. Kalau tidak, harga itu tetap tampil di histori dengan label "member". |
| A-3 | **"Saya lebih hemat membeli di mana?"** bisa berarti per produk atau per keranjang belanja. | Perbandingan per keranjang butuh logika produk yang beririsan antar toko. Itu fitur yang jauh lebih besar. | MVP: per produk dan per Product Group. Perbandingan keranjang ditunda. |
| A-4 | **Tren memakai harga apa?** Jika promo dan normal dicampur, tren akan naik-turun tidak karuan. | Menentukan isi ringkasan tren. | Tren memakai harga efektif per satuan, dengan opsi tampilan "hanya harga normal". Ambang data minimal (D-15) cukup jadi parameter konfigurasi, bukan bagian domain. |
| A-5 | **Definisi "bundle" belum jelas.** Bisa berarti "beli 2 gratis 1" (promo kuantitas), paket campuran beberapa produk, atau hadiah. | Promo kuantitas sebetulnya bisa dihitung per satuan. Paket campuran tidak bisa. | Bedakan dua hal. *Promo kuantitas* dicatat sebagai harga promo dengan kuantitas syarat, dan **boleh** ikut harga terbaik. *Bundle campuran* diberi flag dan tidak ikut perhitungan (sesuai D-08). |
| A-6 | **Alias "per jaringan toko"**: bagaimana dengan Alfamart vs Alfamidi yang satu grup dan mungkin memakai kode atau teks struk yang sama? | Menentukan apakah alias menempel ke Store atau ke Store Group. | Alias tetap per Store (D-13). Saat matching, alias dari Store lain dalam grup yang sama dipakai sebagai **kandidat**, bukan exact match. |

### 2.2 Requirement yang bertentangan

| # | Temuan | Rekomendasi |
|---|---|---|
| K-1 | **"Ringkasan dihitung ulang setiap ada koreksi" (§5.10) vs "termurah 90 hari terakhir" (D-02).** Jendela 90 hari bergeser setiap hari walaupun tidak ada koreksi, sehingga ringkasan basi jika hanya dipicu oleh koreksi. | Ringkasan dihitung ulang karena dua pemicu: perubahan data **dan** pergeseran waktu (job harian untuk record yang keluar dari jendela). Alternatifnya: ringkasan hanya menyimpan all-time, dan angka 90 hari dihitung saat query. Lihat Q-07. |
| K-2 | **"Gambar asli selalu disimpan" (§3) vs UU PDP (§6).** Struk berisi PII. Menyimpan gambar selamanya bertentangan dengan prinsip minimisasi data. | Tetapkan kebijakan retensi: gambar disimpan N bulan atau sampai user menghapus. Teks OCR mentah disimpan setelah PII disamarkan. Hapus akun = hapus gambar. Lihat Q-08. |
| K-3 | **Merge produk global (§5.1) vs data privat per household (D-03).** Merge produk global harus memindahkan histori harga milik *semua* household, padahal RLS menyatakan tidak ada yang boleh menyentuh data household lain. | Merge produk global adalah **operasi sistem** (service role), bukan operasi user. User hanya boleh merge produk privat miliknya sendiri. |

### 2.3 Requirement yang bisa membuat desain database buruk

| # | Temuan | Risiko | Rekomendasi |
|---|---|---|---|
| B-1 | Purchase dan Observation didefinisikan sebagai dua konsep di glosarium. | Jika diterjemahkan menjadi dua tabel, setiap query harga harus memakai UNION, ringkasan dihitung dari dua sumber, dan aturan RLS ganda. | U-01. |
| B-2 | Harga per satuan "dihitung otomatis" lalu disimpan. | Jika ukuran produk global dikoreksi (misal 200g ternyata 250g), harga per satuan di **semua household** ikut salah. | Harga per satuan disimpan untuk keperluan query, tetapi diperlakukan sebagai **nilai turunan**. Koreksi ukuran produk memicu hitung ulang massal secara asinkron. |
| B-3 | Merge: "alias, barcode, dan histori pindah ke produk pengganti". | Jika semua referensi ditulis ulang sekaligus, satu merge bisa memperbarui jutaan baris. | Dua lapis: produk lama menyimpan rujukan `digantikan_oleh`. Penulisan ulang referensi dilakukan bertahap oleh job latar belakang, dan query mengikuti rujukan selama proses belum selesai. |
| B-4 | Seller marketplace dimodelkan sebagai Branch (D-06). | Jumlah seller bisa jutaan, jauh lebih banyak dari cabang fisik. Jika Branch berada di dalam aggregate Store, aggregate itu meledak. | Branch menjadi aggregate sendiri (bagian 5). |

### 2.4 Entity yang belum disebut di requirement

Entity berikut tidak ada di glosarium, tetapi dibutuhkan oleh business rule yang sudah ada.

| Entity | Dibutuhkan oleh |
|---|---|
| Unit (+ Dimension) | §5.2: konversi hanya valid dalam dimensi yang sama |
| Brand | §5.1: produk punya brand. Normalisasi "Nestle" / "NESTLÉ" |
| Barcode Assignment (dengan periode berlaku) | D-18 |
| Member Program, Program Membership | D-10 |
| Household Membership | D-04: household berisi banyak user |
| Capture (unggahan) + Image + Processing Run | §3: status pemrosesan, data mentah disimpan, struk multi-gambar |
| Alias Confirmation | §5.9: alias dipromosikan setelah dikonfirmasi banyak user |
| Store Group | §10: hierarki Alfamart vs Alfamidi |
| Price Summary (read model) | §6: ringkasan dihitung di muka |
| Public Price Fact (proyeksi) | D-07, U-04 |

### 2.5 Business rule yang perlu diperjelas

| # | Pertanyaan |
|---|---|
| BR-1 | **Split produk** disebut sebagai edge case (§10), tetapi tidak ada aturannya. Histori lama ikut ke produk yang mana? Usulan: split = buat produk baru, lalu user memindahkan record satu per satu. Tidak ada pemindahan otomatis. |
| BR-2 | Siapa yang boleh **membuat produk global** di MVP? Usulan: produk baru dari user selalu privat. Produk masuk katalog global hanya lewat kurasi (admin atau aturan promosi seperti alias). |
| BR-3 | Bolehkah household **mengubah kategori produk global** untuk dirinya sendiri? Jika boleh, dibutuhkan entity override per household. |
| BR-4 | Price Record **tanpa cabang**: label harga tanpa sesi belanja dan tanpa pilihan manual. Usulan: Store wajib, Branch opsional. Jika Branch kosong, record tetap ikut harga terbaik dengan label "cabang tidak diketahui". |
| BR-5 | Apa itu "dikonfirmasi banyak user" untuk promosi alias? Usulan: N household berbeda (misalnya 3) memetakan teks + Store yang sama ke produk global yang sama, tanpa ada pemetaan tandingan. |
| BR-6 | Jika alias household **bertentangan** dengan alias global, mana yang menang? Usulan: alias household menang untuk household itu sendiri. |
| BR-7 | Harga marketplace **belum termasuk ongkir** (§10). Apakah ongkir disimpan? Usulan: ongkir disimpan sebagai info (seperti cashback) dan tidak masuk harga efektif. Ini konsisten dengan D-14. |
| BR-8 | Saat user keluar dari household atau menghapus akun: data milik household tetap ada. Kontribusi publik yang sudah anonim tetap ada. Data identitas user dihapus. Perlu dikonfirmasi. |

### 2.6 Edge case tambahan

- **Promo kuantitas bertingkat**: harga 1 pcs Rp10.000, tetapi 3 pcs Rp25.000.
- **Diskon yang menempel ke beberapa item sekaligus** ("diskon paket Rp5.000" di bawah 2 item).
- **Struk lintas tengah malam**, atau struk tanpa jam. Tanggal transaksi cukup tanggal saja, jam opsional.
- **Kode PLU sama di dua toko berbeda** untuk produk berbeda. Barcode internal harus dibatasi per Store.
- **Barcode dipakai ulang oleh produsen** untuk produk lain setelah bertahun-tahun. Inilah alasan barcode punya periode berlaku.
- **Satu foto label berisi beberapa produk** (rak dengan banyak label), atau satu screenshot berisi banyak listing.
- **Sesi belanja lupa ditutup**, sehingga label harga keesokan harinya masuk ke cabang yang salah. Sesi perlu kedaluwarsa otomatis.
- **Struk yang sama diunggah oleh dua anggota household** (pasca-MVP).
- **Mata uang berbeda dalam satu Product Group** (belanja di luar negeri). Perbandingan lintas mata uang ditolak, bukan dikonversi.

---

## 3. Domain Model

Entity dikelompokkan menjadi enam bounded context. Kolom **AR** menunjukkan apakah entity tersebut Aggregate Root.

### 3.1 Identity & Tenancy

| Entity | Tujuan | Kenapa dipisah | Lifecycle | AR | Child | Value Object |
|---|---|---|---|---|---|---|
| **User** | Identitas orang yang login. | Satu user bisa ikut beberapa household di masa depan. Identitas login ditangani Supabase Auth. | dibuat saat daftar → aktif → dihapus (identitas dianonimkan) | Ya | — | Profil (nama, preferensi) |
| **Household** | Pemilik semua data privat. Batas tenant untuk RLS. | Merupakan unit isolasi (D-04). | dibuat otomatis saat user pertama daftar → aktif → diarsipkan | Ya | Household Membership, Program Membership | Pengaturan (mata uang default, zona waktu) |
| **Household Membership** | Menghubungkan User ke Household beserta perannya. | Relasinya banyak-ke-banyak dan punya atribut (peran, tanggal bergabung). | diundang → aktif → keluar | Tidak (child Household) | — | Peran (owner / member) |
| **Program Membership** | Penanda bahwa household ikut program member tertentu (D-10). | Dibutuhkan untuk menentukan apakah harga member berlaku (A-2). | ditandai → dicabut | Tidak (child Household) | — | — |

### 3.2 Catalog

| Entity | Tujuan | Kenapa dipisah | Lifecycle | AR | Child | Value Object |
|---|---|---|---|---|---|---|
| **Unit** | Satuan ukur (gram, ml, pcs, …) beserta dimensi dan faktor konversi ke satuan dasar. | Aturan dimensi (§5.2) harus bisa ditegakkan. | Data referensi sistem, jarang berubah. | Ya (data referensi) | — | Dimensi (massa / volume / jumlah / panjang) |
| **Brand** | Merek produk. | Normalisasi nama merek, dan nanti berguna untuk perbandingan lintas brand. | aktif → di-merge | Ya | — | — |
| **Category** | Pengelompokan untuk perbandingan lintas brand (D-09). | Hybrid: ada kategori bawaan sistem dan kategori buatan user (§5.8). | aktif → diarsipkan | Ya | — | — |
| **Product Group** | Keluarga produk lintas ukuran ("Milo Original"). | Dasar perbandingan antar ukuran (D-09). | aktif → di-merge | Ya | — | — |
| **Product (SKU)** | Identitas produk yang punya harga. | Ukuran adalah bagian dari identitas. | `aktif` → `merged` (simpan rujukan ke pengganti) / `diarsipkan` | Ya | Barcode Assignment | **Ukuran Kemasan** (`jumlah isi × ukuran per isi × unit`), **Mode Jual** (per unit / per berat), Varian |
| **Barcode Assignment** | Menghubungkan nilai barcode ke produk dalam periode tertentu. | Barcode bisa berpindah produk (shrinkflation, D-18). Kode PLU berlaku per Store. | berlaku sejak → berakhir | Tidak (child Product) | — | **Periode Berlaku**, Jenis Kode (global EAN / PLU toko) |
| **Product Alias** | Teks OCR atau judul listing yang dipetakan ke produk, per Store. | Volume tinggi, ditulis oleh banyak household, dan punya siklus promosi sendiri. | `household` → (cukup konfirmasi) → `global`. Bisa juga `dicabut`. | Ya | Alias Confirmation | Teks ternormalisasi |
| **Alias Confirmation** | Catatan bahwa household X memetakan teks ini ke produk ini. | Dasar penghitungan promosi alias ke global (BR-5). | dibuat → dibatalkan | Tidak (child Alias) | — | — |

### 3.3 Store

| Entity | Tujuan | Kenapa dipisah | Lifecycle | AR | Child | Value Object |
|---|---|---|---|---|---|---|
| **Store Group** | Grup usaha (Alfa Group: Alfamart, Alfamidi). | Hierarki grup (§10). Opsional. | aktif | Ya | — | — |
| **Store** | Jaringan toko atau platform (AEON, Alfamart, Shopee). | Alias dan program member berlaku per Store. | aktif → tidak aktif / rebrand | Ya | Member Program | Jenis (`offline` / `online`) |
| **Member Program** | Program member milik Store ("AEON Member"). | Harga member terikat ke program tertentu (D-10). | aktif → dihentikan | Tidak (child Store) | — | — |
| **Branch** | Cabang fisik atau seller marketplace. | Harga antar cabang bisa berbeda. Jumlahnya sangat besar (B-4). | `buka` → `tutup` / `pindah` / `rebrand` (rujukan ke Branch penerus). Histori tetap ada. | Ya | — | **Lokasi** (alamat, kota, wilayah), Jenis (fisik / seller) |

### 3.4 Capture & Processing

| Entity | Tujuan | Kenapa dipisah | Lifecycle | AR | Child | Value Object |
|---|---|---|---|---|---|---|
| **Capture** | Satu unggahan logis dari user: struk, label, atau screenshot. Bisa terdiri dari banyak gambar. | Unit pemrosesan asinkron. Menyimpan status pipeline (§3). | `uploaded → processing → needs_confirmation → done` / `failed` | Ya | Image, Processing Run | Jenis Capture, Status |
| **Image** | Satu file gambar beserta urutannya dalam Capture. | Struk panjang bisa multi-gambar (§5.7). Hash per gambar dipakai untuk deteksi duplikat. | disimpan → dihapus (retensi, K-2) | Tidak (child Capture) | — | Hash gambar, lokasi file |
| **Processing Run** | Satu kali percobaan OCR + AI untuk sebuah Capture: teks mentah, output AI mentah, versi model, biaya. | Capture bisa diproses ulang (§3). Setiap percobaan disimpan untuk audit dan pengukuran akurasi. Menggantikan "OCR Result" dan "AI Result" di daftar contoh. | dimulai → selesai / gagal | Tidak (child Capture) | — | Metadata model, Biaya |
| **Shopping Session** | "Saya sedang belanja di AEON BSD." Menentukan cabang untuk label harga (D-11). | Konteks yang dipakai bersama oleh beberapa Capture. | `aktif` → `ditutup` / `kedaluwarsa` (otomatis) | Ya | — | Rentang waktu |

### 3.5 Pricing

| Entity | Tujuan | Kenapa dipisah | Lifecycle | AR | Child | Value Object |
|---|---|---|---|---|---|---|
| **Receipt** | Header transaksi: toko, cabang, tanggal transaksi, total, voucher, metode bayar (D-19). | Unit yang dicek terhadap total dan dideteksi duplikatnya. Mengandung PII. | `draft` (hasil parsing) → `dikonfirmasi` → `dikoreksi`* / `dibuang` (duplikat) | Ya | Receipt Line, Receipt Adjustment | **Sidik Jari** (store + tanggal + total), **Uang** (jumlah + mata uang), Info Pembayaran (PII) |
| **Receipt Line** | Satu baris struk apa adanya: produk, diskon, non-produk, void, atau pajak. | Semua baris dibutuhkan untuk pengecekan total. Baris diskon menempel ke baris lain (§5.7). | dibuat dari parsing → dikoreksi* | Tidak (child Receipt) | — | Jenis Baris, Kuantitas, Uang, **Info Matching** (tier, confidence, hasil) |
| **Receipt Adjustment** | Voucher, cashback, atau poin di level struk. | Tidak dialokasikan ke item (D-01, D-14). | dibuat → dikoreksi* | Tidak (child Receipt) | — | Jenis, Uang |
| **Price Record** | **Satu titik histori harga** sebuah produk di sebuah toko pada tanggal tertentu. Menyatukan Purchase dan Observation (U-01). | Sumber data untuk semua analisis harga. | `aktif` → `dikoreksi`* / `dibatalkan`. Produk bisa dipindah karena merge. | Ya | — | **Harga** (normal, promo, member + program, efektif), **Harga per Satuan** (turunan), **Kuantitas / Berat Aktual**, **Periode Promo**, Jenis Sumber, Flag Bundle, Visibilitas, Info Matching, Info tambahan (cashback, ongkir) |

\* Koreksi tidak mengubah lifecycle utama, tetapi selalu tercatat di Audit Log.

**Aturan turunan (U-02):**
- Purchase: `Receipt Line (jenis = produk, sudah ter-match)` → menghasilkan tepat satu `Price Record`. Koreksi angka dilakukan di Receipt Line, lalu Price Record dibentuk ulang. Koreksi produk dilakukan di Price Record.
- Observation: `Capture (label / screenshot)` → menghasilkan satu atau lebih `Price Record` secara langsung. Price Record itulah sumber kebenarannya.

### 3.6 Read Model & Governance

Entity di bagian ini **bukan** bagian dari model transaksi. Semuanya bisa dibangun ulang dari data sumber, kecuali Audit Log.

| Entity | Tujuan | Sifat | Lifecycle |
|---|---|---|---|
| **Price Summary** | Ringkasan per household × produk: harga terbaik 90 hari dan all-time (beserta rujukan ke record-nya), harga terakhir, tren, jumlah data, tanggal terakhir. | Read model (§6, §7). Bisa dibangun ulang kapan saja. | dihitung ulang saat data berubah **dan** saat jendela waktu bergeser (K-1) |
| **Public Price Fact** | Salinan anonim dari Price Record yang di-opt-in: produk global, store, branch, tanggal, dan harga. **Tanpa** household. | Proyeksi (U-04). Hanya untuk produk dan toko global. | dibuat saat opt-in → dicabut saat user menarik persetujuan |
| **Audit Log** | Catatan setiap koreksi: siapa, kapan, entity apa, sebelum, sesudah (§5.10). | Append-only. Tidak pernah diubah. | dibuat → dihapus sesuai retensi |
| **Match Quality Metric** | Persentase auto-match / dikonfirmasi / dikoreksi (§6). | Turunan dari Info Matching dan Audit Log. Bisa berupa view, tidak harus disimpan. | — |

### 3.7 Value Object (lintas entity)

| Value Object | Isi | Dipakai oleh |
|---|---|---|
| **Uang** | jumlah desimal + mata uang | Receipt, Receipt Line, Price Record |
| **Ukuran Kemasan** | jumlah isi, ukuran per isi, unit | Product |
| **Harga** | normal, promo, member (+ program), efektif | Price Record |
| **Periode** | mulai, selesai (opsional) | Barcode Assignment, Periode Promo, Shopping Session |
| **Info Matching** | tier (barcode / alias / fuzzy / AI / manual), confidence, hasil (auto / dikonfirmasi / dikoreksi) | Receipt Line, Price Record |
| **Sidik Jari Struk** | store, tanggal, total | Receipt |
| **Lokasi** | alamat, kota, wilayah | Branch |

---

## 4. Relationship

Notasi: `A ─< B` berarti satu A punya banyak B. `A ── B` berarti satu-ke-satu. `A ··> B` berarti merujuk.

### 4.1 Tenancy

```
User >─< Household            (lewat Household Membership)
Household ─< Program Membership >── Member Program
```

### 4.2 Katalog

```
Category (hierarki opsional)
   │
Product Group ─< Product ─< Barcode Assignment
   │               │ ··> Brand
   │               │ ··> Unit (lewat Ukuran Kemasan)
   │               │ ··> Product (digantikan_oleh, jika merged)
   │               │
   │               └─< Product Alias ─< Alias Confirmation >── Household
   │                        ··> Store
   └ ··> Category
```

- Product dan Product Group bisa global atau milik household (hybrid).
- Kode PLU di Barcode Assignment merujuk ke Store.

### 4.3 Store

```
Store Group ─< Store ─< Branch
                 │        ··> Branch (penerus, jika rebrand/pindah)
                 └─< Member Program
```

### 4.4 Alur data harga

```
Household
   ├─< Shopping Session ··> Branch
   │
   ├─< Capture ─< Image
   │      │    ─< Processing Run
   │      │ ··> Shopping Session (opsional)
   │      │
   │      ├── (struk) ──> Receipt ─< Receipt Line ─── Price Record
   │      │                  │     ─< Receipt Adjustment
   │      │                  ··> Store, Branch
   │      │
   │      └── (label / screenshot) ──────────────────< Price Record
   │
   └─< Price Record ··> Product, Store, Branch (opsional), Member Program (opsional)
          │
          ├──> Price Summary   (per household × produk)
          └──> Public Price Fact (jika opt-in)
```

### 4.5 Rantai jawaban pertanyaan inti

```
Household → Price Record → Product → Product Group  (bandingkan ukuran)
                         → Branch → Store           (di mana termurah)
                         → Product → Category       (bandingkan lintas brand)
```

---

## 5. Aggregate Boundary

Prinsipnya: aggregate = batas konsistensi transaksi. Aggregate lain dirujuk lewat identitas saja, tidak dimuat bersama.

| Aggregate | Isi | Alasan |
|---|---|---|
| **Household** | Household, Household Membership, Program Membership | Keanggotaan dan peran harus konsisten bersama (misalnya selalu ada minimal 1 owner). Data harga **tidak** masuk ke sini. Data itu hanya *merujuk* household, kalau tidak aggregate ini akan sangat besar. |
| **User** | User | Siklus hidupnya mengikuti autentikasi, terpisah dari household. |
| **Product** | Product, Barcode Assignment | Barcode bagian dari identitas produk, dan periode berlakunya diatur bersama produk (shrinkflation). *Catatan:* invariant "satu barcode hanya aktif di satu produk pada satu waktu" berlaku **lintas** aggregate, jadi harus ditegakkan oleh constraint database di Tahap 2b. |
| **Product Group** | Product Group | Dirujuk oleh banyak Product. Jika produk dimasukkan ke dalamnya, group populer akan jadi aggregate raksasa. |
| **Product Alias** | Alias, Alias Confirmation | Ditulis oleh banyak household secara bersamaan. Jika berada di aggregate Product, akan terjadi perebutan kunci (contention). Promosi ke global adalah invariant milik alias itu sendiri. |
| **Brand**, **Category**, **Unit** | masing-masing sendiri | Data referensi sederhana. |
| **Store** | Store, Member Program | Program member tidak bermakna tanpa Store-nya. |
| **Store Group** | Store Group | Opsional, hanya dirujuk. |
| **Branch** | Branch | Jumlahnya besar (seller marketplace). Dibuat dan ditutup secara independen (B-4). |
| **Capture** | Capture, Image, Processing Run | Status pipeline, gambar, dan hasil proses berubah bersama dalam satu alur. |
| **Shopping Session** | Shopping Session | Konteks berumur pendek, dipakai oleh banyak Capture. |
| **Receipt** | Receipt, Receipt Line, Receipt Adjustment | Invariant: jumlah baris dicek terhadap total, dan baris diskon menempel ke baris produk. Semuanya harus konsisten dalam satu transaksi. |
| **Price Record** | Price Record (masing-masing berdiri sendiri) | Bukan child Receipt, karena (1) observasi tidak punya struk, (2) koreksi produk pada satu record tidak perlu mengunci seluruh struk, dan (3) query harga selalu lintas struk. |

**Bukan aggregate:** Price Summary dan Public Price Fact (proyeksi), Audit Log (append-only), Match Quality Metric (view).

### 5.1 Operasi lintas aggregate

Di sinilah desain biasanya patah. Setiap operasi berikut **tidak** atomik dan berjalan sebagai proses asinkron yang bisa diulang dengan aman (idempotent).

| Operasi | Aggregate yang disentuh | Usulan alur |
|---|---|---|
| **Konfirmasi struk** | Receipt → Price Record (banyak) → Price Summary | Receipt dikonfirmasi → Price Record dibuat per baris produk → event "harga berubah" → Summary dihitung ulang. |
| **Koreksi data** | Receipt / Price Record → Audit Log → Price Summary | Ubah data, tulis Audit Log dalam transaksi yang sama, lalu kirim event untuk hitung ulang Summary. |
| **Merge produk privat** | Product, Alias, Barcode, Price Record, Summary (satu household) | Tandai produk lama `merged` + rujukan pengganti → pindahkan alias dan barcode → pindahkan Price Record → hitung ulang Summary. Selama proses berjalan, query mengikuti rujukan. |
| **Merge produk global** | Sama seperti di atas, tetapi **lintas household** | Operasi sistem (K-3). Job latar belakang bertahap. User tidak bisa memicunya. |
| **Promosi alias** | Alias, Alias Confirmation | Konfirmasi ke-N dari household berbeda → status alias menjadi `global`. |
| **Koreksi ukuran produk global** | Product → Price Record (semua household) → Summary | Hitung ulang harga per satuan secara massal (B-2). |
| **Opt-in publik** | Price Record → Public Price Fact | Salin field yang aman. Saat opt-out, hapus salinannya. |

---

## 6. Data Ownership Matrix

Kolom:
- **Owner**: `System` = dikelola aplikasi atau admin, sama untuk semua. `Household` = milik satu household. `Hybrid` = ada baris milik sistem (global) dan ada baris milik household.
- **Visibilitas**: siapa yang boleh membaca.
- **PII**: berisi data pribadi menurut UU PDP.

| Entity | Owner | Visibilitas | PII | Alasan |
|---|---|---|---|---|
| User | — (diri sendiri) | Hanya user itu sendiri, plus anggota household yang sama (nama saja) | Ya | Data identitas. |
| Household | Household | Anggota household | Rendah | Batas tenant. |
| Household Membership | Household | Anggota household | Rendah | — |
| Program Membership | Household | Anggota household | Ya | Mengungkap toko yang sering dikunjungi. |
| Unit | System | Semua | — | Data referensi. |
| Brand | **Hybrid** | Global: semua. Privat: household pemilik. | — | User bisa mencatat merek lokal yang belum ada di katalog. |
| Category | **Hybrid** | Global: semua. Privat: household pemilik. | — | §5.8. |
| Product Group | **Hybrid** | Global: semua. Privat: household pemilik. | — | D-03. |
| Product | **Hybrid** | Global: semua. Privat: household pemilik. | — | D-03. Produk privat bisa dipromosikan ke global lewat kurasi (BR-2). |
| Barcode Assignment | Mengikuti Product | Mengikuti Product | — | Child dari Product. |
| Product Alias | **Hybrid** | Global: semua (untuk matching). Household: household pemilik. | Rendah | §5.9. Teks alias bisa saja berisi nama orang jika OCR salah baca, sehingga perlu disaring sebelum dipromosikan. |
| Alias Confirmation | Household | Household pemilik + sistem (untuk penghitungan) | — | Dasar promosi. Tidak boleh terlihat oleh household lain. |
| Store Group | System | Semua | — | — |
| Store | **Hybrid** | Global: semua. Privat: household pemilik. | — | Warung kecil yang tidak ada di katalog. |
| Member Program | System | Semua | — | — |
| Branch | **Hybrid** | Global: semua. Privat: household pemilik. | Rendah | Cabang privat bisa berupa "warung depan rumah", yang secara tidak langsung mengungkap lokasi rumah. |
| Shopping Session | Household | Household pemilik | **Ya** | Pola lokasi dan waktu belanja. |
| Capture | Household | Household pemilik | **Ya** | — |
| Image | Household | Household pemilik | **Ya** | Gambar struk mentah. Butuh kebijakan retensi (K-2). |
| Processing Run | Household | Household pemilik + sistem (pengukuran akurasi) | **Ya** | Teks OCR mentah memuat PII. |
| Receipt | Household | Household pemilik | **Ya** | Digit kartu, nama member, nomor HP. |
| Receipt Line | Household | Household pemilik | Rendah | — |
| Receipt Adjustment | Household | Household pemilik | Rendah | — |
| Price Record | Household | Household pemilik | Rendah | Harga privat secara default. Kombinasi cabang + waktu tetap bisa mengungkap pola hidup. |
| Price Summary | Household | Household pemilik | Rendah | Turunan dari Price Record. |
| Public Price Fact | System | Semua | Tidak | Proyeksi anonim (U-04). Hanya berisi produk dan toko global. Tanggal sebaiknya dibulatkan, misalnya per hari tanpa jam, untuk mengurangi risiko re-identifikasi. |
| Audit Log | Household | Household pemilik + admin | Ya | Berisi nilai sebelum dan sesudah koreksi. |
| Match Quality Metric | System | Admin | Tidak | Agregat. |

**Implikasi untuk RLS:**
1. Entity milik `Household`: satu aturan seragam, yaitu "baris milik household tempat user menjadi anggota".
2. Entity `Hybrid`: "baris global ATAU baris milik household user". Baris global hanya bisa ditulis oleh sistem.
3. Entity `System`: baca untuk semua, tulis hanya untuk sistem.
4. Operasi lintas household (merge global, promosi alias, hitung ulang massal) berjalan dengan service role di backend, tidak pernah dari klien.

---

## 7. Review

### 7.1 Uji telusur: 6 pertanyaan inti (§1)

| Pertanyaan | Jalur | Status |
|---|---|---|
| Berapa harga termurah produk ini? | Price Summary (household, produk) → harga terbaik 90 hari + all-time | ✅ Dengan syarat A-1 dan A-2 diputuskan. |
| Di toko dan cabang mana harga termurah? | Price Summary → rujukan Price Record → Branch → Store | ✅ Jika Branch kosong, tampilkan Store saja (BR-4). |
| Naik atau turun dibanding bulan lalu? | Price Record (household, produk) per tanggal transaksi → tren di Summary | ⚠️ Tergantung A-4 (harga mana yang dipakai untuk tren). |
| Berapa harga per gram / satuan? | Price Record.harga efektif ÷ (Ukuran Kemasan → Unit → satuan dasar) | ✅ Untuk produk timbang: harga ÷ berat aktual. |
| Apakah 500g lebih murah dari 200g? | Product Group → Product (beberapa) → Price Summary masing-masing → bandingkan harga per satuan, hanya jika dimensinya sama | ✅ |
| Lebih hemat beli di mana? | Price Record (household, produk) dikelompokkan per Store/Branch | ⚠️ Per produk bisa. Per keranjang belum bisa (A-3). |

### 7.2 Uji telusur: edge case (§10)

| Edge case | Penanganan di model | Status |
|---|---|---|
| Baris non-produk, diskon, void | Receipt Line dengan Jenis Baris. Hanya baris produk yang menghasilkan Price Record. Diskon menempel ke baris produk. | ✅ |
| Kuantitas "2 × 19.500" | Receipt Line.kuantitas. Price Record menyimpan harga per item dan kuantitasnya. | ✅ |
| Struk multi-gambar | Capture ─< Image | ✅ |
| Tanggal transaksi ≠ tanggal upload | Receipt / Price Record menyimpan tanggal transaksi. Capture menyimpan tanggal unggah. | ✅ |
| Satu produk banyak barcode | Product ─< Barcode Assignment | ✅ |
| Shrinkflation | Product baru di Product Group yang sama. Barcode Assignment lama ditutup periodenya. | ✅ |
| PLU produk timbang | Barcode Assignment jenis PLU, dibatasi per Store | ✅ |
| Label tanpa info cabang | Shopping Session → Branch. Fallback pilihan manual. Fallback terakhir: Branch kosong (BR-4). | ⚠️ Butuh keputusan BR-4. |
| Dua harga dalam satu label | Value object Harga (normal + promo/member) dalam satu Price Record | ✅ |
| Periode promo | Value object Periode Promo di Price Record | ✅ |
| Label salah tempel | Koreksi oleh user → Audit Log | ✅ |
| Marketplace: ongkir, voucher | Info tambahan, tidak masuk harga efektif (BR-7) | ⚠️ Butuh konfirmasi. |
| Marketplace: barang beda dari judul listing | Koreksi produk di Price Record. Alias marketplace dicabut. | ✅ |
| Alfamart vs Alfamidi | Store Group ─< Store | ✅ |
| Cabang tutup / rebrand | Lifecycle Branch + rujukan ke Branch penerus | ✅ |
| Harga zona per wilayah | Lokasi.wilayah di Branch. Analisis per zona bisa dilakukan lewat query. | ✅ Cukup untuk MVP. |
| Koreksi data lama | Audit Log + hitung ulang Summary | ✅ |
| Merge produk | Lifecycle Product + operasi lintas aggregate (5.1) | ✅ |
| Split produk | — | ❌ Belum ada aturan (BR-1). |
| Struk duplikat | Hash per Image + Sidik Jari Receipt. Status `dibuang` jika user memilih. | ✅ |

### 7.3 Temuan desain

**Relasi melingkar**
- `Product ··> Product (digantikan_oleh)`: rantai merge bisa membentuk siklus (A→B→A). Butuh invariant: tujuan merge harus produk `aktif`, dan rantai dipadatkan (A→C langsung, bukan A→B→C).
- `Branch ··> Branch (penerus)`: risiko yang sama, aturan yang sama.
- `Price Summary ··> Price Record` dan Price Record → Summary: ini **bukan** masalah, karena Summary adalah read model satu arah.
- Capture, Receipt, dan Shopping Session: arah relasinya satu arah (Receipt → Capture, Capture → Session). Tidak ada siklus.

**Entity duplikat (sudah diselesaikan di model ini)**
- Purchase + Observation → **Price Record** (U-01).
- OCR Result + AI Result → **Processing Run**.
- Currency → value object di dalam **Uang**, bukan entity. Mata uang cukup kode ISO.

**Entity terlalu besar**
- **Price Record** punya banyak field: harga normal, promo, member, efektif, per satuan, kuantitas, berat, periode promo, flag, visibilitas, dan info matching. Masih wajar karena semuanya fakta dari satu titik harga yang selalu dibaca bersama. Alternatifnya, harga dipecah menjadi child "Price Point" per tipe harga. Itu lebih fleksibel, tetapi setiap query harga terbaik jadi butuh join. **Rekomendasi: tetap satu entity**, karena tipe harganya tetap (normal / promo / member).
- **Product** punya dua mode (per unit vs per berat) dan model multipack. Masih wajar sebagai value object Ukuran Kemasan + Mode Jual.

**Aggregate terlalu besar (sudah dihindari)**
- Store + semua Branch → dipisah (B-4).
- Product + semua Alias → dipisah.
- Household + semua datanya → hanya keanggotaan yang masuk aggregate.

**Potensi redundansi**

| Data | Diduplikasi di | Alasan diterima | Risiko |
|---|---|---|---|
| Nominal harga pembelian | Receipt Line + Price Record | Bukti mentah vs interpretasi (U-02) | Tidak sinkron. Mitigasi: Price Record diturunkan satu arah. |
| Harga per satuan | Price Record (tersimpan) | Kecepatan query | Basi jika ukuran produk dikoreksi (B-2) |
| Harga terbaik / tren | Price Summary | Kecepatan search (§6) | Basi karena waktu (K-1) |
| Harga publik | Public Price Fact | Anonimitas (U-04) | Basi saat opt-out. Mitigasi: hapus saat opt-out. |
| Store pada Price Record | Store bisa diturunkan dari Branch | Branch boleh kosong (BR-4) | Tidak konsisten dengan Branch. Mitigasi: invariant "Branch harus milik Store yang sama". |

**Potensi bottleneck**

| Area | Kenapa | Arah mitigasi (detail di 2b) |
|---|---|---|
| Volume Price Record | 100 ribu household × ~50 item/minggu ≈ **260 juta baris/tahun** | Partisi berdasarkan waktu. Semua query dibatasi per household. |
| Hitung ulang Summary | Dipicu oleh setiap konfirmasi, koreksi, dan pergeseran jendela 90 hari | Antrean asinkron, hitung per (household, produk) yang berubah saja |
| Fan-out koreksi produk global | Satu koreksi produk global menyentuh data banyak household | Job latar belakang bertahap |
| Matching alias / fuzzy | Setiap baris struk mencari ke katalog global | Cache alias per Store, pencarian teks terindeks |
| Penyimpanan gambar | Gambar adalah data terbesar | Kebijakan retensi (K-2), kompresi |
| Biaya AI | Setiap baris yang gagal matching deterministik memanggil AI | Sudah diantisipasi oleh matching bertingkat. Metrik kualitas memantau rasionya. |

### 7.4 Penilaian

Skor angka sengaja tidak diberikan. Sebagai gantinya, kelayakan dinilai dengan uji telusur di atas:

- Pertanyaan inti: **4 dari 6** tuntas. 2 bergantung pada keputusan A-3 dan A-4.
- Edge case: **17 dari 20** tuntas. 2 butuh konfirmasi (BR-4, BR-7). 1 belum ada aturannya (split, BR-1).

### 7.5 Layak lanjut ke Tahap 2b?

**Belum, tetapi tinggal sedikit.** Strukturnya sudah stabil. Yang tersisa adalah keputusan bisnis yang mengubah *isi* entity, bukan *bentuk*-nya. Tujuh pertanyaan blocking (Q-01 sampai Q-07) perlu dijawab dulu, karena masing-masing menentukan field, aturan, atau constraint yang harus ada di desain fisik. Pertanyaan lain bisa diputuskan sambil jalan.

---

## 8. Pertanyaan untuk Didiskusikan

Setiap pertanyaan disertai usulan default. Jika kamu setuju dengan semua default, cukup jawab "setuju semua" dan Tahap 2b bisa dimulai.

### Blocking (harus diputuskan sebelum Tahap 2b)

| ID | Pertanyaan | Usulan default |
|---|---|---|
| **Q-01** | Setuju Purchase + Observation disatukan menjadi **Price Record**, dengan Receipt Line terpisah sebagai bukti mentah? (U-01, U-02) | Ya |
| **Q-02** | Harga efektif untuk observasi = harga terendah yang berlaku untuk household pada tanggal itu? (A-1) | Ya |
| **Q-03** | Harga member hanya ikut harga terbaik jika household menandai keanggotaannya? (A-2) | Ya |
| **Q-04** | Branch boleh kosong pada Price Record, asalkan Store terisi? (BR-4) | Ya |
| **Q-05** | Produk, Store, dan Branch baru dari user selalu dibuat **privat**. Masuk katalog global hanya lewat kurasi? (BR-2) | Ya. Di MVP, kamu sendiri yang menjadi kurator. |
| **Q-06** | Merge produk global adalah operasi sistem, bukan operasi user? (K-3) | Ya |
| **Q-07** | Harga terbaik 90 hari: disimpan di Summary dan diperbarui oleh job harian, atau dihitung saat query? (K-1) | Disimpan + job harian. Search tetap cepat sesuai §6. |

### Non-blocking (bisa diputuskan sambil jalan)

| ID | Pertanyaan | Usulan default |
|---|---|---|
| Q-08 | Retensi gambar struk? (K-2) | Simpan 12 bulan, lalu hapus. Teks OCR mentah disimpan setelah PII disamarkan. |
| Q-09 | Tren memakai harga efektif atau harga normal? (A-4) | Harga efektif, dengan opsi "hanya normal". |
| Q-10 | Bedakan promo kuantitas dari bundle campuran? (A-5) | Ya. Promo kuantitas ikut harga terbaik. Bundle campuran tidak. |
| Q-11 | Ambang promosi alias ke global? (BR-5) | 3 household berbeda, tanpa pemetaan tandingan. |
| Q-12 | Ongkir marketplace disimpan sebagai info? (BR-7) | Ya, tidak mengurangi atau menambah harga efektif. |
| Q-13 | Aturan split produk? (BR-1) | Buat produk baru, lalu pindahkan record secara manual. Tidak ada pemindahan otomatis. |
| Q-14 | Override kategori produk global per household? (BR-3) | Tidak untuk MVP. |
| Q-15 | "Lebih hemat di mana" per keranjang? (A-3) | Ditunda setelah MVP. |
| Q-16 | Brand sebagai entity sendiri, atau cukup teks di Product? | Entity sendiri (hybrid), supaya penamaan merek konsisten. |
