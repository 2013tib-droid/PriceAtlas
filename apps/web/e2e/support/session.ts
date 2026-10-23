// Helper e2e M4 (Node, BUKAN kode klien): baca/ubah data sesi belanja lewat service role (sisi test
// saja, D-61). Migration, RPC, dan logika worker tidak diubah.
import { admin } from './supabase';

export interface SessionRow {
  id: string;
  branch_id: string;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
}

export async function sessionsOf(householdId: string): Promise<SessionRow[]> {
  const { data, error } = await admin()
    .from('shopping_session')
    .select('id,branch_id,started_at,expires_at,ended_at')
    .eq('household_id', householdId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return data as SessionRow[];
}

/** Majukan `expires_at` supaya sesi "hampir kedaluwarsa" (< 30 mnt) tanpa menunggu 3,5 jam. */
export async function expireSessionIn(sessionId: string, ms: number): Promise<void> {
  const { error } = await admin()
    .from('shopping_session')
    .update({ expires_at: new Date(Date.now() + ms).toISOString() })
    .eq('id', sessionId);
  if (error) throw error;
}

export interface CaptureRow {
  id: string;
  kind: string;
  status: string;
  error_code: string | null;
  shopping_session_id: string | null;
  store_id: string | null;
  branch_id: string | null;
}

export async function sessionCaptures(householdId: string): Promise<CaptureRow[]> {
  const { data, error } = await admin()
    .from('capture')
    .select('id,kind,status,error_code,shopping_session_id,store_id,branch_id')
    .eq('household_id', householdId)
    .order('uploaded_at', { ascending: true });
  if (error) throw error;
  return data as CaptureRow[];
}

/** Byte gambar posisi 1 dari Storage (bucket privat `captures`). */
export async function imageBytes(captureId: string): Promise<{ bytes: Buffer; sha256: string }> {
  const db = admin();
  const { data: img, error } = await db
    .from('capture_image')
    .select('storage_path,sha256')
    .eq('capture_id', captureId)
    .eq('position', 1)
    .single();
  if (error) throw error;
  const { data, error: e2 } = await db.storage.from('captures').download(img.storage_path as string);
  if (e2) throw e2;
  return { bytes: Buffer.from(await data.arrayBuffer()), sha256: img.sha256 as string };
}

/** Ukuran piksel JPEG dari penanda SOF (cukup untuk memeriksa frame kamera ≤ 2048 px). */
export function jpegSize(b: Buffer): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
