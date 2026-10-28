// @vitest-environment jsdom
// L5b 6b M5: S-20 Tanya aktif (docs/08 §10.3–§10.5, docs/07 §9): kirim, memuat, keadaan balasan dari
// route palsu (fetch), ambigu → pertanyaan baru, offline → kirim nonaktif, riwayat di IndexedDB per user
// yang terhapus saat Keluar (D-84), aria-live, axe.
import '../m1/mocks';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIX,
  ID,
  freezeToday,
  installDomPolyfills,
  nav,
  renderWithProviders,
  resetHarness,
  setUrl,
} from '../m1/harness';

const { AskScreen } = await import('@/features/ask/ask-screen');
const { signOutAndClear } = await import('@/lib/auth/session');
const { readPref, writePref, PREF_KEYS } = await import('@/lib/offline/prefs');

installDomPolyfills();

const PID = '70000000-0000-0000-0000-000000000200';
const GROUP = '60000000-0000-0000-0000-000000000001';
const REPLIES = {
  answer: {
    kind: 'answer',
    text: 'Termurah Rp18.000 (promo) di Alfamart, cabang tidak diketahui.',
    basis: { jumlah_data: 5, tanggal_terakhir: FIX.today },
    tool: { name: 'cari_harga_terbaik', arg: 'Milo Original 200 g' },
    screen: { id: 'S-03', produk_id: PID },
  },
  perUnit: {
    kind: 'answer',
    text: 'Harga terbaik 90 hari: Rp90/g.',
    basis: { jumlah_data: 5, tanggal_terakhir: FIX.today },
    tool: { name: 'harga_per_satuan', arg: 'Milo Original 200 g' },
    screen: { id: 'S-03b', produk_id: PID },
  },
  notEnough: {
    kind: 'not_enough',
    text: 'Baru ada 1 data. Belum cukup untuk melihat tren.',
    tool: { name: 'tren_harga', arg: 'Milo Original 500 g' },
    screen: { id: 'S-04', product_group_id: GROUP },
  },
  ambiguous: {
    kind: 'ambiguous',
    options: [
      { label: 'Milo Original 200 g', question: 'Milo Original 200 g termurah di mana?' },
      { label: 'Milo Original 500 g', question: 'Milo Original 500 g termurah di mana?' },
    ],
  },
  outOfScope: { kind: 'out_of_scope' },
} as const;

type Reply = (typeof REPLIES)[keyof typeof REPLIES];
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (reply: Reply) => json(200, { reply, tools_used: 'tool' in reply && reply.tool ? [reply.tool.name] : [] });

let fetchMock: ReturnType<typeof vi.fn>;
const bodies = () =>
  fetchMock.mock.calls.map(
    ([, init]) => JSON.parse((init as RequestInit).body as string) as { question: string; history: unknown[] },
  );
const goOffline = () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  act(() => void window.dispatchEvent(new Event('offline')));
};

/** Daftar percakapan (pengumuman aria-live memuat teks yang sama). */
const conv = () => within(screen.getByRole('list', { name: 'Percakapan' }));

async function ask(question: string) {
  const user = userEvent.setup();
  const input = screen.getByLabelText('Pertanyaan');
  await user.clear(input);
  await user.type(input, question);
  await user.click(screen.getByRole('button', { name: 'Kirim' }));
}

