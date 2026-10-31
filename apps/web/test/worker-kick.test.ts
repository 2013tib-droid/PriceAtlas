// L5a Tahap 7b B4 (docs/09 §3.3, §12; F-191): logika POST /api/worker/kick dengan fetch palsu.
// Tanpa jaringan dan tanpa token sungguhan.
import { describe, expect, it, vi } from 'vitest';
import { KICK_REF, dispatchUrl, handleKick, kickConfigFromEnv, type KickDeps } from '@/lib/worker/kick-server';

const CONFIG = { token: 'github_pat_palsu_123', repo: 'pemilik/PriceAtlas' };
const user = async () => ({ id: 'u-1' });

function deps(over: Partial<KickDeps> = {}) {
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const d: KickDeps = {
    getUser: user,
    config: CONFIG,
    fetch: fetchMock,
    log: (event, fields) => logs.push({ event, fields }),
    ...over,
  };
  return { d, logs, fetchMock: (over.fetch as typeof fetchMock | undefined) ?? fetchMock };
}

describe('kickConfigFromEnv', () => {
  it('token dan repo wajib; repo harus owner/nama', () => {
    expect(kickConfigFromEnv({})).toBeNull();
    expect(kickConfigFromEnv({ GITHUB_DISPATCH_TOKEN: 't' })).toBeNull();
    expect(kickConfigFromEnv({ GITHUB_DISPATCH_REPO: 'a/b' })).toBeNull();
    expect(kickConfigFromEnv({ GITHUB_DISPATCH_TOKEN: ' ', GITHUB_DISPATCH_REPO: 'a/b' })).toBeNull();
    expect(kickConfigFromEnv({ GITHUB_DISPATCH_TOKEN: 't', GITHUB_DISPATCH_REPO: 'a/b/c' })).toBeNull();
    expect(kickConfigFromEnv({ GITHUB_DISPATCH_TOKEN: 't', GITHUB_DISPATCH_REPO: '../x' })).toBeNull();
    expect(kickConfigFromEnv({ GITHUB_DISPATCH_TOKEN: ' t ', GITHUB_DISPATCH_REPO: ' a-1/Price.Atlas_2 ' })).toEqual({
      token: 't',
      repo: 'a-1/Price.Atlas_2',
    });
  });
});

describe('handleKick', () => {
  it('tanpa sesi → 401, GitHub tidak dipanggil (juga saat env kosong)', async () => {
    for (const config of [CONFIG, null]) {
      const { d, fetchMock } = deps({ getUser: async () => null, config });
      expect(await handleKick(d)).toMatchObject({ status: 401, body: { error: 'UNAUTHENTICATED' } });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('env kosong → 204 tanpa aksi', async () => {
    const { d, fetchMock, logs } = deps({ config: null });
    expect(await handleKick(d)).toEqual({ status: 204, body: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it('sukses → 202; workflow_dispatch worker.yml ref master dengan token di header', async () => {
    const { d, fetchMock, logs } = deps();
    expect(await handleKick(d)).toEqual({ status: 202, body: { status: 'queued' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/pemilik/PriceAtlas/actions/workflows/worker.yml/dispatches');
    expect(url).toBe(dispatchUrl(CONFIG.repo));
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ ref: KICK_REF });
    expect(KICK_REF).toBe('master');
    const h = init?.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Bearer ${CONFIG.token}`);
    expect(h.Accept).toBe('application/vnd.github+json');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(logs).toEqual([{ event: 'worker.kick', fields: { status: 204, ms: expect.any(Number) } }]);
  });

  it('GitHub 200 (API baru dengan detail run) juga dianggap sukses', async () => {
    const { d } = deps({
      fetch: vi.fn<typeof fetch>(async () => new Response('{"workflow_run_id":1}', { status: 200 })),
    });
    expect((await handleKick(d)).status).toBe(202);
  });

  it.each([401, 403, 404, 422, 500])('GitHub %i → 502 tanpa detail; log tanpa token', async (status) => {
    const { d, logs } = deps({
      fetch: vi.fn<typeof fetch>(
        async () => new Response('{"message":"Bad credentials github_pat_palsu_123"}', { status }),
      ),
    });
    const r = await handleKick(d);
    expect(r).toEqual({
      status: 502,
      body: { error: 'KICK_FAILED', message: 'Pemrosesan akan berjalan pada jadwal berikutnya.' },
    });
    expect(JSON.stringify(r)).not.toContain('Bad credentials');
    expect(logs).toEqual([{ event: 'worker.kick', fields: { status, ms: expect.any(Number) } }]);
    expect(JSON.stringify(logs)).not.toContain(CONFIG.token);
  });

  it('jaringan gagal → 502', async () => {
    const { d, logs } = deps({
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    expect((await handleKick(d)).status).toBe(502);
    expect(logs[0]!.fields.status).toBe('network_error');
  });

  it('GitHub lambat → timeout → 502', async () => {
    const slow = vi.fn<typeof fetch>(
      (_u, init) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(init.signal!.reason));
        }),
    );
    const { d, logs } = deps({ fetch: slow, timeoutMs: 20 });
    expect((await handleKick(d)).status).toBe(502);
    expect(logs[0]!.fields.status).toBe('timeout');
  });
});
