// Varian uji D-16 (docs/08 §4.5, Q-102 → D-92). Semua arm memakai prompt v1, skema LLM, dan
// konverter yang sama; bedanya hanya sumber input (gambar atau teks OCR) dan model/effort.
import type { ClaudeClient, Effort } from '../src/ai/claude.ts';
import type { OcrEngine } from '../src/extractors/ocr-parse.ts';
import { OcrThenParseExtractor } from '../src/extractors/ocr-parse.ts';
import { VisionExtractor } from '../src/extractors/vision.ts';

export interface Arm {
  id: string;
  /** Slug aman untuk custom_id batch dan nama folder (huruf, angka, strip). */
  slug: string;
  engine: 'vision' | 'ocr';
  model: string;
  effortReceipt: Effort;
  effortObservation: Effort;
  ocr?: 'google-vision';
  why: string;
}

export const ARMS: readonly Arm[] = [
  {
    id: 'vision-opus-low', slug: 'vision-opus-low', engine: 'vision', model: 'claude-opus-5-5',
    effortReceipt: 'low', effortObservation: 'low', why: 'Kandidat default termurah di model terbaik',
  },
  {
    id: 'vision-opus-medium', slug: 'vision-opus-medium', engine: 'vision', model: 'claude-opus-5-5',
    effortReceipt: 'medium', effortObservation: 'medium', why: 'Batas atas akurasi yang realistis; juga pra-isi anotasi',
  },
  {
    id: 'vision-sonnet', slug: 'vision-sonnet', engine: 'vision', model: 'claude-sonnet-5-5',
    effortReceipt: 'medium', effortObservation: 'medium', why: '±½ biaya Opus',
  },
  {
    id: 'vision-haiku', slug: 'vision-haiku', engine: 'vision', model: 'claude-haiku-5-5',
    effortReceipt: 'medium', effortObservation: 'medium', why: '±1/40 biaya Opus; apakah jalur murah layak',
  },
  {
    id: 'ocr-gcv+opus-low', slug: 'ocr-gcv-opus-low', engine: 'ocr', model: 'claude-opus-5-5', ocr: 'google-vision',
    effortReceipt: 'low', effortObservation: 'low', why: 'Pembanding D-16 "OCR khusus + Claude parse"',
  },
];

export function armById(id: string): Arm {
  const a = ARMS.find((x) => x.id === id || x.slug === id);
  if (!a) throw new Error(`arm tidak dikenal: ${id}. Pilihan: ${ARMS.map((x) => x.id).join(', ')}`);
  return a;
}

/** `--arms all` atau daftar dipisah koma. */
export function parseArms(spec: string | undefined): Arm[] {
  if (!spec || spec === 'all') return [...ARMS];
  return spec.split(',').map((s) => armById(s.trim()));
}

export type ArmExtractor = VisionExtractor | OcrThenParseExtractor;

export function buildExtractor(arm: Arm, deps: { claude: ClaudeClient; ocr?: OcrEngine | null }): ArmExtractor {
  const cfg = { model: arm.model, effortReceipt: arm.effortReceipt, effortObservation: arm.effortObservation };
  if (arm.engine === 'vision') return new VisionExtractor(deps.claude, cfg);
  if (!deps.ocr) throw new Error(`arm ${arm.id} butuh OCR (GOOGLE_VISION_API_KEY, docs/08 §5.1)`);
  return new OcrThenParseExtractor(deps.claude, deps.ocr, cfg);
}
