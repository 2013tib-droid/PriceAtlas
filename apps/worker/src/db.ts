import pg from 'pg';

// Worker memakai koneksi sesi langsung (bukan transaction pooler) supaya LISTEN jalan (§1.3).
// WORKER_DB_ROLE (opsional, mode A): SET ROLE service_role setiap koneksi, sehingga
// hak yang diuji sama dengan di Supabase.
export function createPool(url: string, opts: { role?: string | null; max?: number } = {}): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 4 });
  if (opts.role) {
    const role = opts.role;
    if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`WORKER_DB_ROLE tidak valid: ${role}`);
    pool.on('connect', (client) => {
      void client.query(`set role ${role}`);
    });
  }
  return pool;
}

export type Db = pg.Pool;
