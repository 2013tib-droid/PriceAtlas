// Manifest dan ground truth uji OCR (docs/08 §4.2–§4.4). Ground truth divalidasi dengan skema kontrak
// yang sama dengan worker (ParsedReceipt / ParsedObservation), ditambah anotasi uji.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CaptureKindSchema, ParsedObservationSchema, ParsedReceiptSchema } from '@priceatlas/contracts';
import type { EvalPaths } from './paths.ts';

export const STORE_CATEGORIES = ['minimarket', 'supermarket', 'hypermarket', 'apotek', 'lokal', 'marketplace', 'lainnya'] as const;
export const CONDITIONS = ['long', 'faded', 'skewed', 'crumpled', 'dark', 'glare', 'handwritten', 'blurry', 'low_confidence'] as const;

export const SplitSchema = z.enum(['dev', 'test']);
export type Split = z.infer<typeof SplitSchema>;

export const ManifestEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: CaptureKindSchema,
  images: z.array(z.string()).min(1),
  split: SplitSchema,
  store_category: z.enum(STORE_CATEGORIES).nullable(),
  /** Waktu file (≈ waktu foto) untuk konteks tanggal di prompt (§5.2). */
  uploaded_at: z.string(),
  synthetic: z.boolean().optional(),
  /** sha256 file asal di inbox (supaya `init` berulang tidak mengimpor dua kali). */
  source_sha256: z.array(z.string()).optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const ManifestSchema = z.object({ version: z.literal(1), entries: z.array(ManifestEntrySchema) });
export type Manifest = z.infer<typeof ManifestSchema>;

const LineAnnotation = z
  .object({ weighed: z.boolean(), member_discount: z.boolean(), unreadable: z.boolean() })
  .partial();

export const TruthSchema = z
  .object({
    id: z.string(),
    kind: CaptureKindSchema,
    images: z.array(z.string()).min(1),
    split: SplitSchema,
    store_category: z.enum(STORE_CATEGORIES).nullable(),
    conditions: z.array(z.enum(CONDITIONS)).default([]),
    /** null = tidak terbaca oleh manusia (capture diharapkan gagal `blurry`). */
    expected: z.union([ParsedReceiptSchema, ParsedObservationSchema]).nullable(),
    annotations: z
      .object({
        lines: z.record(z.string(), LineAnnotation).default({}),
        transcript_pii: z.array(z.string()).default([]),
        notes: z.string().optional(),
      })
      .default({ lines: {}, transcript_pii: [] }),
    verified: z
      .object({
        by: z.string(),
        at: z.string(),
        prefill: z.string().nullable(),
        /** Jumlah field yang diubah dari pra-isi (ukuran bias pra-isi, §4.2). */
        prefill_changed_fields: z.number().int().min(0).optional(),
        unchecked_fields: z.number().int().min(0).optional(),
      })
      .nullable()
      .default(null),
    synthetic: z.boolean().optional(),
  })
  .superRefine((t, ctx) => {
    if (t.expected && t.expected.kind !== t.kind) ctx.addIssue({ code: 'custom', message: 'expected.kind ≠ kind' });
  });
export type Truth = z.infer<typeof TruthSchema>;

export function readManifest(p: EvalPaths): Manifest {
  if (!existsSync(p.manifest)) throw new Error(`Manifest belum ada (${p.manifest}). Jalankan: ocr-eval init`);
  return ManifestSchema.parse(JSON.parse(readFileSync(p.manifest, 'utf8')));
}

export function writeManifest(p: EvalPaths, m: Manifest): void {
  writeFileSync(p.manifest, `${JSON.stringify(ManifestSchema.parse(m), null, 2)}\n`);
}

export function truthPath(p: EvalPaths, id: string): string {
  return join(p.truth, `${id}.json`);
}

export function readTruth(p: EvalPaths, id: string): Truth | null {
  const f = truthPath(p, id);
  return existsSync(f) ? TruthSchema.parse(JSON.parse(readFileSync(f, 'utf8'))) : null;
}

export function writeTruth(p: EvalPaths, t: Truth): Truth {
  const parsed = TruthSchema.parse(t);
  writeFileSync(truthPath(p, parsed.id), `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

/** Baris yang dinilai: tanpa baris `unreadable` (§4.3). */
export function readableLineNos(t: Truth): Set<number> {
  const out = new Set<number>();
  if (t.expected?.kind !== 'receipt') return out;
  for (const l of t.expected.lines) if (!t.annotations.lines[String(l.line_no)]?.unreadable) out.add(l.line_no);
  return out;
}
