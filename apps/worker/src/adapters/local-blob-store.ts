// BlobStore folder lokal (mode A, test). Meniru Storage API: menghapus file juga
// menghapus baris storage.objects (stub), seperti Storage API Supabase.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type pg from 'pg';
import type { BlobStore } from '../pipeline/types.ts';

export class LocalBlobStore implements BlobStore {
  constructor(
    readonly rootDir: string,
    private readonly db?: pg.Pool,
    readonly bucket = 'captures',
  ) {}

  private file(path: string): string {
    if (path.includes('..')) throw new Error(`path tidak valid: ${path}`);
    return join(this.rootDir, this.bucket, path);
  }

  async put(path: string, data: Buffer): Promise<void> {
    const f = this.file(path);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f, data);
  }

  async get(path: string): Promise<Buffer> {
    return readFile(this.file(path));
  }

  async delete(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await Promise.all(paths.map((p) => rm(this.file(p), { force: true })));
    await this.db?.query('delete from storage.objects where bucket_id = $1 and name = any($2)', [this.bucket, paths]);
  }

  async list(prefix: string): Promise<string[]> {
    const base = join(this.rootDir, this.bucket);
    const out = new Set<string>();
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else out.add(relative(base, full).split('\\').join('/'));
      }
    };
    await walk(join(base, prefix));
    if (this.db) {
      const r = await this.db.query<{ name: string }>(
        'select name from storage.objects where bucket_id = $1 and starts_with(name, $2)',
        [this.bucket, prefix],
      );
      for (const row of r.rows) out.add(row.name);
    }
    return [...out].sort();
  }
}
