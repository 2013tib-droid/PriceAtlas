// `ocr-eval init` (docs/08 §4.2 langkah 2): foto di inbox/ → images/<id>-<pos>.<ext> + manifest.json.
// Susunan inbox (tanpa nama toko di nama file; nama file/folder asli TIDAK disimpan di manifest):
//   inbox/<jenis>/[<kategori>/]<file>            satu foto = satu capture
//   inbox/<jenis>/[<kategori>/]<folder>/<file…>  struk panjang: satu folder = satu capture, bagian urut nama file
// <jenis>    = receipt | price_label | marketplace (alias: struk, label, screenshot)
// <kategori> = minimarket | supermarket | hypermarket | apotek | lokal | marketplace | bebas (default: bebas,
//              marketplace untuk screenshot). Folder lain di bawah <jenis> dianggap struk multi-bagian.
// Id acak (r-/l-/s- + hex), split dev 30 % / test 70 % berstrata per (jenis, kategori) (D-92), acak
// deterministik dari `seed`. Menjalankan ulang hanya menambah foto baru (sha256 sumber); split yang sudah
// ada tidak berubah.
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { CaptureKind } from '@priceatlas/contracts';
import { sniffImageType } from '../src/images/prepare.ts';
import type { SyntheticTruthFile } from './synthetic/set.ts';
import {
  STORE_CATEGORIES,
  kindPrefix,
  writeJson,
  type Manifest,
  type ManifestEntry,
  type Split,
} from './data.ts';

const KIND_DIRS: Record<string, CaptureKind> = {
  receipt: 'receipt',
  struk: 'receipt',
  price_label: 'price_label',
  label: 'price_label',
  marketplace: 'marketplace',
  screenshot: 'marketplace',
};
export const DEV_FRACTION = 0.3;

type Category = ManifestEntry['store_category'];

interface Found {
  kind: CaptureKind;
  category: Category;
  files: string[];
}

function isImageFile(path: string): boolean {
  if (!statSync(path).isFile()) return false;
  const head = readFileSync(path).subarray(0, 32);
  return sniffImageType(head) !== null;
}

