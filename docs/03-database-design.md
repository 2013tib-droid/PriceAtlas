# Tahap 2b — Desain Fisik Database

> Status: **Draft untuk direview.**
> Dasar: `docs/02-domain-model.md` (disetujui) dan Decision Log D-01 sampai D-40 di `PROJECT.md`.
> Skema lengkap: [`db/schema.sql`](../db/schema.sql). Smoke test: [`db/tests/`](../db/tests/).

Skema ini adalah **artefak desain**, belum berupa migration. Di Tahap 4 (Backend), `db/schema.sql` dipecah menjadi migration Supabase. Skemanya sudah bisa dijalankan dan sudah divalidasi di PostgreSQL 16 dengan 43 pengecekan otomatis (bagian 10).

---

## Daftar Isi

1. [Ringkasan](#1-ringkasan)
2. [Konvensi](#2-konvensi)
3. [Peta Tabel](#3-peta-tabel)
4. [Semantik Harga](#4-semantik-harga)
5. [Invariant dan Cara Penegakannya](#5-invariant-dan-cara-penegakannya)
6. [Keamanan: RLS, Hak Akses, Storage](#6-keamanan-rls-hak-akses-storage)
7. [Read Model dan Job Latar Belakang](#7-read-model-dan-job-latar-belakang)
8. [Index, Volume, dan Skalabilitas](#8-index-volume-dan-skalabilitas)
9. [Query untuk Pertanyaan Inti](#9-query-untuk-pertanyaan-inti)
10. [Validasi](#10-validasi)
11. [Pertanyaan untuk Review](#11-pertanyaan-untuk-review)

---

## 1. Ringkasan

| | |
|---|---|
| Tabel `public` (diekspos API, semuanya dilindungi RLS) | 26 |
| Tabel `app` (internal: antrean, job, konfigurasi) | 4 |
| Tabel hybrid (global + privat) | brand, category, product_group, product, barcode_assignment, store, branch, product_alias |
| Fungsi job yang dipanggil worker / pg_cron | 4 (+ 2 jenis job yang dikerjakan worker backend) |
| RPC yang bisa dipanggil klien | 1 (`merge_product`) |

Keputusan desain utama:

1. **Satu tabel `price_record`** untuk semua histori harga (D-22). Satu index utama melayani harga terbaik, tren, histori, dan search.
2. **`household_id` NULL = baris global** pada tabel hybrid. Satu pola RLS dipakai di semua tabel hybrid (D-24).
3. **Invariant penting ditegakkan di database**, bukan hanya di aplikasi: isolasi tenant, harga per satuan, periode barcode, rantai merge, dan audit. Aplikasi atau AI yang salah tidak bisa merusak data (D-05).
4. **Read model diperbarui lewat antrean**, bukan langsung di dalam transaksi user. Menyimpan struk tetap cepat, dan ringkasan menyusul dalam hitungan detik.

---

## 2. Konvensi

| Aspek | Pilihan | Alasan |
|---|---|---|
| Schema | `public` untuk tabel aplikasi. `app` untuk helper, antrean, job, config. | Supabase hanya mengekspos schema yang didaftarkan. `app` tidak bisa disentuh klien sama sekali. |
| Primary key | `uuid` (`gen_random_uuid()`) | Aman diekspos ke klien, bisa dibuat di sisi klien untuk mode offline (PWA). `audit_log` memakai `bigint identity` karena append-only dan bervolume tinggi. |
| Uang | `numeric(14,2)` | Tidak pernah memakai float. Kolom mata uang `char(3)` default `IDR`. |
| Harga per satuan | `numeric(18,6)` | Rp97,5/g muat, begitu juga harga yang sangat kecil per ml. |
| Kuantitas / berat | `numeric(12,3)` | Mendukung berat timbangan seperti 0,535 kg. |
| Tanggal transaksi | `date`, ditambah `time` opsional di struk | Tren dan harga terbaik berbasis hari (§5.4). Jam tidak selalu tercetak. |
| Nilai pilihan | `text` + `CHECK` | Lebih mudah diubah lewat migration dibanding tipe `enum` Postgres, yang nilainya tidak bisa dihapus. |
| Teks pencocokan | Kolom generated `normalized_*` via `app.normalize_text()` | Normalisasi selalu konsisten, tidak bergantung pada aplikasi. |
| Waktu sistem | `timestamptz` | — |

---

## 3. Peta Tabel

### 3.1 Dari Domain Model ke tabel

| Entity (2a) | Tabel | Catatan |
|---|---|---|
| User | `auth.users` (Supabase) + `profile` | |
| Household, Household Membership | `household`, `household_member` | Household dibuat otomatis saat signup (trigger `on_auth_user_created`). |
| Program Membership | `household_program_membership` | |
| Unit | `unit` | Seed: mg, g, kg, ml, l, pcs, lembar, cm, m. `pack`/`box` sengaja tidak ada (§5.2). |
| Brand, Category, Product Group | `brand`, `category`, `product_group` | Hybrid. Kategori sistem di-seed (§5.8). |
| Product, Barcode Assignment | `product`, `barcode_assignment` | |
| Product Alias | `product_alias` | Lihat 3.2. |
| Store Group, Store, Member Program, Branch | `store_group`, `store`, `member_program`, `branch` | |
| Shopping Session | `shopping_session` | Kedaluwarsa default 4 jam. |
| Capture, Image, Processing Run | `capture`, `capture_image`, `processing_run` | |
| Receipt, Receipt Line, Receipt Adjustment | `receipt`, `receipt_line`, `receipt_adjustment` | |
| Price Record | `price_record` | |
| Price Summary | `price_summary` + `app.summary_refresh_queue` | |
| Public Price Fact | `public_price_fact` + `app.public_price_source` | |
| Audit Log | `audit_log` | |
| Match Quality Metric | view `app.match_quality_daily` | |
| — | `app.job`, `app.config` | Infrastruktur, baru di 2b. |

### 3.2 Penyimpangan dari Domain Model

| Perubahan | Alasan |
|---|---|
| **Alias Confirmation tidak menjadi tabel.** | Alias milik household itu sendiri sudah merupakan "konfirmasi" dari household tersebut. Promosi cukup menghitung household berbeda yang punya alias aktif dengan teks + store + produk yang sama. Hasilnya satu tabel lebih sedikit, dan tidak ada data ganda yang bisa tidak sinkron. |
| **Tabel `app.job` ditambahkan.** | Operasi lintas aggregate yang berat (hitung ulang harga per satuan, promosi alias, purge gambar, redaksi OCR) butuh antrean yang tahan restart dan bisa diulang. |
| **Tabel `app.config` ditambahkan.** | D-33 dan D-35 menetapkan beberapa ambang sebagai parameter. Nilainya bisa diubah tanpa migration. |

### 3.3 Diagram relasi (ringkas)

```
auth.users ─< household_member >─ household ─< household_program_membership >─ member_program >─ store
                                     │
          ┌──────────────────────────┼─────────────────────────────────────┐
          │                          │                                     │
   shopping_session ··> branch    capture ─< capture_image           price_summary (read model)
          ▲                          │   ─< processing_run
          └────────── capture ───────┤
                                     └── receipt ─< receipt_line ─── price_record ──> public_price_fact
                                            │    ─< receipt_adjustment     │            (via trigger)
                                            ··> store, branch              ··> product, store, branch,
                                                                               member_program, capture

store_group ─< store ─< branch (··> branch penerus)
category ─< product_group ─< product ─< barcode_assignment
brand ──────────┘             │    └─< product_alias ··> store
                              └ ··> product (merged_into)
```

---

## 4. Semantik Harga

Bagian ini paling rawan salah tafsir, jadi aturannya dibuat eksplisit.

| Kolom `price_record` | Arti untuk produk `unit` | Arti untuk produk `weight` (timbang) |
|---|---|---|
| `normal_price`, `promo_price`, `member_price` | Harga per **1 kemasan** | Harga per **1 `content_unit`** produk (mis. per kg) |
| `effective_price` | Harga per kemasan setelah diskon item (D-01). Untuk observasi: harga terendah yang berlaku untuk household (D-26, D-27). | Sama, per kg |
| `quantity` | Jumlah kemasan yang dibeli | Selalu 1 |
| `actual_weight` | — | Berat yang dibeli, dalam `content_unit` |
| `unit_price` | `effective_price ÷ (pack_count × content_size × faktor ke satuan dasar)` | `effective_price ÷ faktor ke satuan dasar` |
| `price_basis` | `normal` / `promo` / `member`: harga mana yang menjadi `effective_price`. Ini dipakai untuk label promo di harga terbaik (D-02). | Sama |

Satuan dasar: **g** (massa), **ml** (volume), **pcs** (jumlah), **m** (panjang).

**Contoh terverifikasi (smoke test):**
- Milo 200 g, Rp19.500 → `unit_price` = 97,5 (Rp/g). Contoh dari §5.4.
- Milo 3in1 10 × 35 g, Rp21.000 → 60 (Rp/g). Multipack, D-17.
- Jeruk Rp45.000/kg → 45 (Rp/g). Produk timbang, §5.3.
- Struk "2 × 19.500, diskon 2.000" → satu record: `quantity` 2, `normal_price` 19.500, `promo_price` = `effective_price` 18.500.

**Siapa menghitung apa:**
- `effective_price` dan `price_basis` dihitung **aplikasi** saat record dibuat. Untuk pembelian, sumbernya baris struk + baris diskon. Untuk observasi, sumbernya aturan D-26/D-27 terhadap keanggotaan household **pada saat itu**.
- `unit_price` **selalu** dihitung trigger database dari data produk, dan tidak bisa ditimpa aplikasi. Jika ukuran produk dikoreksi, sebuah job menghitung ulang semua record produk itu (bagian 7).

---

## 5. Invariant dan Cara Penegakannya

| Invariant | Mekanisme | Rujukan |
|---|---|---|
| Data household tidak terlihat atau tertulis oleh household lain | RLS di semua tabel `public` | §6 |
| Baris anak selalu milik household yang sama dengan induknya | FK komposit `(parent_id, household_id)` pada receipt_line, receipt_adjustment, capture_image, processing_run, price_record, capture, receipt | D-24 |
| Baris boleh merujuk baris global atau milik household-nya sendiri. Baris global hanya boleh merujuk baris global. | Trigger `app.enforce_ref_visibility` | D-24, D-29 |
| User tidak bisa membuat atau mengubah data global | RLS: insert/update hanya untuk `household_id` milik user | D-29 |
| Branch harus milik Store yang disebut | FK komposit `(branch_id, store_id) → branch(id, store_id)` | D-28 |
| Satu barcode hanya menunjuk satu produk pada satu waktu (per lingkup pemilik + toko) | `EXCLUDE USING gist` atas kode + periode | D-18 |
| PLU wajib menyebut toko. GTIN wajib 8–14 digit. | `CHECK` | §10 |
| Harga member wajib menyebut program | `CHECK` | D-10 |
| `price_basis = promo/member` wajib punya harga yang bersangkutan | `CHECK` | D-02 |
| Record pembelian wajib menunjuk baris struk. Observasi tidak boleh. | `CHECK` | D-23 |
| Baris diskon/void wajib menempel ke baris lain dalam struk yang sama | `CHECK` + FK komposit `(applies_to_line_id, receipt_id)` | §5.7 |
| Koreksi header struk mengalir ke price_record-nya | Trigger `receipt_propagate_header` | D-23 |
| `unit_price` selalu konsisten dengan produk | Trigger `compute_unit_price` + job recompute | B-2 |
| Merge tidak membentuk siklus. Rantai merge dipadatkan. | Target wajib `active` (trigger) + `merge_product` mengalihkan rujukan lama | D-21 |
| Produk global hanya di-merge oleh sistem | Pengecekan di `merge_product` | D-30 |
| Setiap koreksi oleh user tercatat | Trigger `audit_row` di 12 tabel. `audit_log` tidak bisa ditulis atau diubah klien. | §5.10 |
| Fakta publik tidak membawa identitas household | Tabel terpisah tanpa `household_id` dan tanpa timestamp. Tautan ke record asal ada di schema `app`. | D-25 |
| Nama brand/store/alias tidak dobel dalam satu lingkup | Unique index `NULLS NOT DISTINCT` atas teks ternormalisasi | — |

---

## 6. Keamanan: RLS, Hak Akses, Storage

### 6.1 Pola RLS

Semua policy berpusat pada satu fungsi:

```sql
app.my_household_ids()  -- household tempat auth.uid() menjadi anggota
```

Fungsi ini `SECURITY DEFINER` (tidak rekursif terhadap RLS `household_member`) dan dipanggil sebagai `(select app.my_household_ids())`, sehingga Postgres mengevaluasinya **sekali per query**, bukan per baris.

| Pola | Tabel | Baca | Tulis |
|---|---|---|---|
| HOUSEHOLD | price_record, receipt, receipt_line, receipt_adjustment, capture, capture_image, processing_run, shopping_session, household_program_membership | milik saya | milik saya |
| HYBRID | brand, category, product_group, product, barcode_assignment, store, branch, product_alias | global + milik saya | hanya milik saya |
| SYSTEM | unit, store_group, member_program | semua user login | hanya service role |
| READ-ONLY | price_summary, audit_log | milik saya | hanya fungsi sistem |
| PUBLIC | public_price_fact | semua, termasuk anon | hanya trigger |
| TENANCY | household, household_member, profile | anggota yang sama | owner (household), diri sendiri (profile) |

### 6.2 Dua lapis pertahanan

RLS adalah lapis pertama. Lapis kedua adalah `GRANT` per tabel: tabel read-only bahkan tidak punya hak `INSERT/UPDATE/DELETE` untuk role `authenticated`. Jika suatu hari ada policy yang salah tulis, data tetap tidak bisa diubah.

### 6.3 Operasi sistem (service role)

Dijalankan oleh backend atau worker, tidak pernah dari klien:
- membuat dan mengubah katalog global (kurasi, D-29)
- merge data global (D-30)
- promosi alias, hitung ulang ringkasan, hitung ulang harga per satuan
- purge gambar dan redaksi OCR (D-32)

### 6.4 Supabase Storage (diterapkan di Tahap 4)

Bucket `captures` bersifat **privat**. Path: `{household_id}/{capture_id}/{position}.{ext}`. Policy:

```sql
create policy captures_rw on storage.objects for all to authenticated
  using      (bucket_id = 'captures' and (storage.foldername(name))[1]::uuid in (select app.my_household_ids()))
  with check (bucket_id = 'captures' and (storage.foldername(name))[1]::uuid in (select app.my_household_ids()));
```

### 6.5 PII (UU PDP)

| Data | Lokasi | Perlakuan |
|---|---|---|
| Digit kartu, nama/nomor member, HP | `receipt.pii` (jsonb terpisah) | Dipisah dari kolom lain supaya mudah disamarkan, diekspor, atau dihapus. |
| Teks OCR dan output AI mentah | `processing_run.raw_*` | Disamarkan oleh job `redact_ocr`. `pii_redacted_at` menandai yang sudah. |
| Gambar | Storage + `capture_image` | Dihapus setelah `purge_after` (12 bulan, D-32). Baris metadata tetap ada (hash masih dipakai untuk deteksi duplikat), file-nya dihapus. |
| Hapus akun | `auth.users` → cascade ke profile & membership | Household yang tidak lagi punya anggota dihapus beserta seluruh datanya (cascade) oleh proses hapus akun di Tahap 4. Fakta publik yang sudah anonim tetap ada (BR-8). |

---

## 7. Read Model dan Job Latar Belakang

### 7.1 Price Summary

```
price_record berubah ─(trigger)─> app.summary_refresh_queue (dedup per household × produk)
                                         │
worker / pg_cron tiap ~10 detik ─> app.process_summary_queue()  ─> app.refresh_price_summary()
pg_cron harian 00:05            ─> app.enqueue_time_based_refresh()   (jendela 90 hari & tren bergeser, D-31)
```

Isi ringkasan per (household, produk): jumlah data, data terakhir, harga terbaik 90 hari dan all-time (record, harga, basis promo/normal, tanggal, toko, cabang), serta tren. Toko dan cabang disimpan langsung di ringkasan supaya hasil search tidak perlu join ke `price_record` (§7).

Aturan perhitungan:
- **Data yang dihitung:** record `active` dan bukan bundle (D-08).
- **Harga terbaik:** `unit_price` terendah. Jika seri, ambil yang tanggalnya paling baru.
- **Tren:** rata-rata `unit_price` 30 hari terakhir vs 30 hari sebelumnya. Ditampilkan hanya jika masing-masing jendela punya minimal 2 data. Perubahan di bawah 2% dianggap stabil. Semua angka ini ada di `app.config` (D-33, D-15).
- Opsi "tren hanya harga normal" (D-33) dihitung saat query dari `price_record`, tidak disimpan di ringkasan.

`app.process_summary_queue` memakai `FOR UPDATE SKIP LOCKED`, sehingga aman dijalankan beberapa worker sekaligus.

### 7.2 Daftar job

| Fungsi / job | Pemicu | Sifat |
|---|---|---|
| `app.process_summary_queue(limit)` | pg_cron atau worker, tiap beberapa detik | Paralel-aman |
| `app.enqueue_time_based_refresh()` | pg_cron harian | Idempoten |
| `app.recompute_unit_prices(product, batch)` | Job `recompute_unit_price` (dibuat trigger saat ukuran produk berubah) | Panggil berulang sampai hasilnya 0. Idempoten. |
| `app.promote_aliases()` | pg_cron harian | Idempoten |
| purge gambar / redaksi OCR | Job `purge_images` / `redact_ocr` | Dikerjakan worker backend (butuh akses Storage dan AI) |

Contoh jadwal (Tahap 4):

```sql
select cron.schedule('summary-queue', '10 seconds', $$select app.process_summary_queue(500)$$);
select cron.schedule('summary-time',  '5 0 * * *',  $$select app.enqueue_time_based_refresh()$$);
select cron.schedule('alias-promote', '20 0 * * *', $$select app.promote_aliases()$$);
```

### 7.3 Public Price Fact

Trigger pada `price_record` menyalin record ke `public_price_fact` hanya jika:
- record `public`, `active`, dan bukan bundle, **dan**
- produk, toko, serta cabangnya ada di katalog global (produk privat bisa mengungkap identitas).

Saat opt-out, update, atau hapus, salinannya dihapus lewat tautan di `app.public_price_source`.

---

## 8. Index, Volume, dan Skalabilitas

### 8.1 Index utama

| Index | Melayani |
|---|---|
| `price_record (household_id, product_id, transaction_date desc) INCLUDE (unit_price, effective_price, price_basis, store_id, branch_id) WHERE status='active'` | Harga terbaik, tren, histori per produk, "di mana termurah". Hampir semua query bisa dijawab dari index saja (index-only scan). |
| `price_record (household_id, transaction_date desc)` | Histori terbaru di beranda |
| `price_record (product_id)` | Merge dan hitung ulang produk global |
| `product USING gin (search_text gin_trgm_ops)` | Search nama produk dan fuzzy matching (tier 3) |
| `product_alias (store_id, normalized_text, household_id)` unique | Matching alias exact (tier 2) |
| `barcode_assignment (code)` | Matching barcode (tier 1) |
| `receipt (household_id, store_id, transaction_date, total_amount)` | Sidik jari struk duplikat (D-20) |
| `capture_image (household_id, sha256)` | Hash gambar duplikat (D-20) |
| `capture (status, uploaded_at) WHERE status in (uploaded, processing)` | Antrean pemrosesan |

### 8.2 Estimasi volume

| Tabel | Asumsi | Per tahun pada 100 ribu household |
|---|---|---|
| price_record | ~50 item/minggu | ~260 juta baris |
| receipt_line | ~1,2 × price_record (diskon, non-produk) | ~310 juta |
| receipt | ~3 struk/minggu | ~15 juta |
| price_summary | ~300 produk per household | ~30 juta (tidak tumbuh terhadap waktu) |
| capture_image | ~4/minggu, ±300 KB | ~20 juta file, ~6 TB storage sebelum retensi |

### 8.3 Partisi: sengaja ditunda

`price_record` **tidak** dipartisi di MVP.
- **Alasannya:** partisi memaksa primary key dan unique constraint menyertakan kunci partisi. Akibatnya FK komposit (isolasi tenant) dan `receipt_line_id unique` jadi rumit, padahal di MVP volumenya sangat kecil.
- **Kapan ditinjau ulang:** saat `price_record` melewati ~50 juta baris, atau p95 query harga terbaik melewati 50 ms.
- **Kandidat strategi:** partisi `HASH (household_id)`. Semua query sudah dibatasi per household, jadi setiap query hanya menyentuh satu partisi. Partisi waktu kurang cocok karena "harga terbaik all-time" harus membaca seluruh rentang waktu.

### 8.4 Hal yang dipantau

- Panjang `app.summary_refresh_queue` (indikator worker tertinggal)
- Job `recompute_unit_price` untuk produk global populer (fan-out besar)
- Rasio tier AI di `app.match_quality_daily` (biaya)

---

## 9. Query untuk Pertanyaan Inti

Query di bawah sudah dijalankan terhadap data smoke test. Di Tahap 4, query ini menjadi dasar **tools AI yang sudah didefinisikan** (D-05).

**1–2. Harga termurah, dan di toko/cabang mana** (hasil search, tanpa membuka detail):

```sql
select p.name, s.best_90d_effective_price, s.best_90d_price_basis, s.best_90d_unit_price,
       st.name as toko, b.name as cabang, s.best_90d_date,
       s.best_all_effective_price, s.best_all_price_basis,
       s.trend_direction, s.record_count, s.last_transaction_date
  from product p
  join price_summary s on s.product_id = p.id
  left join store  st on st.id = s.best_90d_store_id
  left join branch b  on b.id  = s.best_90d_branch_id
 where p.search_text % :kata_kunci
 order by similarity(p.search_text, :kata_kunci) desc;
```

**3. Naik atau turun dibanding bulan lalu:**

```sql
select date_trunc('month', transaction_date)::date as bulan,
       min(unit_price) as termurah, avg(unit_price) as rata2, count(*) as n
  from price_record
 where product_id = :produk and status = 'active' and not is_bundle
   and transaction_date >= date_trunc('month', current_date) - interval '1 month'
 group by 1 order by 1;
```

**4. Harga per gram / satuan:** kolom `price_record.unit_price` dan `price_summary.*_unit_price`.

**5. Apakah 500 g lebih murah dari 200 g:**

```sql
select p.name, p.pack_count, p.content_size, p.content_unit, u.dimension,
       s.best_90d_unit_price, s.best_all_unit_price
  from product p
  join unit u on u.code = p.content_unit
  left join price_summary s on s.product_id = p.id
 where p.product_group_id = :group and p.status = 'active'
 order by u.dimension, s.best_all_unit_price;   -- bandingkan hanya dalam dimensi yang sama
```

**6. Lebih hemat beli di mana** (per produk atau Product Group, D-39):

```sql
select st.name as toko, coalesce(b.name, '(cabang tidak diketahui)') as cabang,
       min(pr.unit_price) as termurah, avg(pr.unit_price) as rata2, count(*) as n
  from price_record pr
  join product p on p.id = pr.product_id
  join store st  on st.id = pr.store_id
  left join branch b on b.id = pr.branch_id
 where p.product_group_id = :group and pr.status = 'active' and not pr.is_bundle
   and pr.transaction_date > current_date - 90
 group by st.name, b.name
 order by rata2;
```

Semua query dijalankan dengan JWT user, sehingga RLS otomatis membatasinya ke household user tersebut. Tool AI tidak perlu dan tidak boleh menambahkan filter household sendiri.

---

## 10. Validasi

```bash
# PostgreSQL lokal >= 15, tanpa Supabase
PGHOST=... PGPORT=... PGUSER=postgres db/tests/run.sh
```

`db/tests/supabase_stub.sql` menyediakan `auth.users`, `auth.uid()`, dan role `anon` / `authenticated` / `service_role` seperti di Supabase. `db/tests/smoke.sql` berisi **43 pengecekan**, semuanya lulus di PostgreSQL 16:

| Area | Yang dibuktikan |
|---|---|
| Tenancy | Signup membuat household + owner. User hanya melihat household-nya. |
| Isolasi | User B tidak bisa membaca harga, struk, atau produk privat user A. Tidak bisa menulis ke household A. Tidak bisa merujuk produk privat A. |
| Katalog global | User tidak bisa membuat atau mengubah produk global. |
| Harga | Harga per satuan untuk produk biasa, multipack, dan timbang. Branch harus milik store. Harga member wajib menyebut program. |
| Struk | Baris diskon wajib menempel. Koreksi tanggal mengalir ke price_record. Koreksi tercatat di audit. Audit tidak bisa ditulis user. |
| Ringkasan | Harga terbaik 90 hari ≠ all-time. Bundle diabaikan. Tren naik terdeteksi. Antrean habis diproses. |
| Publik | Anon hanya melihat fakta anonim. Tidak bisa membaca price_record atau tautan asal. Opt-out menghapus fakta. |
| Barcode | Barcode berpindah produk di periode berbeda (shrinkflation). Tumpang tindih ditolak. PLU wajib toko. |
| Merge | User tidak bisa merge produk global. Merge privat memindahkan histori dan tercatat di audit. Sistem bisa merge global. Target yang sudah merged ditolak. |
| Recompute | Koreksi ukuran membuat job. Job menghitung ulang harga per satuan dan idempoten. |
| Alias | 3 household → alias dipromosikan. Promosi idempoten. Teks ternormalisasi. |

---

## 11. Pertanyaan untuk Review

Semua punya default dan tidak mengubah struktur tabel. Jawab "setuju" jika default sudah cocok.

| ID | Pertanyaan | Default di skema |
|---|---|---|
| R-01 | Jika household baru bergabung ke program member, apakah harga efektif observasi **lama** ikut dihitung ulang? | **Tidak.** D-26 berbunyi "pada tanggal observasi", jadi record lama tetap. |
| R-02 | "Jumlah data" di ringkasan menghitung record bundle? | **Tidak.** Hanya record yang ikut perhitungan, supaya angkanya konsisten dengan harga terbaik. |
| R-03 | Sesi belanja kedaluwarsa otomatis setelah berapa lama? | **4 jam.** |
| R-04 | Tren dihitung dengan rata-rata 30 hari terakhir vs 30 hari sebelumnya, minimal 2 data per jendela, ambang stabil 2%? | **Ya.** Semuanya bisa diubah di `app.config`. |
| R-05 | Partisi `price_record` ditunda sampai ~50 juta baris? | **Ya.** |
| R-06 | Fakta publik menyimpan tanggal transaksi (harian) dan cabang? | **Ya.** Alternatif yang lebih anonim: tanggal per minggu dan tanpa cabang. |

Setelah draft ini disetujui, Tahap 2 selesai dan kita masuk **Tahap 3 (Wireframe)**.
