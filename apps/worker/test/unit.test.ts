// L2: tanpa database.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FixtureRegistry, StubAiMatcher, StubExtractor, sha256 } from '../src/extractors/stub.ts';
import { REDACTED, redactJson, redactText } from '../src/jobs/redact.ts';
import { classify } from '../src/pipeline/process-capture.ts';
import { PermanentError, TransientError, type ImageBlob } from '../src/pipeline/types.ts';
import { Scheduler, sqlTasks } from '../src/scheduler.ts';
import { FIXTURES_DIR, fixtureImages } from './helpers.ts';

const reg = new FixtureRegistry(FIXTURES_DIR);
const img = (name: string): ImageBlob => {
  const data = fixtureImages(name)[0]!;
  return { position: 1, storagePath: 'x', sha256: sha256(data), data };
};
const ctx = (attempt: number) => ({ captureId: 'c', householdId: 'h', attempt, uploadedAt: new Date(), capturedAt: null });

describe('StubExtractor (fixture per hash gambar)', () => {
  it('memetakan gambar ke fixture lewat sha256', async () => {
    const x = await new StubExtractor(reg).extract({ images: [img('struk-aeon')], ctx: ctx(1) });
    expect(x.output.kind).toBe('receipt');
    expect(x.rawText).toContain('AEON BSD');
  });
  it('tanpa fixture → PermanentError unsupported', async () => {
    const data = Buffer.from('gambar tak dikenal');
    await expect(
      new StubExtractor(reg).extract({ images: [{ position: 1, storagePath: 'x', sha256: sha256(data), data }], ctx: ctx(1) }),
    ).rejects.toMatchObject({ name: 'PermanentError', code: 'unsupported' });
  });
  it('STUB_FALLBACK_FIXTURE (khusus e2e, Q-82): gambar tanpa fixture → fixture cadangan; hash dikenal tetap', async () => {
    const fb = new FixtureRegistry(FIXTURES_DIR, { fallback: 'label-milo' });
    const data = Buffer.from('frame kamera playwright');
    const x = await new StubExtractor(fb).extract({
      images: [{ position: 1, storagePath: 'x', sha256: sha256(data), data }],
      ctx: ctx(1),
    });
    expect(x.rawText).toContain('MILO ORIGINAL 200G');
    expect(fb.get(img('struk-aeon').sha256)?.name).toBe('struk-aeon');
    expect(reg.fallback).toBeUndefined();
    expect(() => new FixtureRegistry(FIXTURES_DIR, { fallback: 'tidak-ada' })).toThrow(/STUB_FALLBACK_FIXTURE/);
  });
  it('failures dipakai per percobaan', async () => {
    const ex = new StubExtractor(reg);
    await expect(ex.extract({ images: [img('struk-alfamart-timeout')], ctx: ctx(1) })).rejects.toBeInstanceOf(TransientError);
    await expect(ex.extract({ images: [img('struk-alfamart-timeout')], ctx: ctx(2) })).rejects.toBeInstanceOf(TransientError);
    await expect(ex.extract({ images: [img('struk-alfamart-timeout')], ctx: ctx(3) })).resolves.toHaveProperty('output.kind', 'receipt');
    await expect(ex.extract({ images: [img('struk-buram')], ctx: ctx(1) })).rejects.toMatchObject({ code: 'blurry' });
  });
  it('fixture <sha256>.json juga dikenali', () => {
    expect(reg.get(sha256(fixtureImages('label-milo')[0]!))?.name).toBe('label-milo');
  });
  it('StubAiMatcher: saran dari fixture, kosong jika tidak ada', async () => {
    const ai = new StubAiMatcher(reg);
    const c = { householdId: 'h', storeId: null, kind: 'receipt' as const, imageSha256s: [img('struk-aeon').sha256] };
    expect(await ai.match([{ key: 5, raw_text: 'SNACK XYZ' }, { key: 9, raw_text: 'LAIN' }], c)).toEqual([
      { key: 5, product_id: '70000000-0000-0000-0000-000000000310', confidence: 0.62 },
    ]);
  });
});

describe('klasifikasi error (§5.3)', () => {
  it('permanen, transient, tak dikenal', () => {
    expect(classify(new PermanentError('blurry', 'buram'))).toEqual({ code: 'blurry', message: 'buram', transient: false });
    expect(classify(new TransientError('503'))).toMatchObject({ transient: true });
    expect(classify(new Error('ECONNRESET'))).toMatchObject({ code: 'other', transient: true });
  });
  it('pesan permanen default berbahasa Indonesia', () => {
    expect(classify(new PermanentError('not_a_receipt', '')).message).toMatch(/bukan struk/);
  });
});

describe('redaksi PII stub (§7.4)', () => {
  it('kartu, HP, email, nilai pii', () => {
    const t = redactText('DEBIT 4111 1111 1111 1111 / ****4321 HP 0812-9876-5432 ani@mail.com MEMBER ANI SUSANTI', ['ANI SUSANTI']);
    expect(t).not.toMatch(/4111|4321|0812|ani@mail|SUSANTI/);
    expect(t.split(REDACTED).length - 1).toBeGreaterThanOrEqual(4);
  });
  it('nomor +62 dan 62', () => {
    expect(redactText('hub +6281234567890 atau 6281234567890')).toBe(`hub ${REDACTED} atau ${REDACTED}`);
  });
  it('harga dan tanggal tidak tersentuh', () => {
    expect(redactText('MILO 2 x 19.500 = 39.000 15/10/2026')).toBe('MILO 2 x 19.500 = 39.000 15/10/2026');
  });
  it('JSON: string disamarkan, objek pii dikosongkan', () => {
    expect(redactJson({ pii: { phone: '081234567890' }, lines: [{ raw_text: 'HP 081234567890' }], total: 5 })).toEqual({
      pii: {},
      lines: [{ raw_text: `HP ${REDACTED}` }],
      total: 5,
    });
  });
});

describe('dev scheduler (§1.4)', () => {
  it('tugas SQL sama dengan migration pg_cron', () => {
    const cron = readFileSync(resolve(import.meta.dirname, '../../../supabase/migrations/20261020000900_cron.sql'), 'utf8');
    const fns = [...cron.matchAll(/\$\$select (app\.[a-z_]+\([0-9]*\))\$\$/g)].map((m) => m[1]).sort();
    const tasks = sqlTasks({ query: async () => undefined } as never).map((t) => String(t.run).length && t.name);
    expect(tasks.length).toBe(fns.length);
    const sqls = sqlTasks({ query: async (sql: string) => sql } as never);
    return Promise.all(sqls.map((t) => t.run())).then((ran) =>
      expect((ran as string[]).map((s) => s.replace('select ', '')).sort()).toEqual(fns),
    );
  });
  it('interval dan jadwal harian UTC', async () => {
    let now = new Date('2026-10-19T17:00:00Z');
    const ran: string[] = [];
    const s = new Scheduler(
      [
        { name: 'cepat', every: 10_000, run: async () => ran.push('cepat') },
        { name: 'harian', dailyUtc: '17:05', run: async () => ran.push('harian') },
      ],
      () => now,
    );
    await s.tick();
    now = new Date('2026-10-19T17:00:05Z');
    await s.tick();
    now = new Date('2026-10-19T17:05:00Z');
    await s.tick();
    now = new Date('2026-10-19T17:06:00Z');
    await s.tick();
    now = new Date('2026-10-20T17:05:30Z');
    await s.tick();
    expect(ran).toEqual(['cepat', 'cepat', 'harian', 'cepat', 'cepat', 'harian']);
  });
});