beforeEach(async () => {
  await resetHarness();
  freezeToday();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setUrl('/tanya');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('kirim dan memuat', () => {
  it('Kirim → "Mencari di historimu…" → jawaban + dasar + tautan + tool; diumumkan lewat aria-live', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)));
    await renderWithProviders(<AskScreen />);
    const send = screen.getByRole('button', { name: 'Kirim' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true); // kolom kosong
    await ask('milo termurah di mana?');
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Mencari di historimu…');
    expect(send.disabled).toBe(true); // satu pertanyaan sekaligus
    expect(bodies()).toEqual([{ question: 'milo termurah di mana?', history: [] }]);
    await act(async () => resolve(ok(REPLIES.answer)));

    expect(await screen.findByText(REPLIES.answer.text)).toBeTruthy();
    expect(screen.getByText('5 data · terakhir hari ini')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lihat detail produk' }).getAttribute('href')).toBe(`/produk?id=${PID}`);
    expect(screen.getByText('cari_harga_terbaik(Milo Original 200 g)')).toBeTruthy();
    expect(screen.queryByText('Mencari di historimu…')).toBeNull();
    const live = document.querySelector('[aria-live="polite"].sr-only')!;
    expect(live.textContent).toBe(`Jawaban: ${REPLIES.answer.text}`);
    expect((screen.getByLabelText('Pertanyaan') as HTMLInputElement).value).toBe('');
  });

  it('pertanyaan dari S-02 (?q=) dikirim sekali, URL dibersihkan', async () => {
    fetchMock.mockResolvedValue(ok(REPLIES.ambiguous));
    setUrl('/tanya', 'q=milo');
    await renderWithProviders(<AskScreen />);
    expect(await screen.findByRole('heading', { name: 'Maksudmu yang mana?' })).toBeTruthy();
    expect(nav.replace).toHaveBeenCalledWith('/tanya');
    expect(bodies()).toEqual([{ question: 'milo', history: [] }]);
  });
});

describe('keadaan balasan dari route', () => {
  it('data kurang, di luar kemampuan, S-03b, ambigu → chip mengirim pertanyaan baru dengan history', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(REPLIES.notEnough))
      .mockResolvedValueOnce(ok(REPLIES.outOfScope))
      .mockResolvedValueOnce(ok(REPLIES.ambiguous))
      .mockResolvedValueOnce(ok(REPLIES.perUnit));
    await renderWithProviders(<AskScreen />);
    await ask('milo 500 naik atau turun?');
    expect(await conv().findByText(REPLIES.notEnough.text)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lihat perbandingan ukuran' }).getAttribute('href')).toBe(
      `/produk/ukuran?group=${GROUP}`,
    );
    await ask('resep milo');
    expect(await conv().findByText(/Saya hanya bisa menjawab dari histori hargamu/)).toBeTruthy();
    await ask('milo per gram?');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Milo Original 200 g' }));
    const link = await screen.findByRole('link', { name: 'Buka Cek harga rak' });
    expect(link.getAttribute('href')).toBe(`/produk?id=${PID}&sheet=cek-harga`);
    expect(bodies().at(-1)).toEqual({
      question: 'Milo Original 200 g termurah di mana?',
      history: [
        { question: 'milo 500 naik atau turun?', answer: REPLIES.notEnough.text },
        { question: 'resep milo', answer: expect.stringMatching(/^Saya hanya bisa menjawab/) },
        { question: 'milo per gram?', answer: 'Maksudmu yang mana? Milo Original 200 g; Milo Original 500 g' },
      ],
    });
  });

  it('429 kuota, 503 segera hadir, 503 timeout → gagal + Coba lagi', async () => {
    fetchMock
      .mockResolvedValueOnce(json(429, { error: 'AI_QUOTA_EXCEEDED', reason: 'daily', message: '' }))
      .mockResolvedValueOnce(json(503, { error: 'AI_UNAVAILABLE', reason: 'disabled', message: '' }))
      .mockResolvedValueOnce(json(503, { error: 'AI_UNAVAILABLE', reason: 'timeout', message: '' }))
      .mockResolvedValueOnce(ok(REPLIES.answer));
    await renderWithProviders(<AskScreen />);
    await ask('milo termurah?');
    expect(await conv().findByText(/Batas pertanyaan hari ini sudah tercapai/)).toBeTruthy();
    await ask('milo murah?');
    expect(await conv().findByText(/^Segera hadir\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lihat hasil cari "milo murah?"' }).getAttribute('href')).toBe(
      '/cari?q=milo%20murah%3F',
    );
    await ask('milo termurah di mana?');
    expect(await conv().findByText('Gagal menjawab. Coba lagi.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await conv().findByText(REPLIES.answer.text)).toBeTruthy();
    expect(bodies().at(-1)!.question).toBe('milo termurah di mana?');
    // Gagal/kuota/segera hadir tidak ikut history.
    expect(bodies().at(-1)!.history).toEqual([]);
  });

  it('jaringan putus saat mengirim → gagal', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await renderWithProviders(<AskScreen />);
    await ask('milo?');
    expect(await conv().findByText('Gagal menjawab. Coba lagi.')).toBeTruthy();
  });
});

