import { describe, expect, it } from 'vitest';
import { ERROR_HTTP, parseRpcError } from '../src/index.ts';

describe('kode error (§3.1)', () => {
  it('kode bisnis → HTTP dan detail JSON', () => {
    const e = parseRpcError({ message: 'STALE_WRITE', code: 'PT409', details: '{"updated_at": "x"}', hint: 'Muat ulang' });
    expect(e).toMatchObject({ code: 'STALE_WRITE', http: 409, detail: { updated_at: 'x' }, hint: 'Muat ulang' });
  });
  it('error bawaan Postgres', () => {
    expect(parseRpcError({ message: 'permission denied', code: '42501' })).toMatchObject({ code: null, http: 403 });
    expect(parseRpcError({ message: 'dup', code: '23505' }).http).toBe(409);
    expect(parseRpcError({ message: 'check', code: '23514' }).http).toBe(400);
  });
  it('setiap kode punya HTTP 4xx', () => {
    for (const http of Object.values(ERROR_HTTP)) expect(http).toBeGreaterThanOrEqual(400);
  });
  it('detail bukan JSON tetap aman', () => {
    expect(parseRpcError({ message: 'NOT_FOUND', code: 'PT404', details: 'teks' }).detail).toEqual({ raw: 'teks' });
  });
});
