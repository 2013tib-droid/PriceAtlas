import pg from 'pg';

// Worker memakai koneksi sesi (langsung atau session pooler, bukan transaction pooler) supaya LISTEN
// jalan (§1.3). WORKER_DB_ROLE (opsional): role yang dipakai setiap koneksi, sehingga hak yang diuji
// sama dengan di Supabase (F-22). Cara memasangnya (WORKER_DB_ROLE_MODE, Tahap 7b B2 / F-186):
//   startup (default) — parameter startup `-c role=<role>`, berlaku sebelum query apa pun;
//   set               — `SET ROLE <role>` sebagai query pertama setiap koneksi baru. Cadangan jika
//                       pooler produksi tidak meneruskan parameter startup (docs/09 §6.3).
// Di produksi role biasanya dipasang lewat `ALTER ROLE priceatlas_worker SET role service_role`
// dan WORKER_DB_ROLE dikosongkan.
export type RoleMode = 'startup' | 'set';

export function parseRoleMode(v: string | undefined | null): RoleMode {
  const m = (v ?? '').trim();
  if (m === '' || m === 'startup') return 'startup';
  if (m === 'set') return 'set';
  throw new Error(`WORKER_DB_ROLE_MODE tidak valid: ${m} (startup | set)`);
}

export function createPool(url: string, opts: { role?: string | null; roleMode?: RoleMode; max?: number } = {}): pg.Pool {
  const role = opts.role ?? null;
  if (role && !/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`WORKER_DB_ROLE tidak valid: ${role}`);
  const mode = opts.roleMode ?? 'startup';
  const setRole = role && mode === 'set';
  return new pg.Pool({
    connectionString: url,
    max: opts.max ?? 4,
    ...(role && mode === 'startup' ? { options: `-c role=${role}` } : {}),
    // Hook pg-pool `onConnect` ditunggu sebelum klien diserahkan ke pemanggil. Jika SET ROLE gagal,
    // pg-pool menutup koneksi dan meneruskan error ke pemanggil: worker tidak pernah diam-diam berjalan
    // sebagai role login. Nama role sudah divalidasi pola di atas.
    ...(setRole
      ? {
          onConnect: (async (c: pg.ClientBase) => {
            await c.query(`set role ${role}`);
          }) as unknown as (c: pg.ClientBase) => void,
        }
      : {}),
  });
}

/**
 * Role efektif koneksi worker. `expected` (WORKER_DB_ROLE, atau WORKER_EXPECT_ROLE di produksi)
 * berbeda → error, supaya worker tidak berjalan sebagai `postgres`/role lain (F-22, F-186).
 */
export async function checkDbRole(db: pg.Pool, expected: string | null): Promise<string> {
  const r = await db.query<{ current_user: string }>('select current_user');
  const actual = r.rows[0]!.current_user;
  if (expected && actual !== expected) throw new Error(`role database worker ${actual}, seharusnya ${expected}`);
  return actual;
}

export type Db = pg.Pool;
