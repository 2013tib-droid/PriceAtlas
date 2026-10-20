// Hapus akun (§7.6): logika route dengan dependensi palsu, lalu terhadap database lokal
// (begin_account_deletion lewat service role, deleteUser = hapus auth.users).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ACCOUNT_DELETE_CONFIRMATION } from '@priceatlas/contracts';
import { USERS, buildTestDb, householdOf, newPool } from '@priceatlas/testkit';
import { deleteAccount, type DeleteAccountDeps } from '../lib/account/delete.ts';

const now = new Date('2026-10-19T10:00:00Z');
const fresh = { id: USERS.a, last_sign_in_at: '2026-10-19T09:50:00Z' };

function fakes(over: Partial<DeleteAccountDeps> = {}) {
  const calls: string[] = [];
  const deps: DeleteAccountDeps = {
    getUser: async () => fresh,
    beginDeletion: async (id) => void calls.push(`begin:${id}`),
    deleteAuthUser: async (id) => void calls.push(`delete:${id}`),
    ...over,
  };
  return { deps, calls };
}

describe('deleteAccount (logika route)', () => {
  it('sukses → 202, langkah berurutan', async () => {
    const { deps, calls } = fakes();
    expect(await deleteAccount(deps, { confirm: ACCOUNT_DELETE_CONFIRMATION }, now)).toMatchObject({ status: 202 });
    expect(calls).toEqual([`begin:${USERS.a}`, `delete:${USERS.a}`]);
  });
  it.each([
    ['tanpa sesi', { getUser: async () => null }, { confirm: ACCOUNT_DELETE_CONFIRMATION }],
    [
      'login lebih dari 15 menit',
      { getUser: async () => ({ id: USERS.a, last_sign_in_at: '2026-10-19T09:40:00Z' }) },
      { confirm: ACCOUNT_DELETE_CONFIRMATION },
    ],
    ['tanpa teks konfirmasi', {}, {}],
    ['teks konfirmasi salah', {}, { confirm: 'hapus' }],
  ])('%s → REAUTH_REQUIRED tanpa perubahan', async (_l, over, body) => {
    const { deps, calls } = fakes(over as Partial<DeleteAccountDeps>);
    expect(await deleteAccount(deps, body, now)).toMatchObject({ status: 401, body: { error: 'REAUTH_REQUIRED' } });
    expect(calls).toEqual([]);
  });
  it('gagal di langkah 2 → tidak ada perubahan', async () => {
    const { deps, calls } = fakes({
      beginDeletion: async () => {
        throw new Error('db');
      },
    });
    expect(await deleteAccount(deps, { confirm: ACCOUNT_DELETE_CONFIRMATION }, now)).toMatchObject({
      status: 500,
      body: { error: 'DELETE_FAILED' },
    });
    expect(calls).toEqual([]);
  });
  it('gagal di langkah 3 → bisa diulang', async () => {
    let fail = true;
    const { deps } = fakes({
      deleteAuthUser: async () => {
        if (fail) throw new Error('auth');
      },
    });
    expect((await deleteAccount(deps, { confirm: ACCOUNT_DELETE_CONFIRMATION }, now)).status).toBe(500);
    fail = false;
    expect((await deleteAccount(deps, { confirm: ACCOUNT_DELETE_CONFIRMATION }, now)).status).toBe(202);
  });
});

describe('deleteAccount terhadap database lokal', () => {
  let admin: pg.Pool;
  let service: pg.Pool;
  beforeAll(() => {
    const url = buildTestDb('priceatlas_l3_web');
    admin = newPool(url);
    service = newPool(url);
    service.on('connect', (c) => void c.query('set role service_role'));
  });
  afterAll(async () => {
    await service.end();
    await admin.end();
  });

  it('household diarsipkan, job antre, user + membership terhapus; ulang aman', async () => {
    const hh = await householdOf(admin, USERS.a);
    const deps: DeleteAccountDeps = {
      getUser: async () => fresh,
      beginDeletion: async (id) => void (await service.query('select public.begin_account_deletion($1)', [id])),
      deleteAuthUser: async (id) => void (await admin.query('delete from auth.users where id = $1', [id])),
    };
    expect((await deleteAccount(deps, { confirm: ACCOUNT_DELETE_CONFIRMATION }, now)).status).toBe(202);
    expect((await deleteAccount(deps, { confirm: ACCOUNT_DELETE_CONFIRMATION }, now)).status).toBe(202);
    const h = await admin.query('select archived_at from public.household where id = $1', [hh]);
    expect(h.rows[0].archived_at).not.toBeNull();
    const m = await admin.query('select count(*)::int as n from public.household_member where household_id = $1', [hh]);
    expect(m.rows[0].n).toBe(0);
    const j = await admin.query(
      `select count(*)::int as n from app.job where kind = 'delete_household' and payload ->> 'household_id' = $1`,
      [hh],
    );
    expect(j.rows[0].n).toBe(1);
  });

  it('begin_account_deletion tidak bisa dijalankan user biasa', async () => {
    const c = await admin.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`, [
        JSON.stringify({ sub: USERS.b }),
      ]);
      await expect(c.query('select public.begin_account_deletion($1)', [USERS.b])).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
