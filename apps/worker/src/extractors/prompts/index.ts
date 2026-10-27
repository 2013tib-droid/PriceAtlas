// Instruksi sistem berversi (docs/08 §5.2). Perubahan isi = versi baru (receipt.v2.md, …) +
// jalankan ulang split dev harness. Satu `promptVersion` gabungan per deployment (F-119).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaptureKind } from '@priceatlas/contracts';

export const PROMPT_VERSION = 'v1';

const FILE: Record<CaptureKind, string> = {
  receipt: 'receipt',
  price_label: 'label',
  marketplace: 'listing',
};

const cache = new Map<string, string>();

export function systemPrompt(kind: CaptureKind, version = PROMPT_VERSION): string {
  const file = `${FILE[kind]}.${version}.md`;
  let text = cache.get(file);
  if (text === undefined) {
    text = readFileSync(join(import.meta.dirname, file), 'utf8');
    cache.set(file, text);
  }
  return text;
}
