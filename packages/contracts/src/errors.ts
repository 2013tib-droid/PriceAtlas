// Kode error bisnis RPC (docs/05 §3.1). Sumber kebenaran: app.err() di
// supabase/migrations/20261020000100_config_helpers.sql. Test memastikan keduanya sama.
//   SQLSTATE PTnnn → HTTP nnn (PostgREST). message = kode, detail = JSON, hint = pesan Indonesia.

export const ERROR_HTTP = {
  NOT_FOUND: 404,
  STALE_WRITE: 409,
  INVALID_STATE: 409,
  INVALID_TRANSITION: 409,
  DUPLICATE_DECISION_REQUIRED: 409,
  SESSION_NOT_ACTIVE: 409,
  RECEIPT_STORE_REQUIRED: 422,
  UNDECIDED_LINES: 422,
  STORE_REQUIRED: 422,
  NO_APPLICABLE_PRICE: 422,
  USE_RECEIPT_LINE: 422,
  RECEIPT_DERIVED_FIELD: 422,
  INVALID_EXTRA: 422,
  CAPTURE_IMAGES_MISSING: 422,
  BRANCH_CLOSED: 422,
  RECORDS_NOT_OWNED: 403,
  MERGE_FORBIDDEN: 403,
  REAUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  // Tanya (docs/08 §11.3): kuota/anggaran habis (begin_ask) dan layanan AI tidak tersedia (route /api/ask).
  AI_QUOTA_EXCEEDED: 429,
  AI_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP;
export const ERROR_CODES = Object.keys(ERROR_HTTP) as ErrorCode[];

/** Bentuk error yang dikembalikan supabase-js / PostgREST untuk RPC. */
export interface RpcErrorLike {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

export interface RpcError {
  /** Kode bisnis (mis. STALE_WRITE), atau null untuk error Postgres bawaan. */
  code: ErrorCode | null;
  /** SQLSTATE asli, mis. PT409, 42501, 23514. */
  sqlstate: string | null;
  http: number;
  detail: Record<string, unknown>;
  hint: string | null;
  message: string;
}

/** Error Postgres bawaan yang dipakai kontrak (§3.1): 42501 → 403, 23505 → 409, 23514/23503 → 400. */
const BUILTIN_HTTP: Record<string, number> = {
  '42501': 403,
  '23505': 409,
  '23514': 400,
  '23503': 400,
  '23P01': 409,
  '22023': 400,
};

export function isErrorCode(x: string): x is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_HTTP, x);
}

export function parseRpcError(e: RpcErrorLike): RpcError {
  const sqlstate = e.code ?? null;
  let detail: Record<string, unknown> = {};
  if (e.details) {
    try {
      const parsed: unknown = JSON.parse(e.details);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) detail = parsed as Record<string, unknown>;
    } catch {
      detail = { raw: e.details };
    }
  }
  const code = isErrorCode(e.message) ? e.message : null;
  const http = code
    ? ERROR_HTTP[code]
    : sqlstate && /^PT\d{3}$/.test(sqlstate)
      ? Number(sqlstate.slice(2))
      : (sqlstate && BUILTIN_HTTP[sqlstate]) || 500;
  return { code, sqlstate, http, detail, hint: e.hint ?? null, message: e.message };
}

// Hapus akun (§7.6): teks konfirmasi di body dan jendela login ulang.
export const ACCOUNT_DELETE_CONFIRMATION = 'HAPUS AKUN';
export const ACCOUNT_DELETE_REAUTH_MINUTES = 15;