function sortedEntries(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/** Telusuri inbox → daftar capture (belum diberi id). File yang bukan gambar dilewati. */
export function scanInbox(inbox: string): { found: Found[]; skipped: number } {
  const found: Found[] = [];
  let skipped = 0;
  if (!existsSync(inbox)) return { found, skipped };
  const collect = (dir: string, kind: CaptureKind, category: Category) => {
    for (const name of sortedEntries(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        const parts = sortedEntries(p)
          .map((f) => join(p, f))
          .filter((f) => {
            const ok = isImageFile(f);
            if (!ok) skipped++;
            return ok;
          });
        if (parts.length) found.push({ kind, category, files: parts });
      } else if (isImageFile(p)) {
        found.push({ kind, category, files: [p] });
      } else {
        skipped++;
      }
    }
  };
  for (const kd of sortedEntries(inbox)) {
    const kind = KIND_DIRS[kd];
    const kp = join(inbox, kd);
    if (!kind || !statSync(kp).isDirectory()) {
      skipped++;
      continue;
    }
    const defaultCat: Category = kind === 'marketplace' ? 'marketplace' : 'bebas';
    // Kategori = subfolder bernama kategori; file/folder lain langsung di bawah jenis = kategori default.
    for (const name of sortedEntries(kp)) {
      const p = join(kp, name);
      if (statSync(p).isDirectory() && (STORE_CATEGORIES as readonly string[]).includes(name)) {
        collect(p, kind, name as Category);
      }
    }
    const loose = sortedEntries(kp).filter((n) => !(STORE_CATEGORIES as readonly string[]).includes(n));
    for (const name of loose) {
      const p = join(kp, name);
      if (statSync(p).isDirectory()) {
        const parts = sortedEntries(p)
          .map((f) => join(p, f))
          .filter((f) => isImageFile(f));
        if (parts.length) found.push({ kind, category: defaultCat, files: parts });
      } else if (isImageFile(p)) {
        found.push({ kind, category: defaultCat, files: [p] });
      } else skipped++;
    }
  }
  return { found, skipped };
}

/** PRNG deterministik (mulberry32) untuk split. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Split berstrata: per strata (jenis, kategori) jumlah dev = round(30 % × total strata) dihitung dari
 * SEMUA capture strata itu (lama + baru), capture lama tidak dipindah; capture baru diacak dengan seed.
 */
export function assignSplits(existing: ManifestEntry[], fresh: Omit<ManifestEntry, 'split'>[], seed: number): ManifestEntry[] {
  const rand = rng(seed + existing.length);
  const out: ManifestEntry[] = [];
  const strata = new Map<string, Omit<ManifestEntry, 'split'>[]>();
  for (const f of fresh) {
    const k = `${f.kind}/${f.store_category}`;
    strata.set(k, [...(strata.get(k) ?? []), f]);
  }
  for (const [k, items] of strata) {
    const old = existing.filter((e) => `${e.kind}/${e.store_category}` === k);
    const total = old.length + items.length;
    const wantDev = Math.round(total * DEV_FRACTION);
    let devLeft = Math.max(0, wantDev - old.filter((e) => e.split === 'dev').length);
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    for (const it of shuffled) {
      const split: Split = devLeft > 0 ? 'dev' : 'test';
      if (split === 'dev') devLeft--;
      out.push({ ...it, split });
    }
  }
  return out;
}

function newId(kind: CaptureKind, taken: Set<string>): string {
  for (;;) {
    const id = `${kindPrefix(kind)}-${randomBytes(2).toString('hex')}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

export interface InitResult {
  added: number;
  skipped: number;
  duplicates: number;
  total: number;
  bySplit: Record<Split, number>;
}

export function initData(dir: string, opts: { seed?: number; now?: Date } = {}): InitResult {
  const manifestPath = join(dir, 'manifest.json');
  const manifest: Manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest)
    : { version: 1, created_at: (opts.now ?? new Date()).toISOString(), seed: opts.seed ?? randomBytes(4).readUInt32BE(0), captures: [] };
  const known = new Set(manifest.captures.flatMap((c) => c.source_sha256));
  const taken = new Set(manifest.captures.map((c) => c.id));
  const { found, skipped } = scanInbox(join(dir, 'inbox'));
  mkdirSync(join(dir, 'images'), { recursive: true });

  const fresh: Omit<ManifestEntry, 'split'>[] = [];
  let duplicates = 0;
  for (const f of found) {
    const shas = f.files.map((p) => createHash('sha256').update(readFileSync(p)).digest('hex'));
    if (shas.some((s) => known.has(s))) {
      duplicates++;
      continue;
    }
    shas.forEach((s) => known.add(s));
    const id = newId(f.kind, taken);
    const images = f.files.map((p, i) => `${id}-${i + 1}${extname(p).toLowerCase() || '.jpg'}`);
    f.files.forEach((p, i) => copyFileSync(p, join(dir, 'images', images[i]!)));
    const mtime = Math.min(...f.files.map((p) => statSync(p).mtimeMs));
    fresh.push({
      id,
      kind: f.kind,
      store_category: f.category,
      conditions: f.files.length > 1 ? ['long'] : [],
      images,
      uploaded_at: new Date(mtime).toISOString(),
      source_sha256: shas,
    });
  }
  manifest.captures.push(...assignSplits(manifest.captures, fresh, manifest.seed));
  writeJson(manifestPath, manifest);
  const bySplit = { dev: 0, test: 0 } as Record<Split, number>;
  for (const c of manifest.captures) bySplit[c.split]++;
  return { added: fresh.length, skipped, duplicates, total: manifest.captures.length, bySplit };
}

/**
 * `ocr-eval init --synthetic DIR`: set sintetis (`pnpm synthetic --out DIR`, eval/synthetic/set.ts) →
 * capture + ground truth TERVERIFIKASI (`verified.by = 'synthetic'`), untuk menguji harness end-to-end
 * tanpa data asli (Q-105, F-117). Id tetap acak; nama fixture tidak masuk manifest.
 */
export function importSynthetic(dir: string, setDir: string, opts: { seed?: number; now?: Date } = {}): InitResult {
  const manifestPath = join(dir, 'manifest.json');
  const now = opts.now ?? new Date();
  const manifest: Manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest)
    : { version: 1, created_at: now.toISOString(), seed: opts.seed ?? randomBytes(4).readUInt32BE(0), captures: [] };
  const known = new Set(manifest.captures.flatMap((c) => c.source_sha256));
  const taken = new Set(manifest.captures.map((c) => c.id));
  mkdirSync(join(dir, 'images'), { recursive: true });
  const fresh: (Omit<ManifestEntry, 'split'> & { truth: SyntheticTruthFile })[] = [];
  let duplicates = 0;
  for (const f of readdirSync(setDir).filter((x) => x.endsWith('.truth.json')).sort()) {
    const t = JSON.parse(readFileSync(join(setDir, f), 'utf8')) as SyntheticTruthFile;
    const files = t.images.map((img) => join(setDir, img));
    const shas = files.map((p) => createHash('sha256').update(readFileSync(p)).digest('hex'));
    if (shas.some((s) => known.has(s))) {
      duplicates++;
      continue;
    }
    shas.forEach((s) => known.add(s));
    const id = newId(t.kind, taken);
    const images = files.map((p, i) => `${id}-${i + 1}${extname(p).toLowerCase()}`);
    files.forEach((p, i) => copyFileSync(p, join(dir, 'images', images[i]!)));
    fresh.push({
      id, kind: t.kind, store_category: t.store_category, conditions: t.conditions, images,
      // Tanggal referensi = hari ini: tanggal sintetis (Oktober 2026) masuk jendela tanggal konverter.
      uploaded_at: now.toISOString(), source_sha256: shas, truth: t,
    });
  }
  const assigned = assignSplits(manifest.captures, fresh.map(({ truth: _t, ...e }) => e), manifest.seed);
  manifest.captures.push(...assigned);
  for (const e of assigned) {
    const t = fresh.find((x) => x.id === e.id)!.truth;
    writeJson(join(dir, 'truth', `${e.id}.json`), {
      id: e.id, kind: e.kind, images: e.images, split: e.split, store_category: e.store_category, conditions: e.conditions,
      expected: t.expected, annotations: { ...t.annotations, notes: null },
      verified: { by: 'synthetic', at: now.toISOString().slice(0, 10), prefill: null }, synthetic: true,
    });
  }
  writeJson(manifestPath, manifest);
  const bySplit = { dev: 0, test: 0 } as Record<Split, number>;
  for (const c of manifest.captures) bySplit[c.split]++;
  return { added: fresh.length, skipped: 0, duplicates, total: manifest.captures.length, bySplit };
}
