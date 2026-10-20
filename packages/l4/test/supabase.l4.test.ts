// L4 HTTP terhadap Supabase CLI lokal (docs/07 §1.2, §11.4; D-78). Butir yang sebelumnya hanya
// diperiksa statis: OTP + template (F-18, F-20), PTnnn → HTTP (PostgREST), policy Storage asli
// (D-69), dan worker dengan WORKER_DB_ROLE=service_role (F-22).
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { MyContextSchema, parseRpcError } from '@priceatlas/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANON_KEY, API_URL, DB_URL, SERVICE_KEY, anon, latestEmail, signedInUser, uniqueEmail } from './env.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = resolve(ROOT, 'apps/worker/test/fixtures/struk-aeon.jpg');
const pool = new pg.Pool({ connectionString: DB_URL, max: 2 });
afterAll(() => pool.end());

type User = Awaited<ReturnType<typeof signedInUser>>;
let a: User;
let b: User;
let hhA: string;
let hhB: string;

async function household(u: User): Promise<string> {
  const { data, error } = await u.client.rpc('get_my_context');
  if (error) throw error;
  return MyContextSchema.parse(data).household.id;
}

beforeAll(async () => {
  a = await signedInUser('a');
  b = await signedInUser('b');
  hhA = await household(a);
  hhB = await household(b);
});

describe('Auth OTP lewat Mailpit (F-18, F-20, D-83)', () => {
  it('email berisi kode 6 digit Indonesia tanpa tautan; kode salah ditolak; kode benar memberi sesi + household', async () => {
    const email = uniqueEmail('otp');
    const c = anon();
    const sent = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    expect(sent.error).toBeNull();

    const msg = await latestEmail(email);
    expect(msg.Subject).toMatch(/^Kode masuk PriceAtlas: \d{6}$/);
    expect(msg.HTML).toContain('<html lang="id">');
    expect(msg.HTML).not.toMatch(/href=|\/verify\?/i);
    const code = /\b(\d{6})\b/.exec(msg.Text || msg.HTML)?.[1];
    expect(code).toMatch(/^\d{6}$/);

    // Perilaku GoTrue untuk kode salah (dipakai lib/auth/otp-errors.ts).
    const wrong = await c.auth.verifyOtp({ email, token: code === '000000' ? '111111' : '000000', type: 'email' });
    console.log(`[L4] verifyOtp kode salah → code=${wrong.error?.code} status=${wrong.error?.status}`);
    expect(wrong.error?.code).toBe('otp_expired');

    const ok = await c.auth.verifyOtp({ email, token: code!, type: 'email' });
    expect(ok.error).toBeNull();
    const { data, error } = await c.rpc('get_my_context');
    expect(error).toBeNull();
    const ctx = MyContextSchema.parse(data);
    expect(ctx.role).toBe('owner');
    expect(ctx.household.timezone).toBe('Asia/Jakarta');
  });
});

