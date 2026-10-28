// Tempat data uji OCR (docs/08 §4.2, F-117): `<repo>/.data/ocr-eval/` atau `OCR_EVAL_DIR`.
// Data asli (foto, ground truth, output mentah) TIDAK PERNAH masuk git: harness menolak berjalan jika
// folder data ada di dalam repo tetapi tidak di-ignore (`git check-ignore`). Folder di luar repo boleh.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

export interface EvalPaths {
  root: string;
  inbox: string;
  images: string;
  truth: string;
  runs: string;
  reports: string;
  manifest: string;
  ledger: string;
}

export function evalPaths(dir = process.env.OCR_EVAL_DIR || join(REPO_ROOT, '.data/ocr-eval')): EvalPaths {
  const root = resolve(dir);
  return {
    root,
    inbox: join(root, 'inbox'),
    images: join(root, 'images'),
    truth: join(root, 'truth'),
    runs: join(root, 'runs'),
    reports: join(root, 'reports'),
    manifest: join(root, 'manifest.json'),
    ledger: join(root, 'spend.json'),
  };
}

export class UnsafeDataDirError extends Error {}

/** Pengaman F-117: folder di dalam repo wajib di-ignore git. Dipanggil sebelum menulis apa pun. */
export function assertSafeDataDir(root: string, repoRoot = REPO_ROOT): void {
  const rel = relative(repoRoot, root);
  const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  if (!inside) return;
  if (rel === '') throw new UnsafeDataDirError('Folder data uji OCR tidak boleh root repo.');
  try {
    execFileSync('git', ['-C', repoRoot, 'check-ignore', '-q', rel], { stdio: 'ignore' });
  } catch {
    throw new UnsafeDataDirError(
      `Folder data uji OCR ${rel} ada di dalam repo tetapi TIDAK di-ignore git (F-117). ` +
        'Pakai .data/ocr-eval (sudah di .gitignore) atau OCR_EVAL_DIR di luar repo.',
    );
  }
}

export function ensureDirs(p: EvalPaths): void {
  assertSafeDataDir(p.root);
  for (const d of [p.root, p.inbox, p.images, p.truth, p.runs, p.reports]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
}
