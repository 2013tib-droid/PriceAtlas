// Harness L5b M1: fixture RPC asli (test/fixtures/rpc.json, divalidasi skema kontrak), klien
// Supabase tiruan (rpc + REST), router tiruan, dan provider (Query + Auth + prefs IndexedDB).
import 'fake-indexeddb/auto';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { FIXTURE_SCHEMAS } from '../fixtures/schemas';

export const FIX = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/rpc.json'), 'utf8')) as {
  today: string;
  data: Record<string, unknown>;
};

/** Fixture tervalidasi zod kontrak (gagal keras jika menyimpang). */
export function fx<T = unknown>(key: string): T {
  const schema = FIXTURE_SCHEMAS[key];
  if (!schema) throw new Error(`fixture tanpa skema: ${key}`);
  return structuredClone(schema.parse(FIX.data[key])) as T;
}

export const ID = {
  user: '00000000-0000-0000-0000-00000000000a',
  milo200: '70000000-0000-0000-0000-000000000200',
  milo500: '70000000-0000-0000-0000-000000000500',
  milo3in1: '70000000-0000-0000-0000-000000000310',
  miloUht: '70000000-0000-0000-0000-000000000180',
  indomie: '70000000-0000-0000-0000-000000000085',
  jeruk: '70000000-0000-0000-0000-0000000000f1',
  milo1kg: '70000000-0000-0000-0000-000000001000',
  gula: 'a0000000-0000-0000-0000-000000000001',
  miloDup: 'a0000000-0000-0000-0000-000000000002',
  group: '60000000-0000-0000-0000-000000000001',
  aeon: '20000000-0000-0000-0000-000000000001',
  unknown: '99999999-0000-0000-0000-000000000000',
} as const;

const DETAIL_KEY: Record<string, string> = {
  [ID.milo200]: 'detail_milo200',
  [ID.milo500]: 'detail_milo500',
  [ID.milo3in1]: 'detail_milo3in1',
  [ID.miloUht]: 'detail_miloUht',
  [ID.indomie]: 'detail_indomie',
  [ID.jeruk]: 'detail_jeruk',
  [ID.gula]: 'detail_gula',
  [ID.milo1kg]: 'detail_milo1kg',
  [ID.miloDup]: 'detail_miloDup',
};

type Res = { data: unknown; error: unknown };
const ok = (data: unknown): Res => ({ data, error: null });
const errOf = (key: string): Res => ({ data: null, error: fx<{ error: unknown }>(key).error });

/** Semua kartu yang ada di fixture (untuk R4 get_product_cards). */
function allCards() {
  const cards = new Map<string, unknown>();
  for (const k of ['search_milo', 'search_indomie', 'search_jeruk', 'search_gula', 'cards_viewed'])
    for (const c of fx<{ product: { id: string } }[]>(k)) cards.set(c.product.id, c);
  return cards;
}

