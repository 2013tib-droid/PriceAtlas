// Helper e2e M2 (Node, BUKAN kode klien): fixture worker dan data capture lewat service role
// (sisi test saja, D-61). Worker stub dijalankan terpisah (job CI supabase-e2e).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { admin } from './supabase';

export const WORKER_FIXTURES = resolve(import.meta.dirname, '../../../worker/test/fixtures');
export const fixture = (name: string) => resolve(WORKER_FIXTURES, `${name}.jpg`);
export const fixtureSha = (name: string) =>
  createHash('sha256')
    .update(readFileSync(fixture(name)))
    .digest('hex');

export async function householdOf(userId: string): Promise<string> {
  const { data, error } = await admin().from('household_member').select('household_id').eq('user_id', userId).single();
  if (error) throw error;
  return data.household_id as string;
}

export async function capturesOf(householdId: string) {
  const { data, error } = await admin()
    .from('capture')
    .select('id,status,kind,error_code')
    .eq('household_id', householdId)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return data as { id: string; status: string; kind: string; error_code: string | null }[];
}

export async function imagesOf(captureId: string) {
  const { data, error } = await admin()
    .from('capture_image')
    .select('position,sha256,storage_path')
    .eq('capture_id', captureId)
    .order('position', { ascending: true });
  if (error) throw error;
  return data as { position: number; sha256: string; storage_path: string }[];
}

/**
 * Lewati jeda backoff retry otomatis (30 dtk, 2 mnt; docs/05 §5.3) tanpa menunggu: mundurkan waktu
 * run sebelumnya. Data test saja; logika worker/claim tidak diubah.
 */
export async function skipBackoff(captureId: string): Promise<void> {
  const db = admin();
  const { data, error } = await db
    .from('processing_run')
    .select('id,started_at,finished_at')
    .eq('capture_id', captureId);
  if (error) throw error;
  const hourAgo = (t: string | null) => (t ? new Date(Date.parse(t) - 3_600_000).toISOString() : null);
  for (const r of data as { id: string; started_at: string; finished_at: string | null }[]) {
    const { error: e } = await db
      .from('processing_run')
      .update({ started_at: hourAgo(r.started_at), finished_at: hourAgo(r.finished_at) })
      .eq('id', r.id);
    if (e) throw e;
  }
}
