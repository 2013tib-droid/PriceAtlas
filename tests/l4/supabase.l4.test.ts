// L4 (docs/05 §8.1): terhadap Supabase lokal asli (`supabase start`), bukan stub.
// Mencakup: policy Storage asli, pemetaan error PTnnn → HTTP oleh PostgREST, Auth
// (signup → household), pipeline worker dengan SupabaseBlobStore, hapus akun lewat
// service role, zona waktu database, dan jadwal pg_cron (Q-42).
// Env (diisi workflow dari `supabase status -o env`): SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseBlobStore } from '../../apps/worker/src/adapters/supabase-blob-store.ts';
import { createPool } from '../../apps/worker/src/db.ts';
import { FixtureRegistry, StubAiMatcher, StubExtractor } from '../../apps/worker/src/extractors/stub.ts';
import { processNextCapture } from '../../apps/worker/src/pipeline/process-capture.ts';
import { deleteAccount } from '../../apps/web/lib/account/delete.ts';
import { ACCOUNT_DELETE_CONFIRMATION } from '@priceatlas/contracts';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`env ${k} wajib (jalankan lewat workflow supabase-l4)`);
  return v;
};
const URL_ = env('SUPABASE_URL');
const ANON = env('SUPABASE_ANON_KEY');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
const DB_URL = env('SUPABASE_DB_URL');
const FIXTURES = resolve(import.meta.dirname, '../../apps/worker/test/fixtures');

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
let db: pg.Pool;

interface TestUser { id: string; client: SupabaseClient; household: string }

async function newUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const s = await client.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(`signIn: ${s.error.message}`);
  const ctx = await client.rpc('get_my_context');
  if (ctx.error) throw new Error(`get_my_context: ${ctx.error.message}`);
  return { id: data.user.id, client, household: (ctx.data as { household: { id: string } }).household.id };
}

let ani: TestUser;
let budi: TestUser;

beforeAll(async () => {
  db = new pg.Pool({ connectionString: DB_URL, max: 3 });
  ani = await newUser('ani');
  budi = await newUser('budi');
});
afterAll(async () => {
  await db.end();
});

describe('database Supabase asli', () => {
  it('zona waktu database Asia/Jakarta (D-68, migration 0230)', async () => {
    // Koneksi baru: ALTER DATABASE … SET timezone berlaku untuk sesi baru.
    const c = new pg.Client({ connectionString: DB_URL });
    await c.connect();
    const r = await c.query('show timezone');
    await c.end();
    expect(r.rows[0].TimeZone).toBe('Asia/Jakarta');
  });
  it('pg_cron tersedia → 6 jadwal dibuat (migration 0900)', async () => {
    const r = await db.query<{ jobname: string }>('select jobname from cron.job order by 1');
    expect(r.rows.map((x) => x.jobname)).toEqual(
      ['alias-promote', 'reap-stale-runs', 'retention', 'sql-jobs', 'summary-queue', 'summary-time'],
    );
  });
  it('bucket captures sesuai D-69, policy storage terpasang', async () => {
    const b = await db.query('select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1', ['captures']);
    expect(b.rows[0]).toEqual({ public: false, file_size_limit: '10485760', allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] });
    const p = await db.query(`select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'
                                and policyname like 'captures_%' order by 1`);
    expect(p.rows).toEqual([{ policyname: 'captures_insert', cmd: 'INSERT' }, { policyname: 'captures_read', cmd: 'SELECT' }]);
  });
  it('worker bisa SET ROLE service_role dari role postgres (WORKER_DB_ROLE)', async () => {
    const p = createPool(DB_URL, { role: 'service_role', max: 1 });
    try {
      expect((await p.query('select current_user as u')).rows[0].u).toBe('service_role');
    } finally {
      await p.end();
    }
  });
});

describe('Auth + PostgREST', () => {
  it('signup → profile + household + owner (handle_new_user)', async () => {
    const r = await ani.client.rpc('get_my_context');
    expect(r.data).toMatchObject({ user_id: ani.id, role: 'owner', household: { timezone: 'Asia/Jakarta' } });
  });
  it('error bisnis PTnnn dipetakan ke HTTP', async () => {
    const nf = await ani.client.rpc('get_product_detail', { p_product_id: randomUUID() });
    expect(nf.status).toBe(404);
    expect(nf.error).toMatchObject({ code: 'PT404', message: 'NOT_FOUND' });
    expect(JSON.parse(nf.error!.details!)).toHaveProperty('product_id');
    const short = await ani.client.rpc('search_products', { p_query: 'm' });
    expect(short.status).toBe(400);
    expect(short.error?.code).toBe('22023');
  });
  it('anon tidak bisa memanggil RPC; kolom pii tidak terbaca', async () => {
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    const r = await anon.rpc('get_my_context');
    expect(r.error).not.toBeNull();
    const pii = await ani.client.from('receipt').select('pii');
    expect(pii.error?.code).toBe('42501');
  });
  it('household lain tidak terlihat (RLS)', async () => {
    const r = await budi.client.from('household').select('id');
    expect(r.data?.map((x) => x.id)).toEqual([budi.household]);
  });
});

