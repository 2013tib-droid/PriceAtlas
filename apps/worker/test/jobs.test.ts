// L3: job worker (§7.4–§7.6) dengan LocalBlobStore.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USERS, householdOf, rpcOk } from '@priceatlas/testkit';
import { REDACTED } from '../src/jobs/redact.ts';
import { runNextJob, sweepOrphans } from '../src/jobs/run-job.ts';
import { processNextCapture } from '../src/pipeline/process-capture.ts';
import { Worker } from '../src/worker.ts';
import { setupEnv, submitFixture, type Env } from './helpers.ts';

let env: Env;
let aeonCapture: string;
beforeAll(async () => {
  env = setupEnv('priceatlas_l3_jobs');
  ({ captureId: aeonCapture } = await submitFixture(env, 'struk-aeon'));
  await processNextCapture(env.deps);
});
afterAll(async () => {
  await env.close();
});

const fileOf = (path: string) => join(env.blob.rootDir, 'captures', path);
const jobDeps = () => ({ db: env.workerDb, blob: env.blob });

describe('purge_images (D-32, Q-14)', () => {
  it('file dihapus lewat BlobStore, purged_at terisi, receipt.pii dikosongkan', async () => {
    const img = await env.admin.query('select storage_path from public.capture_image where capture_id = $1', [aeonCapture]);
    const path = img.rows[0].storage_path as string;
    expect(existsSync(fileOf(path))).toBe(true);

    await env.admin.query(`update public.capture_image set purge_after = now() - interval '1 day' where capture_id = $1`, [aeonCapture]);
    await env.workerDb.query('select app.enqueue_retention()');
    expect(await runNextJob(jobDeps())).toMatchObject({ kind: 'purge_images', outcome: 'purged:1' });

    expect(existsSync(fileOf(path))).toBe(false);
    const st = await env.admin.query('select count(*)::int as n from storage.objects where name = $1', [path]);
    expect(st.rows[0].n).toBe(0);
    const ci = await env.admin.query('select purged_at, sha256 from public.capture_image where capture_id = $1', [aeonCapture]);
    expect(ci.rows[0].purged_at).not.toBeNull();
    expect(ci.rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    const rc = await env.admin.query('select pii from public.receipt where capture_id = $1', [aeonCapture]);
    expect(rc.rows[0].pii).toEqual({});
  });
});

describe('redact_ocr (§7.4)', () => {
  it('teks OCR dan output AI mentah disamarkan setelah N hari', async () => {
    // Struk ini masih needs_confirmation → selesaikan dulu (redaksi hanya untuk capture final).
    const rc = await env.admin.query('select id from public.receipt where capture_id = $1', [aeonCapture]);
    const rec = await rpcOk<{ lines: { id: string; needs_check: boolean }[] }>(env.ani, 'get_receipt', { p_receipt_id: rc.rows[0].id });
    await rpcOk(env.ani, 'confirm_receipt', {
      p_receipt_id: rc.rows[0].id,
      p_lines: rec.lines.filter((l) => l.needs_check).map((l) => ({ line_id: l.id, action: 'skip' })),
    });
    await env.admin.query(`update public.capture set processed_at = now() - interval '8 days' where id = $1`, [aeonCapture]);
    await env.workerDb.query('select app.enqueue_retention()');
    expect(await runNextJob(jobDeps())).toMatchObject({ kind: 'redact_ocr', outcome: 'redacted:1' });
    const run = await env.admin.query('select raw_ocr_text, raw_ai_output, pii_redacted_at from public.processing_run where capture_id = $1', [aeonCapture]);
    expect(run.rows[0].pii_redacted_at).not.toBeNull();
    expect(run.rows[0].raw_ocr_text).not.toMatch(/4321|081298765432/);
    expect(run.rows[0].raw_ocr_text).toContain(REDACTED);
    expect(run.rows[0].raw_ocr_text).toContain('MILO ORI 500G');
    expect(run.rows[0].raw_ai_output.pii).toEqual({});
    expect(JSON.stringify(run.rows[0].raw_ai_output)).not.toMatch(/081298765432/);
  });
});

describe('purge_storage_paths (delete_capture, F-14)', () => {
  it('hapus capture yang gagal → file dihapus worker', async () => {
    const { captureId } = await submitFixture(env, 'struk-buram');
    await processNextCapture(env.deps);
    const hh = await householdOf(env.admin, USERS.a);
    const path = `${hh}/${captureId}/1.jpg`;
    expect(existsSync(fileOf(path))).toBe(true);
    await rpcOk(env.ani, 'delete_capture', { p_capture_id: captureId });
    expect(await runNextJob(jobDeps())).toMatchObject({ kind: 'purge_storage_paths', outcome: 'done' });
    expect(existsSync(fileOf(path))).toBe(false);
  });
});

describe('sapuan unggahan yatim (§5.2)', () => {
  it('objek tanpa capture_image > 24 jam dihapus, yang baru dibiarkan', async () => {
    const hh = await householdOf(env.admin, USERS.b);
    const old = `${hh}/aaaaaaaa-0000-4000-8000-000000000001/1.jpg`;
    const fresh = `${hh}/aaaaaaaa-0000-4000-8000-000000000002/1.jpg`;
    for (const p of [old, fresh]) {
      await env.blob.put(p, Buffer.from('x'));
      await env.budi.asUser(`insert into storage.objects (bucket_id, name) values ('captures', $1)`, [p]);
    }
    await env.admin.query(`update storage.objects set created_at = now() - interval '25 hours' where name = $1`, [old]);
    expect(await sweepOrphans(jobDeps())).toBe(1);
    expect(existsSync(fileOf(old))).toBe(false);
    expect(existsSync(fileOf(fresh))).toBe(true);
  });
});

describe('delete_household (§7.6, BR-8)', () => {
  it('menunggu user dihapus, lalu hapus file + seluruh data; fakta publik tetap', async () => {
    await rpcOk(env.budi, 'set_share_prices_public', { p_enabled: true });
    const { captureId } = await submitFixture(env, 'shopee-milo', { user: USERS.b });
    await processNextCapture(env.deps);
    const hh = await householdOf(env.admin, USERS.b);
    const facts0 = (await env.admin.query('select count(*)::int as n from public.public_price_fact')).rows[0].n;
    expect(facts0).toBeGreaterThan(0);

    // Route Handler langkah 2 (service role).
    await env.workerDb.query('select public.begin_account_deletion($1)', [USERS.b]);
    expect(await runNextJob(jobDeps())).toMatchObject({ kind: 'delete_household', outcome: 'waiting' });

    // Langkah 3: auth.admin.deleteUser.
    await env.admin.query('delete from auth.users where id = $1', [USERS.b]);
    await env.admin.query(`update app.job set run_after = now() where kind = 'delete_household'`);
    const r = await runNextJob(jobDeps());
    expect(r?.outcome).toMatch(/^deleted:\d+$/);

    expect(await env.blob.list(`${hh}/`)).toEqual([]);
    const left = await env.admin.query('select count(*)::int as n from storage.objects where starts_with(name, $1)', [`${hh}/`]);
    expect(left.rows[0].n).toBe(0);
    expect((await env.admin.query('select count(*)::int as n from public.household where id = $1', [hh])).rows[0].n).toBe(0);
    expect((await env.admin.query('select count(*)::int as n from public.capture where id = $1', [captureId])).rows[0].n).toBe(0);
    expect((await env.admin.query('select count(*)::int as n from public.public_price_fact')).rows[0].n).toBe(facts0);
    expect((await env.admin.query(`select status from app.job where kind = 'delete_household'`)).rows[0].status).toBe('done');
  });

  it('worker memproses job lewat drainOnce (idempoten saat household sudah tidak ada)', async () => {
    await env.admin.query(
      `insert into app.job (kind, payload) values ('delete_household', jsonb_build_object('household_id', gen_random_uuid()))`,
    );
    const w = new Worker({ ...env.deps, workerId: 'w-jobs' });
    expect(await w.drainOnce()).toBe(1);
    const st = await env.admin.query(`select status from app.job where kind = 'delete_household' order by id desc limit 1`);
    expect(st.rows[0].status).toBe('done');
  });
});
