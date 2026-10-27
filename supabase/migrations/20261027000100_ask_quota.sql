-- =============================================================================
-- 0100 (2026-10-27) · Tanya: kuota, pencatatan biaya, anggaran AI harian
-- (docs/08 §10.4, §11.1 #1 #4 #5, §12.3; Tahap 6b M5)
-- =============================================================================
-- Bagian Tanya dari migration AI §11. Sisanya (kunci tier §8.2, ai_match_shortlist,
-- capture_item.read_member_*, R18/R20) ikut milestone M2–M4.
--   * app.config: ask_daily_limit, ask_monthly_limit, ai_daily_budget_usd.
--   * app.err: AI_QUOTA_EXCEEDED (429), AI_UNAVAILABLE (503). Aditif.
--   * app.ask_usage: satu baris per household per hari (zona household).
--   * app.ai_spend_today(): Σ biaya AI hari ini (worker dan Tanya). Dipindah dari M2
--     ke sini karena begin_ask butuh anggaran harian (docs/08 §19, F-134).
--   * public.begin_ask(), public.record_ask_usage(): DEFINER, dipanggil route /api/ask
--     dengan JWT user. Hanya household user sendiri; tanpa service role.
-- RLS tidak berubah. ask_usage di schema app (tidak terbaca klien).

insert into app.config (key, value, description) values
  ('ask_daily_limit',     '30',   'Tanya: pertanyaan maksimum per household per hari (zona household, D-92)'),
  ('ask_monthly_limit',   '300',  'Tanya: pertanyaan maksimum per household per bulan kalender (D-92)'),
  ('ai_daily_budget_usd', '2.00', 'Anggaran biaya AI global per hari (US$, zona DB). Habis → worker berhenti claim, Tanya 429 (docs/08 §12.3)');

-- Kode error baru (aditif). Isi sama dengan 0100_config_helpers + dua baris AI.
create or replace function app.err(p_code text, p_detail jsonb default null) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_http text;
  v_hint text;
begin
  select e.http, e.hint into v_http, v_hint
    from (values
      ('NOT_FOUND',                   '404', 'Data tidak ditemukan.'),
      ('STALE_WRITE',                 '409', 'Data sudah diubah di tempat lain. Muat ulang lalu coba lagi.'),
      ('INVALID_STATE',               '409', 'Status data tidak mengizinkan aksi ini.'),
      ('INVALID_TRANSITION',          '409', 'Perubahan status ini tidak diizinkan.'),
      ('DUPLICATE_DECISION_REQUIRED', '409', 'Struk ini mirip struk lain. Pilih: simpan sebagai struk berbeda atau buang.'),
      ('SESSION_NOT_ACTIVE',          '409', 'Sesi belanja sudah berakhir.'),
      ('RECEIPT_STORE_REQUIRED',      '422', 'Pilih toko untuk struk ini.'),
      ('UNDECIDED_LINES',             '422', 'Masih ada baris yang belum diputuskan.'),
      ('STORE_REQUIRED',              '422', 'Pilih toko untuk harga ini.'),
      ('NO_APPLICABLE_PRICE',         '422', 'Tidak ada harga yang berlaku. Isi harga normal.'),
      ('USE_RECEIPT_LINE',            '422', 'Harga dari struk diubah lewat baris struknya.'),
      ('RECEIPT_DERIVED_FIELD',       '422', 'Angka harga dari struk diturunkan dari baris struk dan tidak bisa diubah langsung.'),
      ('INVALID_EXTRA',               '422', 'Info tambahan tidak valid.'),
      ('CAPTURE_IMAGES_MISSING',      '422', 'Gambar belum selesai diunggah.'),
      ('BRANCH_CLOSED',               '422', 'Cabang ini sudah tutup.'),
      ('RECORDS_NOT_OWNED',           '403', 'Sebagian data bukan milikmu.'),
      ('MERGE_FORBIDDEN',             '403', 'Produk ini tidak bisa digabungkan.'),
      ('REAUTH_REQUIRED',             '401', 'Masuk ulang dulu untuk melanjutkan.'),
      ('FORBIDDEN',                   '403', 'Tidak berhak melakukan aksi ini.'),
      ('INVALID_INPUT',               '400', 'Input tidak valid.'),
      ('AI_QUOTA_EXCEEDED',           '429', 'Batas pertanyaan Tanya sudah tercapai. Coba lagi nanti.'),
      ('AI_UNAVAILABLE',              '503', 'Layanan AI sedang tidak tersedia.')
    ) as e(code, http, hint)
   where e.code = p_code;

  if v_http is null then
    raise exception 'Kode error tidak dikenal: %', p_code;
  end if;

  raise exception using
    errcode = 'PT' || v_http,
    message = p_code,
    detail  = coalesce(p_detail, '{}'::jsonb)::text,
    hint    = v_hint;
end $$;
revoke all on function app.err(text, jsonb) from public, anon, authenticated;
grant execute on function app.err(text, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Pemakaian Tanya per household per hari
-- -----------------------------------------------------------------------------
create table app.ask_usage (
  household_id  uuid    not null references public.household (id) on delete cascade,
  day           date    not null,
  questions     integer not null default 0 check (questions >= 0),
  -- Jumlah record_ask_usage yang sudah masuk; tidak boleh melebihi questions.
  recorded      integer not null default 0 check (recorded >= 0 and recorded <= questions),
  input_tokens  bigint  not null default 0 check (input_tokens >= 0),
  output_tokens bigint  not null default 0 check (output_tokens >= 0),
  cost_usd      numeric(12,6) not null default 0 check (cost_usd >= 0),
  updated_at    timestamptz not null default now(),
  primary key (household_id, day)
);
-- Anggaran harian menjumlahkan biaya per hari lintas household.
create index ask_usage_day_idx on app.ask_usage (day);

revoke all on table app.ask_usage from public, anon, authenticated;
grant all on table app.ask_usage to service_role;

-- -----------------------------------------------------------------------------
-- Biaya AI hari ini (docs/08 §11.1 #5, §12.3): pipeline capture + Tanya. "Hari ini" =
-- tanggal zona DB (Asia/Jakarta, 0230_hardening). Biaya yang tidak diketahui (NULL) tidak dihitung.
-- -----------------------------------------------------------------------------
create function app.ai_spend_today() returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select sum(cost_usd) from public.processing_run
                    where started_at >= current_date::timestamptz
                      and started_at <  (current_date + 1)::timestamptz), 0)
       + coalesce((select sum(cost_usd) from app.ask_usage where day = current_date), 0)
$$;
revoke all on function app.ai_spend_today() from public, anon, authenticated;
grant execute on function app.ai_spend_today() to service_role;

-- -----------------------------------------------------------------------------
-- begin_ask: dipanggil sebelum setiap pertanyaan (docs/08 §10.1 langkah 3, §10.4).
-- Mengunci baris household-hari (dua sesi bersamaan antre di kunci yang sama), memeriksa
-- kuota harian, kuota bulanan, dan anggaran AI harian global, lalu menambah hitungan.
-- Kuota habis → AI_QUOTA_EXCEEDED (PT429), detail.reason = daily | monthly | budget.
-- Mengembalikan `day` untuk record_ask_usage (pertanyaan yang melewati tengah malam tetap
-- dicatat di hari yang sama dengan hitungannya).
-- -----------------------------------------------------------------------------
create function public.begin_ask() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_household uuid := (app.my_household()).id;
  v_day       date;
  v_daily     integer := coalesce(app.config_int('ask_daily_limit'), 30);
  v_monthly   integer := coalesce(app.config_int('ask_monthly_limit'), 300);
  v_budget    numeric := coalesce(app.config_numeric('ai_daily_budget_usd'), 2.00);
  v_today_n   integer;
  v_month_n   integer;
begin
  if v_household is null then
    perform app.err('FORBIDDEN', jsonb_build_object('reason', 'no_household'));
  end if;
  v_day := app.household_today(v_household);

  insert into app.ask_usage (household_id, day) values (v_household, v_day)
  on conflict (household_id, day) do nothing;
  select questions into v_today_n
    from app.ask_usage where household_id = v_household and day = v_day
     for update;

  -- Setelah kunci: pernyataan baru melihat nilai terbaru baris yang dikunci.
  select coalesce(sum(questions), 0) into v_month_n
    from app.ask_usage
   where household_id = v_household
     and day >= date_trunc('month', v_day)::date and day <= v_day;

  if v_today_n >= v_daily then
    perform app.err('AI_QUOTA_EXCEEDED', jsonb_build_object('reason', 'daily', 'limit', v_daily));
  end if;
  if v_month_n >= v_monthly then
    perform app.err('AI_QUOTA_EXCEEDED', jsonb_build_object('reason', 'monthly', 'limit', v_monthly));
  end if;
  if app.ai_spend_today() >= v_budget then
    perform app.err('AI_QUOTA_EXCEEDED', jsonb_build_object('reason', 'budget'));
  end if;

  update app.ask_usage set questions = questions + 1, updated_at = now()
   where household_id = v_household and day = v_day;

  return jsonb_build_object(
    'day', v_day,
    'questions_today', v_today_n + 1, 'daily_limit', v_daily,
    'questions_month', v_month_n + 1, 'monthly_limit', v_monthly);
end $$;

-- -----------------------------------------------------------------------------
-- record_ask_usage: token dan biaya satu pertanyaan (docs/08 §10.1 langkah 6).
-- Hanya baris household sendiri yang dibuat begin_ask (hari ini atau kemarin di zona
-- household), paling banyak satu kali per pertanyaan yang dihitung, biaya ≤ US$1 per
-- pertanyaan (batas atas realistis 5 panggilan × max_tokens 4.000, docs/08 §12.3).
-- p_cost_usd NULL = model tak dikenal di tabel harga: token dicatat, biaya tidak.
-- -----------------------------------------------------------------------------
create function public.record_ask_usage(
  p_day date, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_household uuid := (app.my_household()).id;
  v_today     date;
begin
  if v_household is null then
    perform app.err('FORBIDDEN', jsonb_build_object('reason', 'no_household'));
  end if;
  v_today := app.household_today(v_household);
  if p_day is null or p_day not between v_today - 1 and v_today
     or p_input_tokens is null or p_input_tokens not between 0 and 2000000
     or p_output_tokens is null or p_output_tokens not between 0 and 200000
     or (p_cost_usd is not null and p_cost_usd not between 0 and 1) then
    perform app.err('INVALID_INPUT', jsonb_build_object('reason', 'ask_usage'));
  end if;

  update app.ask_usage
     set recorded      = recorded + 1,
         input_tokens  = input_tokens + p_input_tokens,
         output_tokens = output_tokens + p_output_tokens,
         cost_usd      = cost_usd + coalesce(p_cost_usd, 0),
         updated_at    = now()
   where household_id = v_household and day = p_day and recorded < questions;
  if not found then
    perform app.err('INVALID_STATE', jsonb_build_object('reason', 'no_open_question', 'day', p_day));
  end if;
end $$;

-- F-09: hak eksplisit. Klien memanggil lewat route /api/ask (JWT user), bukan anon.
revoke all on function public.begin_ask() from public, anon, authenticated;
revoke all on function public.record_ask_usage(date, integer, integer, numeric) from public, anon, authenticated;
grant execute on function public.begin_ask() to authenticated, service_role;
grant execute on function public.record_ask_usage(date, integer, integer, numeric) to authenticated, service_role;
