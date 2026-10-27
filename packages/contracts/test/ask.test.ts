// Kontrak Tanya (docs/08 §10.1, §10.3, §11.3).
import { describe, expect, it } from 'vitest';
import {
  ASK_HISTORY_MAX,
  ASK_MAX_LENGTH,
  AskReplySchema,
  AskRequestSchema,
  AskResponseSchema,
  AskScreenRefSchema,
  ERROR_HTTP,
} from '../src/index.ts';

const PID = '70000000-0000-0000-0000-000000000200';

describe('AskRequestSchema (§10.1 langkah 1)', () => {
  it('pertanyaan 1–200 karakter (setelah trim), history default []', () => {
    expect(AskRequestSchema.parse({ question: '  milo termurah?  ' })).toEqual({ question: 'milo termurah?', history: [] });
    expect(AskRequestSchema.safeParse({ question: '   ' }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ question: 'x'.repeat(ASK_MAX_LENGTH) }).success).toBe(true);
    expect(AskRequestSchema.safeParse({ question: 'x'.repeat(ASK_MAX_LENGTH + 1) }).success).toBe(false);
  });
  it('history maks 4 pasangan teks; kunci lain ditolak', () => {
    const turn = { question: 'milo?', answer: 'Termurah Rp18.000.' };
    expect(AskRequestSchema.safeParse({ question: 'q', history: Array(ASK_HISTORY_MAX).fill(turn) }).success).toBe(true);
    expect(AskRequestSchema.safeParse({ question: 'q', history: Array(ASK_HISTORY_MAX + 1).fill(turn) }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ question: 'q', history: [{ ...turn, tool_output: {} }] }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ question: 'q', model: 'x' }).success).toBe(false);
  });
});

describe('AskReplySchema (§10.3)', () => {
  it('lima bentuk: answer, not_enough (dengan/tanpa tool), ambiguous, out_of_scope', () => {
    const ok = [
      {
        kind: 'answer',
        text: 'Termurah Rp18.000 (promo) di Alfamart.',
        basis: { jumlah_data: 5, tanggal_terakhir: '2026-10-24' },
        tool: { name: 'cari_harga_terbaik', arg: 'milo' },
        screen: { id: 'S-03', produk_id: PID },
      },
      { kind: 'not_enough', text: 'Belum ada data.', tool: null, screen: null },
      { kind: 'not_enough', text: 'Baru 1 data.', tool: { name: 'tren_harga', arg: 'Milo' }, screen: { id: 'S-03', produk_id: PID } },
      { kind: 'ambiguous', options: [{ label: 'Milo 200 g', question: 'Milo 200 g termurah di mana?' }] },
      { kind: 'out_of_scope' },
    ];
    for (const r of ok) expect(AskReplySchema.safeParse(r).success, JSON.stringify(r)).toBe(true);
  });
  it('tool di luar 6 tool, teks > 400, ambigu tanpa/lebih dari 4 pilihan → ditolak', () => {
    expect(AskReplySchema.safeParse({ kind: 'not_enough', text: 'x', tool: { name: 'sql' }, screen: null }).success).toBe(false);
    expect(AskReplySchema.safeParse({ kind: 'not_enough', text: 'x'.repeat(401), tool: null, screen: null }).success).toBe(false);
    expect(AskReplySchema.safeParse({ kind: 'ambiguous', options: [] }).success).toBe(false);
    const o = { label: 'a', question: 'a?' };
    expect(AskReplySchema.safeParse({ kind: 'ambiguous', options: [o, o, o, o, o] }).success).toBe(false);
  });
  it('S-03b (F-113) dikenal; layar tanpa UUID ditolak', () => {
    expect(AskScreenRefSchema.parse({ id: 'S-03b', produk_id: PID })).toEqual({ id: 'S-03b', produk_id: PID });
    expect(AskScreenRefSchema.safeParse({ id: 'S-03', produk_id: 'javascript:alert(1)' }).success).toBe(false);
    expect(AskScreenRefSchema.safeParse({ id: 'S-99' }).success).toBe(false);
  });
  it('respons: reply + tools_used', () => {
    expect(AskResponseSchema.safeParse({ reply: { kind: 'out_of_scope' }, tools_used: [] }).success).toBe(true);
    expect(AskResponseSchema.safeParse({ reply: { kind: 'out_of_scope' }, tools_used: ['x'] }).success).toBe(false);
  });
});

describe('kode error AI (§11.3)', () => {
  it('AI_QUOTA_EXCEEDED 429, AI_UNAVAILABLE 503', () => {
    expect(ERROR_HTTP.AI_QUOTA_EXCEEDED).toBe(429);
    expect(ERROR_HTTP.AI_UNAVAILABLE).toBe(503);
  });
});
