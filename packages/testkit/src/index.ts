// Utilitas test L3 (docs/05 §8.1): database lokal dari migration, user uji, dan
// klien RPC yang meniru PostgREST (JWT simulasi → role authenticated + RLS).
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const USERS = {
  a: '00000000-0000-0000-0000-00000000000a',
  b: '00000000-0000-0000-0000-00000000000b',
  c: '00000000-0000-0000-0000-00000000000c',
} as const;

/** URL koneksi untuk database `name` memakai PG* env (default postgres@localhost). */
export function databaseUrl(name: string): string {
  const user = process.env.PGUSER ?? 'postgres';
  const pass = process.env.PGPASSWORD ?? 'postgres';
  const host = process.env.PGHOST ?? 'localhost';
  const port = process.env.PGPORT ?? '5432';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${name}`;
}

/** Bangun database: stub Supabase + semua migration + (opsional) user uji dan katalog contoh. */
export function buildTestDb(name: string, opts: { seed?: boolean } = {}): string {
  const env = { PGHOST: 'localhost', PGUSER: 'postgres', PGPASSWORD: 'postgres', ...process.env };
  execFileSync('bash', [resolve(REPO_ROOT, 'db/tests/build_db.sh'), name], { env, stdio: 'pipe' });
  if (opts.seed !== false) {
    execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', name, '-f', resolve(REPO_ROOT, 'db/tests/lib/seed.sql')], {
      env,
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
  }
  return databaseUrl(name);
}

export function newPool(url: string, max = 5): pg.Pool {
  return new pg.Pool({ connectionString: url, max });
}

export async function householdOf(pool: pg.Pool, userId: string): Promise<string> {
  const r = await pool.query<{ household_id: string }>('select household_id from public.household_member where user_id = $1', [userId]);
  if (!r.rows[0]) throw new Error(`user ${userId} tanpa household`);
  return r.rows[0].household_id;
}

type ArgMeta = { name: string; type: string };
type FnMeta = { args: ArgMeta[]; retset: boolean; composite: boolean };

/**
 * Meniru `supabase.rpc(fn, args)` lewat PostgREST: satu transaksi, role
 * authenticated, klaim JWT `sub`. Bentuk hasil sama dengan PostgREST:
 * setof → array, skalar → nilai, error → { message, code, details, hint }.
 */
export class PgRpcClient {
  private meta = new Map<string, FnMeta>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly userId: string | null,
  ) {}

  private async fnMeta(fn: string): Promise<FnMeta> {
    const cached = this.meta.get(fn);
    if (cached) return cached;
    const r = await this.pool.query<{ names: string[] | null; types: string[]; retset: boolean; typtype: string }>(
      `select p.proargnames as names,
              array(select format_type(t, null) from unnest(p.proargtypes) t) as types,
              p.proretset as retset,
              -- RETURNS TABLE (record + argmode 't') dibentuk seperti tipe komposit oleh PostgREST.
              case when 't'::"char" = any(coalesce(p.proargmodes, '{}')) then 'c' else t.typtype end as typtype
         from pg_proc p join pg_type t on t.oid = p.prorettype
        where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
      [fn],
    );
    const row = r.rows[0];
    if (!row) throw new Error(`RPC public.${fn} tidak ada`);
    const meta: FnMeta = {
      // proargnames memuat juga kolom RETURNS TABLE; argumen input = proargtypes (urutan sama).
      args: row.types.map((type, i) => ({ name: row.names?.[i] ?? `$${i + 1}`, type })),
      retset: row.retset,
      composite: row.typtype === 'c',
    };
    this.meta.set(fn, meta);
    return meta;
  }

  async rpc(fn: string, args: Record<string, unknown> = {}): Promise<{ data: unknown; error: RpcErrorShape | null }> {
    const meta = await this.fnMeta(fn);
    const params: unknown[] = [];
    const named = Object.entries(args)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        const a = meta.args.find((x) => x.name === k);
        if (!a) throw new Error(`parameter ${k} tidak ada di ${fn}`);
        params.push(a.type === 'jsonb' || a.type === 'json' ? JSON.stringify(v) : v);
        return `"${k}" => $${params.length}::${a.type}`;
      })
      .join(', ');
    const call = `public."${fn}"(${named})`;
    const sql = meta.retset
      ? meta.composite
        ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as data from ${call} r`
        : `select coalesce(jsonb_agg(r.x), '[]'::jsonb) as data from ${call} as r(x)`
      : `select to_jsonb(${call}) as data`;

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`,
        [this.userId ? JSON.stringify({ sub: this.userId, role: 'authenticated' }) : ''],
      );
      const r = await client.query<{ data: unknown }>(sql, params);
      await client.query('commit');
      return { data: r.rows[0]?.data ?? null, error: null };
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      const err = e as pg.DatabaseError;
      return { data: null, error: { message: err.message, code: err.code ?? null, details: err.detail ?? null, hint: err.hint ?? null } };
    } finally {
      client.release();
    }
  }

  /** Jalankan SQL bebas sebagai user ini (hanya untuk menyiapkan test, mis. unggah Storage). */
  async asUser<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`, [
        JSON.stringify({ sub: this.userId, role: 'authenticated' }),
      ]);
      const r = await client.query<T>(sql, params);
      await client.query('commit');
      return r;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

export interface RpcErrorShape {
  message: string;
  code: string | null;
  details: string | null;
  hint: string | null;
}

/** Ambil data atau lempar error (untuk test yang mengharapkan sukses). */
export async function rpcOk<T = unknown>(client: PgRpcClient, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message} ${error.details ?? ''}`);
  return data as T;
}
