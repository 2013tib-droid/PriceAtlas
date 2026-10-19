// BlobStore lewat Supabase Storage API (service role, server-only). Penghapusan
// selalu lewat API supaya file di penyimpanan objek ikut terhapus (§7.3).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlobStore } from '../pipeline/types.ts';

export class SupabaseBlobStore implements BlobStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket = 'captures',
  ) {}

  async get(path: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error || !data) throw new Error(`unduh gagal: ${path}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async delete(paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await this.client.storage.from(this.bucket).remove(paths.slice(i, i + 100));
      if (error) throw new Error(`hapus gagal: ${error.message}`);
    }
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (folder: string): Promise<void> => {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await this.client.storage.from(this.bucket).list(folder, { limit: 1000, offset });
        if (error) throw new Error(`list gagal: ${error.message}`);
        for (const e of data ?? []) {
          const path = folder ? `${folder}/${e.name}` : e.name;
          if (e.id === null) await walk(path);       // folder
          else out.push(path);
        }
        if (!data || data.length < 1000) break;
      }
    };
    await walk(prefix.replace(/\/+$/, ''));
    return out.sort();
  }
}
