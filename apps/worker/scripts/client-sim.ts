// Simulasi klien (Tahap 5 belum ada) untuk mode A dan test L3: unggah gambar ke
// LocalBlobStore + baris storage.objects SEBAGAI USER (policy Storage diuji),
// lalu submit_capture lewat RPC dengan JWT simulasi (§5.2).
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { PgRpcClient, householdOf } from '@priceatlas/testkit';
import type { LocalBlobStore } from '../src/adapters/local-blob-store.ts';

export interface SubmitArgs {
  pool: pg.Pool;
  blob: LocalBlobStore;
  userId: string;
  kind: 'receipt' | 'price_label' | 'marketplace';
  images: Buffer[];
  captureId?: string;
  sessionId?: string | null;
  storeId?: string | null;
  branchId?: string | null;
}

export async function uploadAndSubmit(a: SubmitArgs): Promise<{ captureId: string; result: unknown }> {
  const captureId = a.captureId ?? randomUUID();
  const hh = await householdOf(a.pool, a.userId);
  const client = new PgRpcClient(a.pool, a.userId);
  const images = [];
  for (const [i, data] of a.images.entries()) {
    const path = `${hh}/${captureId}/${i + 1}.jpg`;
    await a.blob.put(path, data);
    await client.asUser(`insert into storage.objects (bucket_id, name) values ('captures', $1) on conflict do nothing`, [path]);
    images.push({ position: i + 1, ext: 'jpg', sha256: createHash('sha256').update(data).digest('hex'), byte_size: data.length });
  }
  const { data, error } = await client.rpc('submit_capture', {
    p_capture_id: captureId,
    p_kind: a.kind,
    p_images: images,
    p_shopping_session_id: a.sessionId ?? null,
    p_store_id: a.storeId ?? null,
    p_branch_id: a.branchId ?? null,
  });
  if (error) throw new Error(`submit_capture: ${error.message} ${error.details ?? ''}`);
  return { captureId, result: data };
}
