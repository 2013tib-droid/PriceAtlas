import type { RpcInput, RpcName } from '@priceatlas/contracts';

// Kunci query mengikuti nama RPC (docs/07 §4.3): ['rpc', 'search_products', { p_query }].
export const qk = {
  rpc: <N extends RpcName>(name: N, input: RpcInput<N> = {} as RpcInput<N>) => ['rpc', name, input] as const,
};

/** RPC yang hasilnya TIDAK pernah di-persist ke IndexedDB: isi struk dan detail record (P-13, P-14). */
export const NO_PERSIST_RPCS: ReadonlySet<string> = new Set<RpcName>([
  'get_receipt',
  'get_capture_items',
  'price_record_detail',
]);

/** staleTime per RPC (§4.3). Default 30 dtk. */
const HOUR = 60 * 60_000;
export const STALE_TIME: Partial<Record<RpcName, number>> = {
  get_my_context: HOUR,
  get_client_config: HOUR,
  list_captures: 0,
  get_capture: 0,
  get_receipt: 0,
  get_capture_items: 0,
  price_record_detail: 0,
};
export const DEFAULT_STALE_TIME = 30_000;
