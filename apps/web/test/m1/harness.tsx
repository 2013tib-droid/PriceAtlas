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
      return key ? ok(fx(`capture_${key}`)) : errOf('capture_unknown');
    }
    case 'retry_capture':
      return ok({ capture_id: a.p_capture_id, status: 'uploaded' });
    case 'delete_capture':
      return ok({ capture_id: a.p_capture_id, deleted: true });
    case 'submit_capture':
      return ok({ capture_id: a.p_capture_id, status: 'uploaded', created: true });
    default:
      throw new Error(`RPC ${fn} tidak diharapkan di M1/M2`);
  }
}

/** Id capture fixture per status (needs, failed, done, processing, uploaded). */
export function captureIds(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['needs', 'failed', 'done', 'processing', 'uploaded'])
    out[k] = fx<{ capture: { id: string } }>(`capture_${k}`).capture.id;
  return out;
}

export const state = {
  rpcOverride: null as null | ((fn: string, a: Record<string, unknown>) => Res | Promise<Res> | undefined),
  rest: {
    price_record_view: () => ok(fx('recent_prices')) as Res | Promise<Res>,
    capture: () => ({ data: null, error: null, count: 0 }) as Res & { count?: number },
    capture_image: () => ok([]) as Res | Promise<Res>,
  },
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
  },
};

export const sb = {
  auth: {
    getSession: vi.fn(async () => ({ data: { session: { user: { id: ID.user, email: 'ani@example.com' } } } })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signOut: vi.fn(),
  },
  rpc: vi.fn(async (fn: string, a: Record<string, unknown> = {}) => {
    const o = await state.rpcOverride?.(fn, a);
    return o ?? defaultRpc(fn, a);
  }),
  storage: {
    from: vi.fn(() => ({
      upload: (path: string, blob: Blob, opts?: unknown) => state.storage.upload(path, blob, opts),
      createSignedUrl: (path: string, seconds: number) => state.storage.createSignedUrl(path, seconds),
    })),
  },
  from: vi.fn((table: 'price_record_view' | 'capture' | 'capture_image') => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'in', 'neq']) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(state.rest[table]()).then(resolve, reject);
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
  const { deleteUserData } = await import('@/lib/offline/db');
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
  const view = render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <OutboxProvider>{ui}</OutboxProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return Object.assign(view, { qc });
}

/** Tanggal pembuatan fixture = "hari ini" (12:00 WIB) supaya tanggal relatif stabil. */
export function freezeToday() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${FIX.today}T05:00:00Z`));
}
