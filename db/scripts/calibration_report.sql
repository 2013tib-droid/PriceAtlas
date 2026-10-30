-- Laporan kalibrasi matching (docs/08 §8.2–§8.3). BACA SAJA; dijalankan pemilik proyek:
--   psql "$DATABASE_URL" -f db/scripts/calibration_report.sql
-- Tanpa -v since → sejak app.config calibration_started_on (awal masa kalibrasi; sebelum itu item
-- bisa auto-save sehingga "diterima" tidak berarti dicek user). -v since=1970-01-01 → semua data.
-- Hanya angka agregat: tanpa teks struk, nama produk, atau id household, jadi keluarannya boleh
-- dikirim untuk analisis.
--
-- Satu "saran" = baris struk produk (receipt_line) atau item label/screenshot (capture_item) yang
-- sudah diputuskan user (punya price_record) dan punya saran sistem (suggested_product_id).
-- "Diterima" = produk akhir di price_record sama dengan saran (mengikuti merge, F-01). Diganti
-- user, termasuk koreksi belakangan (match_outcome = 'corrected'), dihitung tidak diterima.
\if :{?since}
\else
  select coalesce((select value #>> '{}' from app.config where key = 'calibration_started_on'), '1970-01-01') as since \gset
\endif
\echo 'Data sejak' :'since'

begin;

create temp view calib_suggestion as
select 'receipt'::text as source, l.match_tier as tier, l.match_confidence as confidence,
       coalesce(sp.merged_into_id, sp.id) = pr.product_id as accepted, pr.match_outcome as outcome,
       pr.transaction_date
  from public.receipt_line l
  join public.price_record pr on pr.receipt_line_id = l.id and pr.status = 'active'
  join public.product sp on sp.id = l.suggested_product_id
 where l.line_type = 'product' and l.match_tier is not null and l.match_tier <> 'manual'
union all
select c.kind, i.match_tier, i.match_confidence,
       coalesce(sp.merged_into_id, sp.id) = pr.product_id, pr.match_outcome, pr.transaction_date
  from public.capture_item i
  join public.capture c on c.id = i.capture_id
  join public.price_record pr on pr.id = i.price_record_id and pr.status = 'active'
  join public.product sp on sp.id = i.suggested_product_id
 where i.status = 'accepted' and i.match_tier is not null and i.match_tier <> 'manual';

-- View sementara dibuat dulu (CREATE tidak boleh di transaksi read only), sesudahnya hanya baca;
-- rollback di akhir membuang view.
set transaction read only;

\echo '== 1. Presisi per tier (diterima tanpa diganti) =='
select tier, source, count(*) as saran, count(*) filter (where accepted) as diterima,
       round(100.0 * count(*) filter (where accepted) / nullif(count(*), 0), 1) as presisi_pct,
       count(*) filter (where outcome = 'auto') as auto_save
  from calib_suggestion
 where transaction_date >= :'since'::date
 group by rollup (tier, source)
 order by tier nulls last, source nulls last;

\echo '== 2. Presisi per rentang confidence (lebar 0,05) =='
select (least(floor(confidence * 20) / 20, 0.95))::numeric(3, 2) as dari,
       (least(floor(confidence * 20) / 20, 0.95) + 0.05)::numeric(3, 2) as sampai,
       tier, count(*) as saran,
       round(100.0 * count(*) filter (where accepted) / nullif(count(*), 0), 1) as presisi_pct
  from calib_suggestion
 where transaction_date >= :'since'::date and confidence is not null
 group by 1, 2, 3
 order by 1 desc, 3;

\echo '== 3. Kandidat ambang auto-save τ: presisi dan coverage jika auto-save = confidence ≥ τ =='
select t.tau, count(*) filter (where s.confidence >= t.tau) as di_atas_tau,
       round(100.0 * count(*) filter (where s.confidence >= t.tau and s.accepted)
             / nullif(count(*) filter (where s.confidence >= t.tau), 0), 1) as presisi_pct,
       round(100.0 * count(*) filter (where s.confidence >= t.tau) / nullif(count(*), 0), 1) as coverage_pct
  from calib_suggestion s
 cross join (select generate_series(0.50, 1.00, 0.05)::numeric(3, 2) as tau) t
 where s.transaction_date >= :'since'::date and s.confidence is not null
 group by t.tau
 order by t.tau;

\echo '== 4. Distribusi similarity tier 3 (fuzzy_min_similarity, §8.3) =='
select (floor(confidence * 20) / 20)::numeric(3, 2) as dari, count(*) as saran,
       count(*) filter (where accepted) as benar, count(*) filter (where not accepted) as salah
  from calib_suggestion
 where transaction_date >= :'since'::date and tier = 'fuzzy'
 group by 1
 order by 1;

\echo '== 5. Baris tanpa saran (tidak ada kandidat tier 1–4) =='
select 'receipt' as source, count(*) as tanpa_saran
  from public.receipt_line l
  join public.price_record pr on pr.receipt_line_id = l.id and pr.status = 'active'
 where l.line_type = 'product' and l.suggested_product_id is null and pr.transaction_date >= :'since'::date
union all
select 'observasi', count(*)
  from public.capture_item i
  join public.price_record pr on pr.id = i.price_record_id and pr.status = 'active'
 where i.status = 'accepted' and i.suggested_product_id is null and pr.transaction_date >= :'since'::date;

\echo '== 6. Config matching saat ini =='
select key, value from app.config
 where key in ('auto_save_min_confidence', 'fuzzy_min_similarity', 'fuzzy_max_confidence', 'match_conf_barcode',
               'match_conf_alias_household', 'match_conf_alias_global', 'match_conf_alias_group',
               'ai_match_max_confidence', 'ai_match_shortlist_min_similarity', 'calibration_started_on')
 order by key;

rollback;
