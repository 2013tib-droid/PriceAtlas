// Satu pintu untuk semua RPC (docs/07 §3.4):
//   validasi input dengan skema zod kontrak → supabase.rpc → error lewat parseRpcError → AppError.
// Nama RPC dibatasi RPC_INPUTS (= RPC_NAMES read + write). Output divalidasi pemanggil
// (skema kontrak) hanya di development/test.
import { RPC_INPUTS, type RpcClient, type RpcInput, type RpcName, type ZodType } from '@priceatlas/contracts';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { AppError, fromRpcError, toAppError } from './errors';

const VALIDATE_OUTPUT = process.env.NODE_ENV !== 'production';

export interface RpcCallOptions<T> {
  /** Klien RPC (default: supabase browser). Test memakai klien tiruan. */
  client?: RpcClient;
  /** Skema output; dipakai di development/test saja. */
  output?: ZodType<T>;
  signal?: AbortSignal;
}

export async function rpcCall<N extends RpcName, T = unknown>(
  name: N,
  input: RpcInput<N>,
  opts: RpcCallOptions<T> = {},
): Promise<T> {
  const schema = RPC_INPUTS[name] as unknown as ZodType;
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    // Bug klien: input tidak sesuai kontrak. Tidak dikirim ke server.
    throw new AppError(
      'rpc',
      {
        code: 'INVALID_INPUT',
        sqlstate: null,
        http: 400,
        detail: { issues: parsed.error.issues },
        hint: null,
        message: 'INVALID_INPUT',
      },
      `INVALID_INPUT: ${name}`,
    );
  }
  const client = opts.client ?? (getSupabaseBrowserClient() as unknown as RpcClient);
  let res: {
    data: unknown;
    error: { message: string; code?: string | null; details?: string | null; hint?: string | null } | null;
  };
  try {
    let call = client.rpc(name, parsed.data as Record<string, unknown>);
    if (opts.signal && 'abortSignal' in call && typeof call.abortSignal === 'function') {
      call = (call.abortSignal as (s: AbortSignal) => typeof call)(opts.signal);
    }
    res = await call;
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error) throw fromRpcError(res.error);
  if (VALIDATE_OUTPUT && opts.output) {
    const out = opts.output.safeParse(res.data);
    if (!out.success) {
      console.error(`[rpc] output ${name} tidak sesuai kontrak`, out.error.issues);
      throw new AppError('unknown', null, `output ${name} tidak sesuai kontrak`);
    }
    return out.data;
  }
  return res.data as T;
}
