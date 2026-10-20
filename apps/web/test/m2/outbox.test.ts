// L5a M2: antrean foto (docs/07 §5.4) dengan IndexedDB tiruan (fake-indexeddb): state machine,
// backoff, pemicu, penamaan path, F-24 (CAPTURE_IMAGES_MISSING), P-09 (401 → refresh), P-12.
import 'fake-indexeddb/auto';
import type { RpcInput } from '@priceatlas/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/data/errors';
import { deleteUserData } from '@/lib/offline/db';
import { classifyStorageError, classifySubmitError } from '@/lib/offline/outbox-deps';
import { migrateItem, newItem, OutboxStore, storagePath, type OutboxItem } from '@/lib/offline/outbox-store';
import { isForced, OutboxRunner } from '@/lib/offline/runner';
import {
  backoffDelay,
  BACKOFF_MS,
  isEligible,
  keepDuplicate,
  nextWake,
  processItem,
  resetForRetry,
  type StepOutcome,
  type UploaderDeps,
} from '@/lib/offline/uploader';

const USER = '00000000-0000-0000-0000-0000000000aa';
const HH = '2b79642d-67c6-4664-9ea6-99d99f6d6eda';
const CID = '11111111-1111-4111-8111-111111111111';
const SHA = (n: number) => String(n).repeat(64).slice(0, 64);

let store: OutboxStore;
let clock: number;
let online: boolean;
const calls: string[] = [];

function makeDeps(over: Partial<UploaderDeps> = {}): UploaderDeps {
  return {
    store,
    upload: vi.fn(async (path: string) => {
      calls.push(`upload ${path}`);
      return { ok: true } as StepOutcome;
    }),
    submit: vi.fn(async (i: RpcInput<'submit_capture'>) => {
      calls.push(`submit ${i.p_capture_id}`);
      return { ok: true } as StepOutcome;
    }),
    findDuplicates: vi.fn(async () => []),
    refreshSession: vi.fn(async () => true),
    householdId: vi.fn(async () => HH),
    isOnline: () => online,
    now: () => clock,
    ...over,
  };
}

async function enqueue(parts = 2, over: Partial<OutboxItem> = {}): Promise<OutboxItem> {
  const item = {
    ...newItem(
      {
        capture_id: CID,
        kind: 'receipt',
        household_id: HH,
        shopping_session_id: null,
        store_id: null,
        branch_id: null,
        captured_at: '2026-10-20T12:00:00+07:00',
        parts: Array.from({ length: parts }, (_, i) => ({
          position: i + 1,
          ext: 'jpg' as const,
          content_type: 'image/jpeg',
          sha256: SHA(i + 1),
          byte_size: 1000 + i,
        })),
      },
      clock,
    ),
    ...over,
  };
  const blobs = new Map(item.parts.map((p) => [p.position, new Blob([`bagian ${p.position}`])]));
  await store.add(item, blobs);
  return item;
}

beforeEach(async () => {
  await deleteUserData(USER);
  store = OutboxStore.forUser(USER);
  clock = 1_000_000;
  online = true;
  calls.length = 0;
});

describe('penyimpanan', () => {
  it('item + byte disimpan bersama; total byte; hapus menghapus byte', async () => {
    await enqueue(3);
    expect((await store.list()).items).toHaveLength(1);
    expect(await store.getBlob(CID, 2)).toBeInstanceOf(Blob);
    expect(await store.totalBytes()).toBe(1000 + 1001 + 1002);
    await store.remove(CID);
    expect(await store.getBlob(CID, 2)).toBeNull();
    expect((await store.list()).items).toEqual([]);
  });

  it('path Storage {household}/{capture}/{position}.{ext} (D-69)', () => {
    expect(storagePath(HH, CID, { position: 2, ext: 'jpg' })).toBe(`${HH}/${CID}/2.jpg`);
  });

  it('schemaVersion (P-12): versi tidak dikenal tidak diproses tetapi dilaporkan', async () => {
    expect(migrateItem({ schemaVersion: 1, capture_id: 'x' })).toMatchObject({ capture_id: 'x' });
    expect(migrateItem({ schemaVersion: 99, capture_id: 'x' })).toBeNull();
    expect(migrateItem({ capture_id: 'x' })).toBeNull();
    const { openUserDb } = await import('@/lib/offline/db');
    await (await openUserDb(USER)).put('outbox', { capture_id: 'lama', schemaVersion: 99 });
    expect(await store.list()).toEqual({ items: [], unreadable: ['lama'] });
  });
});

