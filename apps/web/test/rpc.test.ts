// rpcCall (docs/07 §3.4): validasi input kontrak → rpc → parseRpcError → AppError → pesan §8.
import { MyContextSchema, type RpcClient } from '@priceatlas/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AppError, errorCopy } from '@/lib/data/errors';
import { rpcCall } from '@/lib/data/rpc';

const ID = '00000000-0000-0000-0000-00000000000a';

function client(
  result: { data?: unknown; error?: unknown } | (() => never),
): RpcClient & { rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(async () => {
    if (typeof result === 'function') return result();
    return { data: result.data ?? null, error: result.error ?? null };
  });
  return { rpc } as never;
}

describe('rpcCall', () => {
  it('mengirim input yang sudah divalidasi', async () => {
    const c = client({ data: [{ id: 1 }] });
    await expect(rpcCall('search_products', { p_query: 'milo' }, { client: c })).resolves.toEqual([{ id: 1 }]);
    expect(c.rpc).toHaveBeenCalledWith('search_products', { p_query: 'milo' });
  });

  it('RPC tanpa argumen dikirim dengan objek kosong', async () => {
    const c = client({ data: {} });
    await rpcCall('get_my_context', {}, { client: c });
    expect(c.rpc).toHaveBeenCalledWith('get_my_context', {});
  });

  it('input tidak sesuai kontrak → INVALID_INPUT tanpa memanggil server', async () => {
    const c = client({ data: null });
    const err = await rpcCall('search_products', { p_query: 'm' }, { client: c }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('INVALID_INPUT');
    expect((err as AppError).http).toBe(400);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it('error bisnis PTnnn → kode + HTTP + detail', async () => {
    const c = client({
      error: { code: 'PT409', message: 'STALE_WRITE', details: '{"current_updated_at":"x"}', hint: 'Data berubah' },
    });
    const err = (await rpcCall('retry_capture', { p_capture_id: ID }, { client: c }).catch(
      (e: unknown) => e,
    )) as AppError;
    expect(err.kind).toBe('rpc');
    expect(err.code).toBe('STALE_WRITE');
    expect(err.http).toBe(409);
    expect(err.rpc?.detail).toEqual({ current_updated_at: 'x' });
    expect(errorCopy(err, 'S-16').message).toMatch(/^Data ini baru saja berubah/);
  });

  it('pesan per layar untuk INVALID_STATE', async () => {
    const c = client({ error: { code: 'PT409', message: 'INVALID_STATE', details: null, hint: null } });
    const err = await rpcCall('delete_capture', { p_capture_id: ID }, { client: c }).catch((e: unknown) => e);
    expect(errorCopy(err, 'S-09').message).toBe('Unggahan yang sedang diproses atau sudah selesai tidak bisa dihapus.');
    expect(errorCopy(err).message).toMatch(/keadaan data/);
  });

  it('error Postgres bawaan memakai SQLSTATE', async () => {
    const c = client({ error: { code: '23P01', message: 'conflicting key value', details: null, hint: null } });
    const err = await rpcCall('merge_product', { p_from: ID, p_into: ID }, { client: c }).catch((e: unknown) => e);
    expect((err as AppError).http).toBe(409);
    expect(errorCopy(err).message).toBe('Barcode ini sudah dipakai produk lain di periode yang sama.');
  });

  it('kode tidak dikenal → hint server (Indonesia) → cadangan umum', async () => {
    const withHint = await rpcCall(
      'get_my_context',
      {},
      {
        client: client({ error: { code: 'XX000', message: 'boom', details: null, hint: 'Pesan dari server.' } }),
      },
    ).catch((e: unknown) => e);
    expect(errorCopy(withHint).message).toBe('Pesan dari server.');
    const without = await rpcCall(
      'get_my_context',
      {},
      {
        client: client({ error: { code: 'XX000', message: 'boom', details: null, hint: null } }),
      },
    ).catch((e: unknown) => e);
    expect(errorCopy(without).message).toBe('Terjadi kesalahan. Coba lagi sebentar lagi.');
  });

  it('kegagalan jaringan dibedakan dari error server', async () => {
    const thrown = await rpcCall(
      'get_my_context',
      {},
      {
        client: client(() => {
          throw new TypeError('Failed to fetch');
        }),
      },
    ).catch((e: unknown) => e);
    expect((thrown as AppError).kind).toBe('network');
    expect(errorCopy(thrown).message).toBe('Tidak ada sinyal. Data yang terakhir dimuat tetap ditampilkan.');

    const wrapped = await rpcCall(
      'get_my_context',
      {},
      {
        client: client({ error: { message: 'TypeError: Failed to fetch', details: null, hint: null, code: '' } }),
      },
    ).catch((e: unknown) => e);
    expect((wrapped as AppError).kind).toBe('network');
  });

  it('output divalidasi skema kontrak di development/test', async () => {
    const bad = client({ data: { user_id: 'bukan-uuid' } });
    await expect(rpcCall('get_my_context', {}, { client: bad, output: MyContextSchema })).rejects.toThrow(
      /tidak sesuai kontrak/,
    );
    const ok = client({
      data: {
        user_id: ID,
        display_name: null,
        household: {
          id: ID,
          name: 'Rumah',
          default_currency: 'IDR',
          timezone: 'Asia/Jakarta',
          share_prices_public: false,
        },
        role: 'owner',
        program_ids: [],
      },
    });
    await expect(rpcCall('get_my_context', {}, { client: ok, output: MyContextSchema })).resolves.toMatchObject({
      role: 'owner',
    });
  });
});