describe('Storage asli (F-14, D-69)', () => {
  it('unggah ke folder sendiri boleh, folder household lain ditolak, hapus oleh user tidak berefek', async () => {
    const own = `${ani.household}/${randomUUID()}/1.jpg`;
    const up = await ani.client.storage.from('captures').upload(own, Buffer.from('x'), { contentType: 'image/jpeg' });
    expect(up.error).toBeNull();
    const other = await ani.client.storage.from('captures').upload(`${budi.household}/${randomUUID()}/1.jpg`, Buffer.from('x'), { contentType: 'image/jpeg' });
    expect(other.error).not.toBeNull();
    const notImage = await ani.client.storage.from('captures').upload(`${ani.household}/${randomUUID()}/1.jpg`, Buffer.from('x'), { contentType: 'text/plain' });
    expect(notImage.error).not.toBeNull();
    await ani.client.storage.from('captures').remove([own]);
    const still = await admin.storage.from('captures').list(own.split('/').slice(0, 2).join('/'));
    expect(still.data?.map((f) => f.name)).toEqual(['1.jpg']);
    const seen = await budi.client.storage.from('captures').download(own);
    expect(seen.error).not.toBeNull();
  });
});

describe('pipeline: unggah → submit_capture → worker (SupabaseBlobStore) → konfirmasi', () => {
  it('struk-aeon diproses dengan Storage asli', async () => {
    const data = readFileSync(resolve(FIXTURES, 'struk-aeon.jpg'));
    const captureId = randomUUID();
    const path = `${ani.household}/${captureId}/1.jpg`;
    expect((await ani.client.storage.from('captures').upload(path, data, { contentType: 'image/jpeg' })).error).toBeNull();
    const sub = await ani.client.rpc('submit_capture', {
      p_capture_id: captureId,
      p_kind: 'receipt',
      p_images: [{ position: 1, ext: 'jpg', sha256: createHash('sha256').update(data).digest('hex'), byte_size: data.length }],
    });
    expect(sub.error).toBeNull();

    const workerDb = createPool(DB_URL, { role: 'service_role', max: 2 });
    const fx = new FixtureRegistry(FIXTURES);
    try {
      let r = null;
      for (let i = 0; i < 20 && r?.captureId !== captureId; i++) {
        r = await processNextCapture({ db: workerDb, blob: new SupabaseBlobStore(admin), extractor: new StubExtractor(fx), ai: new StubAiMatcher(fx), workerId: 'l4' });
        if (!r) break;
      }
      expect(r).toMatchObject({ captureId, status: 'needs_confirmation' });
    } finally {
      await workerDb.end();
    }
    const caps = await ani.client.rpc('list_captures');
    const cap = (caps.data as { id: string; receipt_id: string; needs_check_count: number }[]).find((c) => c.id === captureId)!;
    expect(cap.needs_check_count).toBe(2);
    const rec = await ani.client.rpc('get_receipt', { p_receipt_id: cap.receipt_id });
    expect(JSON.stringify(rec.data)).not.toContain('4321');
    const lines = (rec.data as { lines: { id: string; needs_check: boolean }[] }).lines.filter((l) => l.needs_check);
    const conf = await ani.client.rpc('confirm_receipt', {
      p_receipt_id: cap.receipt_id,
      p_lines: lines.map((l) => ({ line_id: l.id, action: 'skip' })),
    });
    expect(conf.error).toBeNull();
    expect(conf.data).toMatchObject({ receipt_status: 'confirmed', saved_count: 1 });
  });
});

describe('hapus akun lewat service role (Q-32)', () => {
  it('begin_account_deletion lewat RPC + auth.admin.deleteUser', async () => {
    const res = await deleteAccount(
      {
        getUser: async () => ({ id: budi.id, last_sign_in_at: new Date().toISOString() }),
        beginDeletion: async (id) => {
          const { error } = await admin.rpc('begin_account_deletion', { p_user_id: id });
          if (error) throw new Error(error.message);
        },
        deleteAuthUser: async (id) => {
          const { error } = await admin.auth.admin.deleteUser(id);
          if (error) throw new Error(error.message);
        },
      },
      { confirm: ACCOUNT_DELETE_CONFIRMATION },
    );
    expect(res.status).toBe(202);
    const h = await db.query('select archived_at from public.household where id = $1', [budi.household]);
    expect(h.rows[0].archived_at).not.toBeNull();
    const m = await db.query('select count(*)::int as n from public.household_member where household_id = $1', [budi.household]);
    expect(m.rows[0].n).toBe(0);
    const viaUser = await ani.client.rpc('begin_account_deletion', { p_user_id: ani.id });
    expect(viaUser.error).not.toBeNull();
  });
});
