import type { RpcErrorLike } from './errors.ts';

/**
 * Antarmuka minimal klien RPC. supabase-js (`supabase.rpc(fn, args)`) memenuhinya
 * secara struktural; test memakai PgRpcClient (@priceatlas/testkit) yang meniru
 * PostgREST dengan JWT simulasi.
 */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcErrorLike | null }>;
}