/** Router RPC default: household Ani (punya histori). Override per test lewat `rpcOverride`. */
export function defaultRpc(fn: string, a: Record<string, unknown>): Res {
  switch (fn) {
    case 'get_my_context':
      return ok(fx('context'));
    case 'get_client_config':
      return ok(fx('config'));
    case 'search_products': {
      const q = String(a.p_query);
      const key = { milo: 'search_milo', indomie: 'search_indomie', jeruk: 'search_jeruk', gula: 'search_gula' }[q];
      return ok(fx(key ?? 'search_none'));
    }
    case 'get_product_cards': {
      const cards = allCards();
      return ok((a.p_ids as string[]).map((id) => cards.get(id)).filter(Boolean));
    }
    case 'get_product_detail': {
      const key = DETAIL_KEY[String(a.p_product_id)];
      return key ? ok(fx(key)) : errOf('detail_unknown');
    }
    case 'price_chart':
      if (a.p_product_id === ID.milo200) return ok(fx(a.p_normal_only ? 'chart_milo200_normal' : 'chart_milo200'));
      if (a.p_product_id === ID.jeruk) return ok(fx('chart_jeruk'));
      return ok([]);
    case 'price_history': {
      if (a.p_product_id === ID.milo200) {
        if (a.p_store_id) return ok(fx('history_milo200_aeon'));
        if (a.p_include_void) return ok(fx('history_milo200_void'));
        return ok(fx('history_milo200'));
      }
      if (a.p_product_id === ID.jeruk) return ok(fx('history_jeruk'));
      if (a.p_product_id === ID.miloUht) return ok(fx('history_miloUht'));
      return ok([]);
    }
    case 'compare_sizes':
      if (a.p_group_id !== ID.group) return errOf('sizes_unknown');
      return ok(fx(a.p_window === 'all' ? 'sizes_milo_all' : 'sizes_milo_90d'));
    case 'where_cheaper': {
      const all = a.p_window_days == null;
      if (a.p_group_id) return ok(fx(all ? 'cheaper_group_all' : 'cheaper_group_90'));
      if (a.p_product_id === ID.milo200) return ok(fx(all ? 'cheaper_milo200_all' : 'cheaper_milo200_90'));
      if (a.p_product_id === ID.milo3in1) return ok(fx(all ? 'cheaper_milo3in1_all' : 'cheaper_milo3in1_90'));
      return ok([]);
    }
    case 'find_product_by_barcode': {
      const key = { '8992696404441': 'barcode_milo500', '9990000000012': 'barcode_via_merge' }[String(a.p_code)];
      return ok(fx(key ?? 'barcode_unknown'));
    }
    // M2 (S-08/S-09): keluaran R13/R14 asli user Citra.
    case 'list_captures': {
      if (a.p_kind === 'receipt') return ok(fx('captures_receipt'));
      const all = fx<{ kind: string }[]>('captures_all');
      return ok(a.p_kind ? all.filter((c) => c.kind === a.p_kind) : all);
    }
    case 'get_capture': {
      const key = Object.entries(captureIds()).find(([, id]) => id === a.p_capture_id)?.[0];
      if (key) return ok(fx(`capture_${key}`));
      if (a.p_capture_id === m3Ids().items.label) return ok(fx('capture_label'));
      if (a.p_capture_id === m3Ids().items.shopee_pending) return ok(fx('capture_shopee'));
      return errOf('capture_unknown');
    }
    case 'retry_capture':
      return ok({ capture_id: a.p_capture_id, status: 'uploaded' });
    case 'delete_capture':
      return ok({ capture_id: a.p_capture_id, deleted: true });
    case 'submit_capture':
      return ok({ capture_id: a.p_capture_id, status: 'uploaded', created: true });
    // M3 (S-10…S-15): keluaran R15/R16/R17/W4/W5/W8/W17/W18 asli user Citra.
    case 'get_receipt': {
      const key = Object.entries(m3Ids().receipts).find(([, id]) => id === a.p_receipt_id)?.[0];
      return key ? ok(fx(`receipt_${key}`)) : errOf('receipt_unknown');
    }
    case 'confirm_receipt':
      if (a.p_duplicate_decision === 'discard')
        return ok({ saved_count: 0, cheaper_than_best_count: 0, receipt_status: 'discarded' });
      return ok(fx('confirm_receipt_ok'));
    case 'get_capture_items': {
      const key = Object.entries(m3Ids().items).find(([, id]) => id === a.p_capture_id)?.[0];
      return key ? ok(fx(`items_${key}`)) : errOf('items_unknown');
    }
    case 'update_capture_item': {
      // Versi baru item (patch diterapkan, updated_at maju) — computed tetap dari fixture.
      const all = [
        ...fx<Record<string, unknown>[]>('items_label'),
        ...fx<Record<string, unknown>[]>('items_shopee_pending'),
      ];
      const item = all.find((i) => i.id === a.p_item_id);
      if (!item) return errOf('items_unknown');
      const patch = { ...(a.p_patch as Record<string, unknown>) };
      if ('product_id' in patch) {
        item.suggested_product_id = patch.product_id;
        delete patch.product_id;
      }
      return ok({ ...item, ...patch, updated_at: new Date(Date.parse(String(item.updated_at)) + 1000).toISOString() });
    }
    case 'confirm_capture_items':
      return ok(fx(a.p_capture_id === m3Ids().items.shopee_pending ? 'confirm_items_shopee' : 'confirm_items_ok'));
    case 'get_my_programs':
      return ok(fx('programs'));
    case 'set_program_membership':
      return ok({ program_id: a.p_program_id, is_member: a.p_member });
    case 'recent_locations':
      return ok(fx('recent_locations'));
    case 'create_private_store':
      return ok({
        ...fx<Record<string, unknown>>('create_store'),
        ...(a.p_store as Record<string, unknown>),
        is_private: true,
      });
    case 'create_private_branch':
      return ok({
        ...fx<Record<string, unknown>>('create_branch'),
        ...(a.p_branch as Record<string, unknown>),
        is_private: true,
      });
    case 'create_private_product':
      return ok(fx('create_product_ok'));
    case 'correct_receipt_line':
      return ok({ line: {}, attached: [], record: null });
    // M4 (S-12 mode sesi, S-13, banner): keluaran R18/W11/W12/W13 asli user Ani. Default: tanpa sesi.
    case 'get_active_session':
      return ok(fx('session_none'));
    case 'start_shopping_session':
      return ok(fx('session_start'));
    case 'extend_shopping_session':
      return ok(fx('session_extend'));
    case 'end_shopping_session':
      return ok(fx('session_end'));
    // M5 (S-16/S-17/S-18): keluaran R19/R20/W6/W9/W10 asli user Citra.
    case 'price_record_detail': {
      const key = Object.entries(m5Ids().records).find(([, id]) => id === a.p_id)?.[0];
      return key ? ok(fx(`record_${key}`)) : errOf('record_unknown');
    }
    case 'correct_price_record': {
      // Versi baru record (patch diterapkan, updated_at maju); angka turunan tetap dari fixture.
      const key = Object.entries(m5Ids().records).find(([, id]) => id === a.p_id)?.[0];
      if (!key) return errOf('record_unknown');
      const rec = fx<{ record: Record<string, unknown> }>(`record_${key}`).record;
      return ok({
        ...rec,
        ...(a.p_patch as Record<string, unknown>),
        updated_at: new Date(Date.parse(String(rec.updated_at)) + 1000).toISOString(),
      });
    }
    case 'merge_product_preview': {
      const key = MERGE_PREVIEW[`${String(a.p_from)}>${String(a.p_into)}`];
      return key ? ok(fx(key)) : errOf('merge_preview_unknown');
    }
    case 'merge_product':
      return a.p_from === ID.milo200 ? errOf('merge_forbidden') : ok(null);
    case 'move_price_records':
      return ok({ moved_count: (a.p_record_ids as string[]).length, target_product_id: a.p_target_product_id });
    // M6 (S-19b/S-19c): keluaran W14/W15 asli user Citra.
    case 'set_share_prices_public':
      return ok(fx(a.p_enabled ? 'share_on' : 'share_off'));
    case 'share_existing_prices':
      return ok(fx('share_existing'));
    // M7 (D-60): R5 asli user Ani.
    case 'get_offline_cache':
      return ok(fx('offline_cache'));
    default:
      throw new Error(`RPC ${fn} tidak diharapkan di M1–M7`);
  }
}