describe('state machine §5.4', () => {
  it('captured → uploading(1/2, 2/2) → submitting → submitted; byte dihapus; urutan unggah lalu W1', async () => {
    const item = await enqueue(2);
    const states: string[] = [];
    const deps = makeDeps({ onChange: (i) => states.push(`${i.state}:${i.uploaded.length}`) });
    const out = await processItem(deps, item);
    expect(out.state).toBe('submitted');
    expect(calls).toEqual([`upload ${HH}/${CID}/1.jpg`, `upload ${HH}/${CID}/2.jpg`, `submit ${CID}`]);
    expect(states).toEqual([
      'captured:0',
      'uploading:0',
      'uploading:1',
      'uploading:1',
      'uploading:2',
      'submitting:2',
      'submitted:2',
    ]);
    expect(await store.getBlob(CID, 1)).toBeNull();
    expect(deps.submit).toHaveBeenCalledWith({
      p_capture_id: CID,
      p_kind: 'receipt',
      p_images: [
        { position: 1, ext: 'jpg', sha256: SHA(1), byte_size: 1000 },
        { position: 2, ext: 'jpg', sha256: SHA(2), byte_size: 1001 },
      ],
      p_shopping_session_id: null,
      p_store_id: null,
      p_branch_id: null,
      p_captured_at: '2026-10-20T12:00:00+07:00',
    });
  });

  it('offline → waiting_network dengan backoff; tidak ada request', async () => {
    online = false;
    const out = await processItem(makeDeps(), await enqueue());
    expect(out).toMatchObject({ state: 'waiting_network', attempts: 1, next_attempt_at: clock + 5_000 });
    expect(calls).toEqual([]);
  });

  it('gagal jaringan di bagian 2 → waiting_network; putaran berikut melanjutkan dari bagian 2', async () => {
    let n = 0;
    const deps = makeDeps({
      upload: vi.fn(async (path: string) => {
        calls.push(`upload ${path}`);
        return ++n === 2 ? ({ ok: false, kind: 'network' } as const) : ({ ok: true } as const);
      }),
    });
    const first = await processItem(deps, await enqueue(2));
    expect(first).toMatchObject({ state: 'waiting_network', uploaded: [1], last_error: { kind: 'network' } });
    const second = await processItem(deps, first);
    expect(second.state).toBe('submitted');
    expect(calls.filter((c) => c.endsWith('1.jpg'))).toHaveLength(1);
  });

  it('"sudah ada" di Storage = sukses (upsert false)', () => {
    expect(classifyStorageError({ status: 400, statusCode: '409', message: 'The resource already exists' })).toEqual({
      ok: true,
    });
    expect(classifyStorageError({ status: 409, message: 'Duplicate' })).toEqual({ ok: true });
    expect(classifyStorageError({ name: 'StorageUnknownError', message: 'Failed to fetch' })).toMatchObject({
      kind: 'network',
    });
    expect(classifyStorageError({ status: 401, message: 'jwt expired' })).toMatchObject({ kind: 'auth' });
    expect(
      classifyStorageError({ status: 400, statusCode: '403', message: 'exp claim timestamp check failed' }),
    ).toMatchObject({ kind: 'auth' });
    expect(classifyStorageError({ status: 503, message: 'x' })).toMatchObject({ kind: 'transient' });
    expect(classifyStorageError({ status: 413, message: 'Payload too large' })).toMatchObject({ kind: 'permanent' });
    expect(
      classifyStorageError({ status: 400, statusCode: '403', message: 'new row violates row-level security policy' }),
    ).toMatchObject({ kind: 'permanent' });
  });

  it('gagal permanen Storage → error (S-08 "Coba lagi"/"Hapus"); Coba lagi mengulang dari awal', async () => {
    const deps = makeDeps({ upload: vi.fn(async () => ({ ok: false, kind: 'permanent', code: '415' }) as const) });
    const out = await processItem(deps, await enqueue(1));
    expect(out).toMatchObject({ state: 'error', last_error: { kind: 'storage', code: '415' } });
    expect(isEligible(out, clock, true)).toBe(false);
    const again = resetForRetry(out, clock + 1);
    expect(again).toMatchObject({ state: 'captured', attempts: 0, last_error: null });
    expect(isEligible(again, clock + 1, false)).toBe(true);
  });

  it('F-24: CAPTURE_IMAGES_MISSING → unggah ulang SEMUA bagian → W1 lagi', async () => {
    let submits = 0;
    const deps = makeDeps({
      submit: vi.fn(async () =>
        ++submits === 1
          ? ({ ok: false, kind: 'missing', code: 'CAPTURE_IMAGES_MISSING' } as const)
          : ({ ok: true } as const),
      ),
    });
    const out = await processItem(deps, await enqueue(3));
    expect(out.state).toBe('submitted');
    expect(deps.upload).toHaveBeenCalledTimes(6);
    expect(deps.submit).toHaveBeenCalledTimes(2);
  });

  it('F-24: tetap hilang setelah unggah ulang → menunggu (dicoba lagi otomatis), byte tetap ada', async () => {
    const deps = makeDeps({
      submit: vi.fn(async () => ({ ok: false, kind: 'missing', code: 'CAPTURE_IMAGES_MISSING' }) as const),
    });
    const out = await processItem(deps, await enqueue(1));
    expect(out).toMatchObject({ state: 'waiting_network', last_error: { kind: 'missing' } });
    expect(deps.submit).toHaveBeenCalledTimes(2);
    expect(await store.getBlob(CID, 1)).not.toBeNull();
  });

  it('P-09: 401 → refresh sesi → coba sekali lagi (unggah dan W1)', async () => {
    let u = 0;
    let s = 0;
    const deps = makeDeps({
      upload: vi.fn(async () => (++u === 1 ? ({ ok: false, kind: 'auth' } as const) : ({ ok: true } as const))),
      submit: vi.fn(async () => (++s === 1 ? ({ ok: false, kind: 'auth' } as const) : ({ ok: true } as const))),
    });
    const out = await processItem(deps, await enqueue(1));
    expect(out.state).toBe('submitted');
    expect(deps.refreshSession).toHaveBeenCalledTimes(2);
  });

  it('P-09: refresh gagal → menunggu (sesi diminta lagi), tidak error permanen', async () => {
    const deps = makeDeps({
      upload: vi.fn(async () => ({ ok: false, kind: 'auth' }) as const),
      refreshSession: vi.fn(async () => false),
    });
    const out = await processItem(deps, await enqueue(1));
    expect(out).toMatchObject({ state: 'waiting_network', last_error: { kind: 'auth' } });
  });

  it('W1 ditolak 4xx lain → error; 5xx → menunggu', async () => {
    const perm = await processItem(
      makeDeps({ submit: vi.fn(async () => ({ ok: false, kind: 'permanent', code: 'INVALID_INPUT' }) as const) }),
      await enqueue(1),
    );
    expect(perm).toMatchObject({ state: 'error', last_error: { kind: 'rpc', code: 'INVALID_INPUT' } });
    await store.remove(CID);
    const tr = await processItem(
      makeDeps({ submit: vi.fn(async () => ({ ok: false, kind: 'transient' }) as const) }),
      await enqueue(1),
    );
    expect(tr.state).toBe('waiting_network');
  });

  it('pemetaan error W1', () => {
    const rpc = (message: string, code: string | null) =>
      new AppError(
        'rpc',
        {
          code: null,
          sqlstate: code,
          http: 500,
          detail: {},
          hint: null,
          message,
          ...(message === 'CAPTURE_IMAGES_MISSING' ? { code: 'CAPTURE_IMAGES_MISSING' as const, http: 422 } : {}),
        },
        message,
      );
    expect(classifySubmitError(rpc('CAPTURE_IMAGES_MISSING', 'PT422'))).toMatchObject({ kind: 'missing' });
    expect(classifySubmitError(rpc('JWT expired', 'PGRST303'))).toMatchObject({ kind: 'auth' });
    expect(classifySubmitError(new AppError('network', null, 'Failed to fetch'))).toMatchObject({ kind: 'network' });
    expect(classifySubmitError(rpc('boom', 'XX000'))).toMatchObject({ kind: 'transient' });
    const invalid = new AppError(
      'rpc',
      { code: 'INVALID_INPUT', sqlstate: 'PT400', http: 400, detail: {}, hint: null, message: 'INVALID_INPUT' },
      'x',
    );
    expect(classifySubmitError(invalid)).toMatchObject({ kind: 'permanent', code: 'INVALID_INPUT' });
  });

  it('household dari R1 saat unggah jika belum ada saat foto diambil (offline pertama kali)', async () => {
    const out = await processItem(makeDeps(), await enqueue(1, { household_id: null }));
    expect(out).toMatchObject({ state: 'submitted', household_id: HH });
    const none = makeDeps({ householdId: vi.fn(async () => null) });
    await store.remove(CID);
    expect((await processItem(none, await enqueue(1, { household_id: null }))).state).toBe('waiting_network');
  });
});

