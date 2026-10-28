// Data harness uji OCR (docs/08 §4.2, §4.3). Data asli HANYA di folder data (default
// <repo>/.data/ocr-eval, atau OCR_EVAL_DIR) di mesin pemilik proyek (Q-105, D-92):
//   manifest.json            id, jenis, kategori, kondisi, split, nama file — TANPA teks struk
//   inbox/                   foto apa adanya dari HP (lihat init.ts)
//   images/<id>-<pos>.<ext>  gambar (HEIC boleh)
//   truth/<id>.json          ground truth (§4.3)
//   runs/<waktu>-<arm>/      output per gambar, usage, latensi
//   reports/                 laporan; hanya *.agg.json yang boleh dikirim/di-commit
//   spend.json               buku biaya kumulatif (batas keras US$75, §12.2)
// Guard F-117: harness menolak berjalan jika folder data ada di dalam repo git dan TIDAK di-ignore.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { ParsedObservationSchema, ParsedReceiptSchema, type CaptureKind, type ParsedOutput } from '@priceatlas/contracts';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');
export const DEFAULT_DATA_DIR = join(REPO_ROOT, '.data/ocr-eval');

export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.OCR_EVAL_DIR || DEFAULT_DATA_DIR);
}

export class GuardError extends Error {
  override name = 'GuardError';
}

/**
 * F-117: folder data tidak boleh bisa ter-commit. Di luar work tree git → aman. Di dalam work tree →
 * wajib `git check-ignore` (mis. `.data/` di .gitignore). Git tidak ada → ditolak (tidak bisa dicek).
 */
export function assertIgnored(dir: string): void {
  mkdirSync(dir, { recursive: true });
  let top: string;
  try {
    top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch (e) {
    const err = e as { status?: number; code?: string };
    if (err.code === 'ENOENT') throw new GuardError('git tidak ditemukan: tidak bisa memastikan folder data di-ignore (F-117).');
    return; // bukan work tree git (status 128) → di luar repo
  }
  try {
    execFileSync('git', ['-C', top, 'check-ignore', '-q', dir], { stdio: 'ignore' });
  } catch {
    throw new GuardError(
      `Folder data ${dir} ada di repo git ${top} dan TIDAK di-ignore. Data uji berisi PII (F-117): ` +
        'pakai .data/ocr-eval (sudah di .gitignore) atau OCR_EVAL_DIR di luar repo.',
    );
  }
}

// ---------------------------------------------------------------------------- manifest

export const STORE_CATEGORIES = ['minimarket', 'supermarket', 'hypermarket', 'apotek', 'lokal', 'marketplace', 'bebas'] as const;
export const CONDITIONS = ['long', 'faded', 'skewed', 'crumpled', 'dark', 'glare', 'handwritten', 'old', 'weighed', 'member', 'void', 'bag_donation', 'multi_label', 'order_page'] as const;
export const SPLITS = ['dev', 'test'] as const;
export type Split = (typeof SPLITS)[number];

export const ManifestEntrySchema = z.object({
  id: z.string().regex(/^[rls]-[0-9a-f]{4,8}$/),
  kind: z.enum(['receipt', 'price_label', 'marketplace']),
  store_category: z.enum(STORE_CATEGORIES),
  conditions: z.array(z.string()).default([]),
  split: z.enum(SPLITS),
  images: z.array(z.string()).min(1),
  /** Tanggal referensi (mtime file foto, ISO): dipakai sebagai "tanggal unggah" saat run (§5.2). */
  uploaded_at: z.string(),
  /** sha256 file asal di inbox (impor ulang dicegah). Bukan teks. */
  source_sha256: z.array(z.string()),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const ManifestSchema = z.object({
  version: z.literal(1),
  created_at: z.string(),
  seed: z.number(),
  captures: z.array(ManifestEntrySchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export function readManifest(dir: string): Manifest {
  const p = join(dir, 'manifest.json');
  if (!existsSync(p)) throw new Error(`manifest.json belum ada di ${dir}. Jalankan "ocr-eval init" dulu.`);
  return ManifestSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

// ---------------------------------------------------------------------------- ground truth (§4.3)

/** Nilai `expected` = kontrak `parsed` yang sama dengan worker. Confidence tidak diisi (diabaikan skor). */
export const LineAnnotationSchema = z
  .object({ weighed: z.boolean(), member_discount: z.boolean(), unreadable: z.boolean() })
  .partial();

export const TruthSchema = z.object({
  id: z.string(),
  kind: z.enum(['receipt', 'price_label', 'marketplace']),
  images: z.array(z.string()).min(1),
  split: z.enum(SPLITS),
  store_category: z.enum(STORE_CATEGORIES),
  conditions: z.array(z.string()).default([]),
  /** null = gambar memang tidak terbaca oleh manusia (yang benar: blurry/not_a_receipt). */
  expected: z.union([ParsedReceiptSchema, ParsedObservationSchema]).nullable(),
  annotations: z
    .object({
      /** Per line_no (struk) atau nomor item 1-based (label/screenshot). */
      lines: z.record(z.string(), LineAnnotationSchema).default({}),
      /** Nilai PII yang TIDAK boleh muncul setelah redaksi (§4.7 kebocoran). */
      transcript_pii: z.array(z.string()).default([]),
      notes: z.string().nullish(),
    })
    .default({ lines: {}, transcript_pii: [] }),
  /** null = draf (belum semua field diperiksa); hanya truth terverifikasi yang dinilai. */
  verified: z
    .object({ by: z.string(), at: z.string(), prefill: z.string().nullable() })
    .nullable()
    .default(null),
  synthetic: z.boolean().optional(),
});
export type Truth = z.infer<typeof TruthSchema>;

export function truthPath(dir: string, id: string): string {
  return join(dir, 'truth', `${id}.json`);
}

export function readTruth(dir: string, id: string): Truth | null {
  const p = truthPath(dir, id);
  return existsSync(p) ? TruthSchema.parse(JSON.parse(readFileSync(p, 'utf8'))) : null;
}

export function readAllTruths(dir: string): Truth[] {
  const d = join(dir, 'truth');
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => TruthSchema.parse(JSON.parse(readFileSync(join(d, f), 'utf8'))));
}

/** Kontrak tanpa confidence: bentuk `expected` dari output model (pra-isi anotasi, §4.2). */
export function stripConfidence(out: ParsedOutput): ParsedOutput {
  if (out.kind === 'receipt') {
    return {
      ...out,
      header: { ...out.header, field_confidence: {} },
      lines: out.lines.map(({ parse_confidence: _c, ...l }) => l),
    };
  }
  return { ...out, items: out.items.map((i) => ({ ...i, field_confidence: {} })) };
}

export function kindPrefix(kind: CaptureKind): 'r' | 'l' | 's' {
  return kind === 'receipt' ? 'r' : kind === 'price_label' ? 'l' : 's';
}