/** Id capture fixture per status (needs, failed, done, processing, uploaded). */
export function captureIds(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['needs', 'failed', 'done', 'processing', 'uploaded'])
    out[k] = fx<{ capture: { id: string } }>(`capture_${k}`).capture.id;
  return out;
}

/** Id struk/capture fixture M3. */
export function m3Ids() {
  const receipt = (k: string) => fx<{ header: { id: string; capture_id: string } }>(`receipt_${k}`).header;
  const capOf = (k: string) => fx<{ capture_id: string }[]>(`items_${k}`)[0]!.capture_id;
  return {
    receipts: { aeon: receipt('aeon').id, duplicate: receipt('duplicate').id, nostore: receipt('nostore').id },
    items: { label: capOf('label'), shopee: capOf('shopee'), shopee_pending: capOf('shopee_pending') },
  };
}

/** Id fixture M5 (Citra): record per sumber dan produk privat untuk merge/split. */
export const CAT = {
  gulaAren: 'c0000000-0000-0000-0000-000000000010',
  dup: 'c0000000-0000-0000-0000-000000000020',
  big: 'c0000000-0000-0000-0000-000000000021',
  syrup: 'c0000000-0000-0000-0000-000000000022',
} as const;

export function m5Ids() {
  const rec = (k: string) => fx<{ record: { id: string } }>(`record_${k}`).record.id;
  return { records: { label: rec('label'), receipt: rec('receipt'), shopee: rec('shopee') } };
}