describe('cek hash U-10 (§5.4 langkah 2)', () => {
  it('ditunda saat offline, dicek sebelum unggah; duplikat → ditahan tanpa unggah', async () => {
    const match = { capture_id: '22222222-2222-4222-8222-222222222222', created_at: '2026-10-12T05:00:00Z' };
    const deps = makeDeps({ findDuplicates: vi.fn(async () => [match]) });
    const out = await processItem(deps, await enqueue(1));
    expect(out.duplicate).toEqual({ status: 'found', matches: [match] });
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.findDuplicates).toHaveBeenCalledWith([SHA(1)], CID);
    expect(isEligible(out, clock, true)).toBe(false);
    const kept = keepDuplicate(out, clock);
    expect((await processItem(deps, kept)).state).toBe('submitted');
    expect(deps.findDuplicates).toHaveBeenCalledTimes(1);
  });

  it('cek gagal (jaringan) → menunggu, belum diunggah', async () => {
    const deps = makeDeps({ findDuplicates: vi.fn(async () => null) });
    const out = await processItem(deps, await enqueue(1));
    expect(out).toMatchObject({ state: 'waiting_network', duplicate: { status: 'pending' } });
    expect(deps.upload).not.toHaveBeenCalled();
  });
});

describe('backoff dan pemicu', () => {
  it('5 dtk, 30 dtk, 2 mnt, 10 mnt (lalu tetap 10 mnt)', () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffDelay)).toEqual([5_000, 30_000, 120_000, 600_000, 600_000, 600_000]);
    expect(BACKOFF_MS).toEqual([5_000, 30_000, 120_000, 600_000]);
  });

  it('timer menghormati jadwal; online/fokus/foto baru/app dibuka memaksa', () => {
    expect(isForced('timer')).toBe(false);
    for (const t of ['open', 'online', 'visible', 'enqueued', 'manual'] as const) expect(isForced(t)).toBe(true);
    const it0 = {
      ...newItem(
        {
          capture_id: CID,
          kind: 'receipt',
          household_id: HH,
          shopping_session_id: null,
          store_id: null,
          branch_id: null,
          captured_at: null,
          parts: [],
        },
        0,
      ),
      state: 'waiting_network' as const,
      next_attempt_at: 100,
    };
    expect(isEligible(it0, 50, false)).toBe(false);
    expect(isEligible(it0, 50, true)).toBe(true);
    expect(isEligible(it0, 100, false)).toBe(true);
    expect(nextWake([it0])).toBe(100);
  });

  it('runner: offline → menjadwalkan timer backoff; online → timer memproses; satu tab lewat kunci', async () => {
    await enqueue(1);
    online = false;
    const timers: { fn: () => void; ms: number }[] = [];
    const deps = makeDeps();
    let lockCalls = 0;
    const runner = new OutboxRunner({
      store,
      deps,
      lock: async (fn) => {
        lockCalls++;
        return fn();
      },
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => undefined,
    });
    await runner.kick('open');
    expect((await store.get(CID))?.state).toBe('waiting_network');
    expect(timers.at(-1)?.ms).toBe(5_000);
    online = true;
    clock += 5_000;
    timers.at(-1)!.fn();
    await vi.waitFor(async () => expect((await store.get(CID))?.state).toBe('submitted'));
    expect(lockCalls).toBe(2);
    runner.stop();
  });

  it('runner: tab lain memegang kunci → tidak memproses', async () => {
    await enqueue(1);
    const deps = makeDeps();
    const runner = new OutboxRunner({
      store,
      deps,
      lock: async () => undefined,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    await runner.kick('enqueued');
    expect(deps.upload).not.toHaveBeenCalled();
    expect((await store.get(CID))?.state).toBe('captured');
  });
});
