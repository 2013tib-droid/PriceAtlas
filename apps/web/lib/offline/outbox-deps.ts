// Adapter antrean ke Supabase (docs/07 §3.4, §5.4): Storage dengan JWT user (bukan service role,
// D-61), W1 lewat rpcCall, REST cek hash, refresh sesi (P-09).
import type { RpcInput } from '@priceatlas/contracts';
import { toAppError, type AppError } from '@/lib/data/errors';
import { fetchCaptureImagesBySha } from '@/lib/data/rest';
import { rpcCall } from '@/lib/data/rpc';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { StepOutcome } from './uploader';

export const CAPTURES_BUCKET = 'captures';

interface StorageErrorLike {
  name?: string;
  message?: string;
  status?: number;
  statusCode?: string;
  code?: string;
  error?: string;
  originalError?: unknown;
}

/** Klasifikasi error Storage: "sudah ada" = sukses (upsert false, §5.2 backend). */
export function classifyStorageError(err: StorageErrorLike): StepOutcome {
  const msg = `${err.message ?? ''} ${err.error ?? ''}`;
  const status = err.status ?? (err.statusCode ? Number(err.statusCode) : undefined);
  if (
    status === 409 ||
    err.statusCode === '409' ||
    err.code === 'ResourceAlreadyExists' ||
    /already exists|duplicate/i.test(msg)
  )
    return { ok: true };
  const network =
    err.name === 'StorageUnknownError' ||
    /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false);
  if (network) return { ok: false, kind: 'network', message: err.message ?? null };
  if (status === 401 || /jwt|exp claim|token.*expired/i.test(msg))
    return { ok: false, kind: 'auth', code: String(status ?? ''), message: err.message ?? null };
  if (status !== undefined && (status >= 500 || status === 429 || status === 408))
    return { ok: false, kind: 'transient', code: String(status), message: err.message ?? null };
  return { ok: false, kind: 'permanent', code: status ? String(status) : null, message: err.message ?? null };
}

/** Klasifikasi error W1 (AppError dari rpcCall). JWT kedaluwarsa = PGRST30x (PostgREST). */
export function classifySubmitError(e: AppError): StepOutcome {
  if (e.kind === 'network') return { ok: false, kind: 'network', message: e.message };
  const code = e.rpc?.code ?? null;
  const sqlstate = e.rpc?.sqlstate ?? null;
  if (code === 'CAPTURE_IMAGES_MISSING') return { ok: false, kind: 'missing', code };
  if ((sqlstate && /^PGRST30\d$/.test(sqlstate)) || e.http === 401 || /jwt/i.test(e.message))
    return { ok: false, kind: 'auth', code: sqlstate, message: e.message };
  if (e.kind === 'unknown' || (e.http ?? 500) >= 500)
    return { ok: false, kind: 'transient', code: code ?? sqlstate, message: e.rpc?.hint ?? e.message };
  return { ok: false, kind: 'permanent', code: code ?? sqlstate, message: e.rpc?.hint ?? e.message };
}

export async function uploadToStorage(path: string, blob: Blob, contentType: string): Promise<StepOutcome> {
  try {
    const { error } = await getSupabaseBrowserClient()
      .storage.from(CAPTURES_BUCKET)
      .upload(path, blob, { upsert: false, contentType, cacheControl: '3600' });
    return error ? classifyStorageError(error as StorageErrorLike) : { ok: true };
  } catch (e) {
    return classifyStorageError(e as StorageErrorLike);
  }
}

export async function submitCapture(input: RpcInput<'submit_capture'>): Promise<StepOutcome> {
  try {
    await rpcCall('submit_capture', input);
    return { ok: true };
  } catch (e) {
    return classifySubmitError(toAppError(e));
  }
}

export async function findDuplicates(sha256s: string[], excludeCaptureId: string) {
  try {
    return await fetchCaptureImagesBySha(sha256s, excludeCaptureId);
  } catch (e) {
    const err = toAppError(e);
    // Gagal jaringan → coba lagi nanti; error lain → jangan tahan unggahan (D-71: worker tetap
    // menandai duplikat hash di konfirmasi).
    return err.kind === 'network' ? null : [];
  }
}

export async function refreshSession(): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseBrowserClient().auth.refreshSession();
    return !error && Boolean(data.session);
  } catch {
    return false;
  }
}
