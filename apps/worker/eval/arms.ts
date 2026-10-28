// Varian uji OCR (docs/08 §4.5). Semua arm memakai prompt, skema LLM, dan konverter yang SAMA dengan
// produksi (VisionExtractor / OcrThenParseExtractor di src/extractors); bedanya hanya sumber input
// (gambar atau teks OCR) dan model/effort.
import type { ClaudeClient, Effort } from '../src/ai/claude.ts';
import type { OcrEngine } from '../src/extractors/ocr-parse.ts';
import { OcrThenParseExtractor } from '../src/extractors/ocr-parse.ts';
import { VisionExtractor } from '../src/extractors/vision.ts';
import type { CaptureExtractor } from '../src/pipeline/types.ts';

export interface Arm {
  name: string;
  source: 'vision' | 'ocr';
  model: string;
  effort: Effort;
  /** Hanya `ocr`: nama OcrEngine. */
  ocr?: 'gcv';
  why: string;
}

export const ARMS: readonly Arm[] = [
  { name: 'vision-opus-low', source: 'vision', model: 'claude-opus-5-5', effort: 'low', why: 'Kandidat default termurah di model terbaik' },
  { name: 'vision-opus-medium', source: 'vision', model: 'claude-opus-5-5', effort: 'medium', why: 'Batas atas akurasi realistis; pra-isi anotasi' },
  { name: 'vision-sonnet', source: 'vision', model: 'claude-sonnet-5-5', effort: 'medium', why: '±½ biaya Opus' },
  { name: 'vision-haiku', source: 'vision', model: 'claude-haiku-5-5', effort: 'medium', why: '±1/40 biaya Opus' },
  { name: 'ocr-gcv+opus-low', source: 'ocr', ocr: 'gcv', model: 'claude-opus-5-5', effort: 'low', why: 'Pembanding D-16: OCR khusus + Claude parse' },
];

export function resolveArms(spec: string): Arm[] {
  if (spec === 'all') return [...ARMS];
  return spec.split(',').map((n) => {
    const a = ARMS.find((x) => x.name === n.trim());
    if (!a) throw new Error(`Arm tidak dikenal: ${n}. Pilihan: ${ARMS.map((x) => x.name).join(', ')}`);
    return a;
  });
}

/** Extractor produksi untuk satu arm. Effort sama untuk struk dan label/screenshot di dalam satu arm. */
export function extractorFor(arm: Arm, client: ClaudeClient, ocr?: OcrEngine): CaptureExtractor {
  const cfg = { model: arm.model, effortReceipt: arm.effort, effortObservation: arm.effort };
  if (arm.source === 'vision') return new VisionExtractor(client, cfg);
  if (!ocr) throw new Error(`Arm ${arm.name} butuh OCR (${arm.ocr}): set GOOGLE_VISION_API_KEY atau pakai --client fake`);
  return new OcrThenParseExtractor(ocr, client, cfg);
}
