// Satu bentuk error untuk UI (docs/07 §8.1): error RPC (parseRpcError), jaringan, atau lain.
import { parseRpcError, type RpcError, type RpcErrorLike } from '@priceatlas/contracts';
import { ERROR_COPY, GENERIC_COPY, SQLSTATE_COPY, type ErrorCopy, type Screen } from '@/lib/copy/id';

export type AppErrorKind = 'rpc' | 'network' | 'unknown';

export class AppError extends Error {
  constructor(
    readonly kind: AppErrorKind,
    readonly rpc: RpcError | null,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
  }

  get code() {
    return this.rpc?.code ?? null;
  }
  get http() {
    return this.rpc?.http ?? null;
  }
}

/** supabase-js membungkus kegagalan fetch sebagai pesan "Failed to fetch"/"NetworkError…" tanpa kode. */
export function isNetworkFailure(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : '';
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(msg);
}

export function fromRpcError(e: RpcErrorLike): AppError {
  if (!e.code && isNetworkFailure(e)) return new AppError('network', null, e.message);
  const rpc = parseRpcError(e);
  return new AppError('rpc', rpc, rpc.message);
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (isNetworkFailure(e))
    return new AppError('network', null, e instanceof Error ? e.message : 'network', { cause: e });
  return new AppError('unknown', null, e instanceof Error ? e.message : String(e), { cause: e });
}

/**
 * Pesan untuk ditampilkan (§8.1): kode bisnis → SQLSTATE bawaan → hint server
 * (berbahasa Indonesia dari app.err) → cadangan umum.
 */
export function errorCopy(e: unknown, screen?: Screen): Required<Pick<ErrorCopy, 'message'>> & { action?: string } {
  const err = toAppError(e);
  if (err.kind === 'network') return GENERIC_COPY.network;
  const pick = (c: ErrorCopy) => ({ message: (screen && c.byScreen?.[screen]) || c.message, action: c.action });
  if (err.rpc?.code) return pick(ERROR_COPY[err.rpc.code]);
  if (err.rpc?.sqlstate && SQLSTATE_COPY[err.rpc.sqlstate]) return pick(SQLSTATE_COPY[err.rpc.sqlstate]!);
  if (err.rpc?.hint) return { message: err.rpc.hint, action: GENERIC_COPY.unknown.action };
  return GENERIC_COPY.unknown;
}