const MERGE_PREVIEW: Record<string, string> = {
  [`${CAT.dup}>${CAT.gulaAren}`]: 'merge_preview_ok',
  [`${CAT.dup}>${CAT.big}`]: 'merge_preview_size',
  [`${CAT.dup}>${CAT.syrup}`]: 'merge_preview_dimension',
  [`${CAT.dup}>${ID.milo200}`]: 'merge_preview_global_target',
  [`${ID.milo200}>${CAT.gulaAren}`]: 'merge_preview_source_global',
};

export type RestCall = { table: string; calls: [string, unknown[]][] };
type RestHandler = (c: RestCall) => Res | Promise<Res>;

export const state = {
  rpcOverride: null as null | ((fn: string, a: Record<string, unknown>) => Res | Promise<Res> | undefined),
  rest: {
    price_record_view: () => ok(fx('recent_prices')) as Res | Promise<Res>,
    capture: () => ({ data: null, error: null, count: 0 }) as Res & { count?: number },
    capture_image: () => ok([]) as Res | Promise<Res>,
    receipt: (() => ok([{ id: 'x', updated_at: new Date().toISOString() }])) as RestHandler,
    store: (() => ok(fx('rest_stores'))) as RestHandler,
    branch: (() => ok(fx('rest_branches_aeon'))) as RestHandler,
    category: (() => ok(fx('rest_categories'))) as RestHandler,
    brand: (() => ok([])) as RestHandler,
    product_group: (() => ok([])) as RestHandler,
    /** M5: baca baris produk (S-15 edit) / PATCH dengan filter updated_at. */
    product: ((c: RestCall) =>
      ok(fx(c.calls.some(([m]) => m === 'update') ? 'patch_product_ok' : 'rest_product'))) as RestHandler,
    /** M6: PATCH profile.display_name (S-19). */
    profile: (() => ok(fx('patch_profile_ok'))) as RestHandler,
    /** M6: barcode produk privat (S-15 edit, D-89): select = daftar PLU, insert = sukses. */
    barcode_assignment: ((c: RestCall) =>
      c.calls.some(([m]) => m === 'insert') ? ok(null) : ok(fx('barcodes_plu'))) as RestHandler,
  },
  /** Semua panggilan REST (tabel + rantai method) untuk diperiksa test. */
  restCalls: [] as RestCall[],
  storage: {
    upload: vi.fn(async (...args: [path: string, blob: Blob, opts?: unknown]) => ({
      data: { path: args[0] },
      error: null as unknown,
    })),
    createSignedUrl: vi.fn(async (path: string, seconds: number) => ({
      data: { signedUrl: `https://supabase.test/storage/v1/object/sign/captures/${path}?expires=${seconds}` } as {
        signedUrl: string;
      } | null,
      error: null as unknown,
    })),
    createSignedUrls: vi.fn(async (paths: string[], seconds: number) => ({
      data: paths.map((path) => ({
        path,
        error: null as string | null,
        signedUrl: `https://supabase.test/storage/v1/object/sign/captures/${path}?expires=${seconds}`,
      })) as { path: string; error: string | null; signedUrl: string }[] | null,
      error: null as unknown,
    })),
  },
};

export const sb = {
  auth: {
    getSession: vi.fn(async () => ({ data: { session: { user: { id: ID.user, email: 'ani@example.com' } } } })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signOut: vi.fn<(opts?: unknown) => Promise<{ error: unknown }>>(async () => ({ error: null })),
    signInWithOtp: vi.fn<(a?: unknown) => Promise<{ data: unknown; error: unknown }>>(async () => ({
      data: {},
      error: null,
    })),
    verifyOtp: vi.fn<(a?: unknown) => Promise<{ data: unknown; error: unknown }>>(async () => ({
      data: {},
      error: null,
    })),
  },
  rpc: vi.fn(async (fn: string, a: Record<string, unknown> = {}) => {
    const o = await state.rpcOverride?.(fn, a);
    return o ?? defaultRpc(fn, a);
  }),
  storage: {
    from: vi.fn(() => ({
      upload: (path: string, blob: Blob, opts?: unknown) => state.storage.upload(path, blob, opts),
      createSignedUrl: (path: string, seconds: number) => state.storage.createSignedUrl(path, seconds),
      createSignedUrls: (paths: string[], seconds: number) => state.storage.createSignedUrls(paths, seconds),
    })),
  },
  from: vi.fn((table: keyof typeof state.rest) => {
    const call: RestCall = { table, calls: [] };
    state.restCalls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'in', 'neq', 'ilike', 'is', 'update', 'insert'])
      chain[m] = (...args: unknown[]) => {
        call.calls.push([m, args]);
        return chain;
      };
    chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve((state.rest[table] as (c: RestCall) => Res)(call)).then(resolve, reject);
    return chain;
  }),
};

