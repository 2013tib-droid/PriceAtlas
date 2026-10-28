// Set uji sintetis untuk harness (docs/08 §13.1): <nama>.jpg + <nama>.truth.json dalam bentuk ground
// truth §4.3. Ground truth = `output` fixture stub (nilainya diketahui sejak gambar dibuat; struk-buram:
// tidak terbaca → expected null). Dipakai `pnpm synthetic --out DIR` (render ulang lewat Playwright) dan
// `ocr-eval init --synthetic DIR`; `writeSyntheticSet` menyalin JPEG fixture yang di-commit (tanpa Chromium).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SPECS, type SyntheticSpec } from './specs.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');

export interface SyntheticTruthFile {
  id: string;
  kind: SyntheticSpec['kind'];
  images: string[];
  conditions: string[];
  store_category: SyntheticSpec['storeCategory'];
  synthetic: true;
  expected: unknown;
  annotations: { lines: Record<string, { weighed?: boolean; member_discount?: boolean }>; transcript_pii: string[] };
}

export function syntheticTruth(spec: SyntheticSpec): SyntheticTruthFile {
  const fx = JSON.parse(readFileSync(join(ROOT, spec.fixtureDir, `${spec.name}.json`), 'utf8')) as {
    output: unknown;
    failures?: { type: string; code?: string }[];
  };
  // Fixture yang selalu gagal permanen (struk-buram) = tidak terbaca oleh manusia → expected null.
  const unreadable = fx.failures?.some((f) => f.type === 'permanent' && (f.code === 'blurry' || f.code === 'not_a_receipt'));
  return {
    id: spec.name,
    kind: spec.kind,
    images: [`${spec.name}.jpg`],
    conditions: spec.conditions,
    store_category: spec.storeCategory,
    synthetic: true,
    expected: unreadable ? null : fx.output,
    annotations: { lines: spec.annotations?.lines ?? {}, transcript_pii: spec.annotations?.transcript_pii ?? [] },
  };
}

/** Tulis set: gambar dari `images` (hasil render) atau salinan fixture yang di-commit. */
export function writeSyntheticSet(dir: string, images?: Map<string, Buffer>, specs: SyntheticSpec[] = SPECS): number {
  mkdirSync(dir, { recursive: true });
  for (const s of specs) {
    const img = images?.get(s.name);
    if (img) writeFileSync(join(dir, `${s.name}.jpg`), img);
    else copyFileSync(join(ROOT, s.fixtureDir, `${s.name}.jpg`), join(dir, `${s.name}.jpg`));
    writeFileSync(join(dir, `${s.name}.truth.json`), `${JSON.stringify(syntheticTruth(s), null, 2)}\n`);
  }
  return specs.length;
}