describe('offline (§10.5)', () => {
  it('Kirim nonaktif + petunjuk; riwayat tetap terbaca; ?q= tidak dikirim', async () => {
    await writePref(ID.user, PREF_KEYS.askHistory, [
      { id: 'a1', question: 'milo termurah?', reply: REPLIES.answer, at: 1 },
    ]);
    setUrl('/tanya', 'q=gula');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await renderWithProviders(<AskScreen />);
    expect(await screen.findByText(REPLIES.answer.text)).toBeTruthy();
    expect(screen.getByText('Tanya butuh sinyal. Hasil cari tetap bisa dipakai offline.')).toBeTruthy();
    expect((screen.getByLabelText('Pertanyaan') as HTMLInputElement).value).toBe('gula');
    expect((screen.getByRole('button', { name: 'Kirim' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sinyal hilang setelah layar terbuka → kirim nonaktif', async () => {
    await renderWithProviders(<AskScreen />);
    await userEvent.setup().type(screen.getByLabelText('Pertanyaan'), 'milo?');
    expect((screen.getByRole('button', { name: 'Kirim' }) as HTMLButtonElement).disabled).toBe(false);
    goOffline();
    expect((screen.getByRole('button', { name: 'Kirim' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Tanya butuh sinyal/)).toBeTruthy();
  });
});

describe('riwayat di perangkat (💾, D-84)', () => {
  it('tersimpan per user, maks 20, tampil saat dibuka lagi', async () => {
    const old = Array.from({ length: 20 }, (_, i) => ({
      id: `o${i}`,
      question: `lama ${i}`,
      reply: REPLIES.outOfScope,
      at: i,
    }));
    await writePref(ID.user, PREF_KEYS.askHistory, old);
    fetchMock.mockResolvedValueOnce(ok(REPLIES.answer));
    await renderWithProviders(<AskScreen />);
    expect(await screen.findByText('lama 19')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Contoh pertanyaan' })).toBeNull();
    await ask('milo termurah?');
    await screen.findByText(REPLIES.answer.text);
    const saved = await readPref<{ question: string }[]>(ID.user, PREF_KEYS.askHistory, []);
    expect(saved).toHaveLength(20);
    expect(saved[0]!.question).toBe('lama 1');
    expect(saved.at(-1)!.question).toBe('milo termurah?');
    // Riwayat yang dimuat tidak diumumkan; hanya jawaban baru.
    expect(document.querySelector('[aria-live="polite"].sr-only')!.textContent).toBe(`Jawaban: ${REPLIES.answer.text}`);
  });
  it('Keluar menghapus riwayat Tanya bersama IndexedDB user', async () => {
    fetchMock.mockResolvedValueOnce(ok(REPLIES.answer));
    const { qc } = await renderWithProviders(<AskScreen />);
    await ask('milo termurah?');
    await screen.findByText(REPLIES.answer.text);
    await waitFor(async () => expect(await readPref<unknown[]>(ID.user, PREF_KEYS.askHistory, [])).toHaveLength(1));
    await act(() => signOutAndClear(ID.user, qc));
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(`priceatlas:${ID.user}`);
  });
});

describe('aksesibilitas', () => {
  it('axe tanpa pelanggaran serious/critical dengan jawaban, ambigu, dan gagal', async () => {
    await writePref(ID.user, PREF_KEYS.askHistory, [
      { id: 'a', question: 'milo termurah?', reply: REPLIES.answer, at: 1 },
      { id: 'b', question: 'milo?', reply: REPLIES.ambiguous, at: 2 },
      { id: 'c', question: 'gula?', reply: { kind: 'failed' }, at: 3 },
      { id: 'd', question: 'teh?', reply: { kind: 'quota', reason: 'budget' }, at: 4 },
    ]);
    await renderWithProviders(<AskScreen />);
    await screen.findByText(REPLIES.answer.text);
    const results = await axe(document.body);
    expect(
      results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id),
    ).toEqual([]);
    // Kolom berlabel, petunjuk terhubung ke kolom dan tombol.
    const input = screen.getByLabelText('Pertanyaan');
    const hint = document.getElementById(input.getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toBe('Jawaban hanya dari histori hargamu. Maks 200 karakter.');
    expect(screen.getByRole('list', { name: 'Percakapan' }).children).toHaveLength(4);
  });
});