export const nav = {
  pathname: '/',
  search: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
};

export function setUrl(pathname: string, query = '') {
  nav.pathname = pathname;
  nav.search = new URLSearchParams(query);
}

export async function resetHarness() {
  vi.clearAllMocks();
  state.rpcOverride = null;
  state.rest.price_record_view = () => ok(fx('recent_prices'));
  state.rest.capture = () => ({ data: null, error: null, count: 0 });
  state.rest.capture_image = () => ok([]);
  state.rest.receipt = () => ok([{ id: 'x', updated_at: new Date().toISOString() }]);
  state.rest.store = () => ok(fx('rest_stores'));
  state.rest.branch = () => ok(fx('rest_branches_aeon'));
  state.rest.category = () => ok(fx('rest_categories'));
  state.rest.brand = () => ok([]);
  state.rest.product_group = () => ok([]);
  state.rest.product = (c) => ok(fx(c.calls.some(([m]) => m === 'update') ? 'patch_product_ok' : 'rest_product'));
  state.rest.profile = () => ok(fx('patch_profile_ok'));
  state.rest.barcode_assignment = (c) => (c.calls.some(([m]) => m === 'insert') ? ok(null) : ok(fx('barcodes_plu')));
  sb.auth.signOut.mockImplementation(async () => ({ error: null }));
  sb.auth.signInWithOtp.mockImplementation(async () => ({ data: {}, error: null }));
  sb.auth.verifyOtp.mockImplementation(async () => ({ data: {}, error: null }));
  state.restCalls = [];
  try {
    sessionStorage.clear();
  } catch {
    // node: tanpa sessionStorage
  }
  state.storage.upload.mockImplementation(async (...args: [string, Blob, unknown?]) => ({
    data: { path: args[0] },
    error: null,
  }));
  state.storage.createSignedUrl.mockImplementation(async (path: string, seconds: number) => ({
    data: { signedUrl: `https://supabase.test/storage/v1/object/sign/captures/${path}?expires=${seconds}` },
    error: null,
  }));
  setUrl('/');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  // Prefs per user: mulai bersih setiap test.
  const { deleteUserData, unlockUserDb } = await import('@/lib/offline/db');
  unlockUserDb(ID.user);
  await deleteUserData(ID.user);
}

/** Polyfill jsdom untuk vaul/Radix (matchMedia, ResizeObserver, pointer capture). */
export function installDomPolyfills() {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => undefined;
  // URL.createObjectURL milik Node tidak menerima Blob jsdom (pratinjau foto S-07).
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => undefined;
}

export async function renderWithProviders(ui: ReactNode) {
  const { createQueryClient } = await import('@/lib/data/query-client');
  const { AuthProvider } = await import('@/lib/auth/session');
  const { OutboxProvider } = await import('@/lib/offline/outbox-context');
  const qc = createQueryClient();
  qc.setDefaultOptions({ queries: { ...qc.getDefaultOptions().queries, retry: false } });
  const tree = (node: ReactNode) => (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <OutboxProvider>{node}</OutboxProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
  const view = render(tree(ui));
  /** Render ulang dengan provider yang sama (mis. setelah URL tiruan berubah). */
  const rerenderUi = (node: ReactNode) => view.rerender(tree(node));
  return Object.assign(view, { qc, rerenderUi });
}

/** Tanggal pembuatan fixture = "hari ini" (12:00 WIB) supaya tanggal relatif stabil. */
export function freezeToday() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${FIX.today}T05:00:00Z`));
}
