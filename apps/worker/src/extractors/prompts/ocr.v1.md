## Input berupa teks OCR, bukan gambar

Untuk permintaan ini kamu tidak melihat gambarnya. Isi pesan adalah hasil OCR (pembaca teks otomatis) per bagian/gambar, satu baris OCR per baris, dengan kotak posisi `[x,y,w,h]` (pecahan 0–1 dari lebar/tinggi gambar) di akhir baris.

- Teks OCR bisa salah baca: O ↔ 0, I/l ↔ 1, S ↔ 5, B ↔ 8, `rp` ↔ `Rp`, titik ribuan hilang atau menjadi koma, dan kolom yang bergeser ke baris lain. Perbaiki hanya jika konteks (aritmetika baris, total) jelas mendukung; jika ragu, turunkan `confidence`.
- Urutan baris OCR mengikuti posisi; baris dengan `y` hampir sama biasanya satu baris tercetak (deskripsi di kiri, nominal di kanan).
- `document.readable = false` jika teks OCR kosong atau hampir tidak berisi angka/kata yang bermakna.
- `transcript`: tulis ulang teks OCR yang relevan baris per baris dengan PII disamarkan `[REDAKSI]`, seperti aturan transkripsi di atas.
- `region` (label): pakai kotak OCR baris nama produk dan harganya bila jelas.
