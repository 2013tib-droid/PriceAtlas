// L5a 6b M5: S-20 Tanya — tautan layar sumber (F-113), riwayat di perangkat, pemetaan respons
// POST /api/ask ke keadaan balasan (docs/08 §10.3–§10.5).
import { describe, expect, it, vi } from 'vitest';
import { ASK_HISTORY_KEEP, historyForRequest, postAsk, pushTurn, screenHref, type AskTurn } from '@/lib/ask/ask';
import { ASK_COPY } from '@/lib/copy/id';
import { announcement } from '@/features/ask/ask-screen';

const PID = '70000000-0000-0000-0000-000000000200';
const answer = {
  kind: 'answer' as const,
  text: 'Termurah Rp18.000 (promo) di Alfamart.',
  basis: { jumlah_data: 5, tanggal_terakhir: '2026-10-24' },
  tool: { name: 'cari_harga_terbaik' as const, arg: 'milo' },
  screen: { id: 'S-03' as const, produk_id: PID },
};
const turn = (i: number, reply: AskTurn['reply'] = answer): AskTurn => ({
  id: `t${i}`,
  question: `q${i}`,
  reply,
  at: i,
});
const res = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('tautan layar sumber', () => {
  it('S-03b (F-113) → S-03 dengan sheet Cek harga rak terbuka', () => {
    expect(screenHref({ id: 'S-03b', produk_id: PID })).toBe(`/produk?id=${PID}&sheet=cek-harga`);
  });
  it('setiap layar di kontrak punya teks tautan', () => {
    for (const id of ['S-02', 'S-03', 'S-03b', 'S-04', 'S-05'] as const) expect(ASK_COPY.screens[id]).toBeTruthy();
  });
});

describe('riwayat di perangkat (§10.4)', () => {
  it('maks 20 tanya-jawab, terbaru di akhir', () => {
    let list: AskTurn[] = [];
    for (let i = 0; i < 25; i++) list = pushTurn(list, turn(i));
    expect(list).toHaveLength(ASK_HISTORY_KEEP);
    expect(list[0]!.id).toBe('t5');
    expect(list.at(-1)!.id).toBe('t24');
  });
  it('history permintaan: maks 4 pasangan teks; gagal/kuota/segera hadir dilewati', () => {
    const list = [
      turn(1),
      turn(2, { kind: 'failed' }),
      turn(3, { kind: 'quota', reason: 'daily' }),
      turn(4, { kind: 'out_of_scope' }),
      turn(5, { kind: 'ambiguous', options: [{ label: 'Milo 200 g', question: 'Milo 200 g?' }] }),
      turn(6, { kind: 'not_enough', text: 'Baru 1 data.', tool: null, screen: null }),
      turn(7, { kind: 'coming_soon' }),
      turn(8),
    ];
    expect(historyForRequest(list, ASK_COPY)).toEqual([
      { question: 'q4', answer: ASK_COPY.outOfScope },
      { question: 'q5', answer: 'Maksudmu yang mana? Milo 200 g' },
      { question: 'q6', answer: 'Baru 1 data.' },
      { question: 'q8', answer: answer.text },
    ]);
  });
});

describe('postAsk → keadaan balasan', () => {
  it('200 → balasan server; body = question + history', async () => {
    const f = res(200, { reply: answer, tools_used: ['cari_harga_terbaik'] });
    expect(await postAsk('milo?', [{ question: 'a', answer: 'b' }], f)).toEqual(answer);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/ask');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ question: 'milo?', history: [{ question: 'a', answer: 'b' }] });
  });
  it('200 dengan bentuk salah → gagal', async () => {
    expect(await postAsk('q', [], res(200, { reply: { kind: 'answer', text: 'x' } }))).toEqual({ kind: 'failed' });
  });
  it.each([
    [429, { error: 'AI_QUOTA_EXCEEDED', reason: 'daily', message: '' }, { kind: 'quota', reason: 'daily' }],
    [429, { error: 'AI_QUOTA_EXCEEDED', reason: 'budget', message: '' }, { kind: 'quota', reason: 'budget' }],
    [429, { error: 'AI_QUOTA_EXCEEDED', reason: 'aneh', message: '' }, { kind: 'quota', reason: null }],
    [503, { error: 'AI_UNAVAILABLE', reason: 'disabled', message: '' }, { kind: 'coming_soon' }],
    [503, { error: 'AI_UNAVAILABLE', reason: 'config', message: '' }, { kind: 'coming_soon' }],
    [503, { error: 'AI_UNAVAILABLE', reason: 'timeout', message: '' }, { kind: 'failed' }],
    [401, { error: 'UNAUTHENTICATED', message: '' }, { kind: 'failed' }],
    [500, 'html', { kind: 'failed' }],
  ])('%i %j', async (status, body, expected) => {
    expect(await postAsk('q', [], res(status, body))).toEqual(expected);
  });
  it('jaringan putus → gagal (tidak melempar)', async () => {
    expect(
      await postAsk(
        'q',
        [],
        vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
      ),
    ).toEqual({ kind: 'failed' });
  });
});

describe('pengumuman aria-live', () => {
  it('jawaban, data kurang, ambigu, kuota, gagal', () => {
    expect(announcement(answer)).toBe(`Jawaban: ${answer.text}`);
    expect(announcement({ kind: 'not_enough', text: 'Baru 1 data.', tool: null, screen: null })).toBe('Baru 1 data.');
    expect(
      announcement({
        kind: 'ambiguous',
        options: [
          { label: 'A', question: 'A?' },
          { label: 'B', question: 'B?' },
        ],
      }),
    ).toBe('Maksudmu yang mana? A, B');
    expect(announcement({ kind: 'quota', reason: 'monthly' })).toBe(ASK_COPY.quota.monthly);
    expect(announcement({ kind: 'failed' })).toBe('Gagal menjawab. Coba lagi.');
  });
});