describe('PTnnn → HTTP lewat PostgREST (§3.1)', () => {
  const call = (fn: string, body: unknown, token = a.token) =>
    fetch(`${API_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('NOT_FOUND → 404 dengan message/detail/hint', async () => {
    const id = randomUUID();
    const res = await call('retry_capture', { p_capture_id: id });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string; details: string; hint: string };
    expect(body).toMatchObject({ code: 'PT404', message: 'NOT_FOUND' });
    expect(JSON.parse(body.details)).toEqual({ capture_id: id });
    expect(body.hint).toBeTruthy();
    // Bentuk yang sama lewat supabase-js → parseRpcError (packages/contracts).
    const { error } = await a.client.rpc('retry_capture', { p_capture_id: id });
    expect(parseRpcError(error!)).toMatchObject({ code: 'NOT_FOUND', sqlstate: 'PT404', http: 404, detail: { capture_id: id } });
  });

  it('INVALID_STATE → 409', async () => {
    const res = await call('share_existing_prices', {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'PT409', message: 'INVALID_STATE' });
  });

  it('CAPTURE_IMAGES_MISSING → 422', async () => {
    const res = await call('submit_capture', {
      p_capture_id: randomUUID(),
      p_kind: 'receipt',
      p_images: [{ position: 1, ext: 'jpg', sha256: 'a'.repeat(64), byte_size: 10 }],
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'PT422', message: 'CAPTURE_IMAGES_MISSING' });
  });

  it('anon tidak bisa menjalankan RPC (hanya authenticated)', async () => {
    const res = await call('get_my_context', {}, ANON_KEY);
    expect([401, 403]).toContain(res.status);
  });
});

describe('policy Storage asli (D-69, 0150)', () => {
  const img = readFileSync(FIXTURE);
  const up = (u: User, path: string, upsert = false) =>
    u.client.storage.from('captures').upload(path, img, { contentType: 'image/jpeg', upsert });

  it('unggah ke folder household sendiri berhasil; ulang = konflik (upsert false)', async () => {
    const path = `${hhA}/${randomUUID()}/1.jpg`;
    expect((await up(a, path)).error).toBeNull();
    const again = await up(a, path);
    expect(again.error).not.toBeNull();
    // upsert butuh policy UPDATE yang memang tidak ada.
    expect((await up(a, path, true)).error).not.toBeNull();
  });

  it('folder household lain dan kedalaman path salah ditolak', async () => {
    expect((await up(a, `${hhB}/${randomUUID()}/1.jpg`)).error).not.toBeNull();
    expect((await up(a, `${hhA}/1.jpg`)).error).not.toBeNull();
    expect((await up(a, `${hhA}/${randomUUID()}/x/1.jpg`)).error).not.toBeNull();
  });

  it('user lain tidak bisa membaca; pemilik bisa membuat signed URL; user tidak bisa menghapus', async () => {
    const path = `${hhA}/${randomUUID()}/1.jpg`;
    expect((await up(a, path)).error).toBeNull();
    expect((await b.client.storage.from('captures').download(path)).error).not.toBeNull();
    const signed = await a.client.storage.from('captures').createSignedUrl(path, 300);
    expect(signed.error).toBeNull();
    expect((await fetch(signed.data!.signedUrl)).status).toBe(200);

    await a.client.storage.from('captures').remove([path]);
    // Tanpa policy DELETE: file tetap ada.
    expect((await a.client.storage.from('captures').download(path)).error).toBeNull();
  });

  it('tipe file di luar whitelist ditolak bucket', async () => {
    const r = await a.client.storage
      .from('captures')
      .upload(`${hhA}/${randomUUID()}/1.gif`, Buffer.from('GIF89a'), { contentType: 'image/gif' });
    expect(r.error).not.toBeNull();
  });
});

describe('worker di Supabase dengan WORKER_DB_ROLE=service_role (F-22)', () => {
  it('struk-aeon: unggah sebagai user → submit_capture → worker --once → needs_confirmation', async () => {
    const img = readFileSync(FIXTURE);
    const captureId = randomUUID();
    const path = `${hhA}/${captureId}/1.jpg`;
    expect((await a.client.storage.from('captures').upload(path, img, { contentType: 'image/jpeg' })).error).toBeNull();
    const sub = await a.client.rpc('submit_capture', {
      p_capture_id: captureId,
      p_kind: 'receipt',
      p_images: [{ position: 1, ext: 'jpg', sha256: createHash('sha256').update(img).digest('hex'), byte_size: img.length }],
    });
    expect(sub.error).toBeNull();

    await promisify(execFile)('pnpm', ['--filter', '@priceatlas/worker', 'start', '--once'], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: DB_URL,
        WORKER_DB_ROLE: 'service_role',
        STORAGE_BACKEND: 'supabase',
        NEXT_PUBLIC_SUPABASE_URL: API_URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
        EXTRACTOR: 'stub',
      },
      timeout: 120_000,
    });

    const r = await pool.query<{ status: string }>('select status from public.capture where id = $1', [captureId]);
    expect(r.rows[0]?.status).toBe('needs_confirmation');
    // Worker terhubung dengan -c role=service_role; jika postgres tidak bisa memakai role itu,
    // koneksi gagal dan capture tetap 'uploaded'.
    const runs = await pool.query<{ n: number }>(
      `select count(*)::int as n from public.processing_run where capture_id = $1 and status = 'succeeded'`,
      [captureId],
    );
    expect(runs.rows[0]?.n).toBe(1);
    const { data } = await a.client.rpc('list_captures');
    expect((data as { id: string; status: string }[]).find((c) => c.id === captureId)?.status).toBe('needs_confirmation');
  });
});
