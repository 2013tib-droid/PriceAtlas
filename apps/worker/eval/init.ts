// `ocr-eval init` (docs/08 §4.2 langkah 2): foto dari inbox → images/<id>-<pos>.<ext> + manifest.
// Tata letak inbox:
//   inbox/<jenis>/[<kategori>/]<foto>            satu foto = satu capture
//   inbox/<jenis>/[<kategori>/]<folder>/<foto…>  satu folder = satu capture multi-bagian (urut nama file)
//   <jenis>: struk | label | screenshot ; <kategori>: minimarket | supermarket | hypermarket | apotek | lokal | marketplace | lainnya
// Id acak (tidak memakai nama toko/nama file). Split dev 30 % / test 70 %, berstrata per jenis+kategori,
// deterministik dari --seed. `--synthetic` membuat set dari generator sintetis (tanpa foto asli).
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ParsedOutputSchema, type CaptureKind } from '@priceatlas/contracts';
import { REPO_ROOT, ensureDirs, type EvalPaths } from './paths.ts';
import { STORE_CATEGORIES, readManifest, writeManifest, writeTruth, type Manifest, type ManifestEntry, type Truth } from './truth.ts';

export const DEV_FRACTION = 0.3;
const KIND_DIRS: Record<string, CaptureKind> = { struk: 'receipt', label: 'price_label', screenshot: 'marketplace' };
const PREFIX: Record<CaptureKind, string> = { receipt: 'r', price_label: 'l', marketplace: 's' };
const IMAGE_EXT = /\.(jpe?g|png|heic|heif|webp)$/i;

/** PRNG kecil deterministik (mulberry32) untuk split. */
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

/** Split berstrata: per (jenis, kategori), round(30 %) ke dev (minimal 1 jika kelompok ≥ 2). */
export function assignSplits<T extends { kind: string; store_category: string | null }>(items: T[], seed: number): (T & { split: 'dev' | 'test' })[] {
  const rand = rng(seed);
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = `${it.kind}/${it.store_category ?? '-'}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const dev = new Set<T>();
  for (const g of [...groups.keys()].sort().map((k) => groups.get(k)!)) {
    const shuffled = g.map((x) => ({ x, r: rand() })).sort((a, b) => a.r - b.r).map((y) => y.x);
    const n = g.length >= 2 ? Math.max(1, Math.round(g.length * DEV_FRACTION)) : 0;
    shuffled.slice(0, n).forEach((x) => dev.add(x));
  }
  return items.map((it) => ({ ...it, split: dev.has(it) ? ('dev' as const) : ('test' as const) }));
}

interface Found {
  kind: CaptureKind;
  store_category: (typeof STORE_CATEGORIES)[number] | null;
  files: string[];
}

function scanInbox(inbox: string): Found[] {
  const out: Found[] = [];
  const list = (d: string) => readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const walk = (dir: string, kind: CaptureKind, cat: Found['store_category'], depth: number) => {
    for (const e of list(dir)) {
      const p = join(dir, e.name);
      if (e.isFile() && IMAGE_EXT.test(e.name)) out.push({ kind, store_category: cat, files: [p] });
      else if (e.isDirectory()) {
        const isCat = depth === 0 && (STORE_CATEGORIES as readonly string[]).includes(e.name);
        if (isCat) walk(p, kind, e.name as Found['store_category'], 1);
        else {
          const files = list(p).filter((f) => f.isFile() && IMAGE_EXT.test(f.name)).map((f) => join(p, f.name));
          if (files.length) out.push({ kind, store_category: cat, files });
        }
      }
    }
  };
  if (!existsSync(inbox)) return out;
  for (const e of list(inbox)) if (e.isDirectory() && KIND_DIRS[e.name]) walk(join(inbox, e.name), KIND_DIRS[e.name]!, e.name === 'screenshot' ? 'marketplace' : null, 0);
  return out;
}

const fileSha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

export function initFromInbox(paths: EvalPaths, opts: { seed?: number } = {}): { added: number; total: number } {
  ensureDirs(paths);
  const manifest: Manifest = existsSync(paths.manifest) ? readManifest(paths) : { version: 1, entries: [] };
  const known = new Set(manifest.entries.flatMap((e) => e.source_sha256 ?? []));
  const fresh = scanInbox(paths.inbox).filter((f) => !f.files.some((x) => known.has(fileSha(x))));
  const used = new Set(manifest.entries.map((e) => e.id));
  const newEntries: Omit<ManifestEntry, 'split'>[] = fresh.map((f) => {
    let id: string;
    do id = `${PREFIX[f.kind]}-${randomBytes(3).toString('hex')}`;
    while (used.has(id));
    used.add(id);
    const images = f.files.map((src, i) => {
      const name = `${id}-${i + 1}${extname(src).toLowerCase()}`;
      copyFileSync(src, join(paths.images, name));
      return name;
    });
    return {
      id,
      kind: f.kind,
      images,
      store_category: f.store_category,
      uploaded_at: new Date(Math.min(...f.files.map((x) => statSync(x).mtimeMs))).toISOString(),
      source_sha256: f.files.map(fileSha),
    };
  });
  manifest.entries.push(...assignSplits(newEntries, opts.seed ?? 16));
  writeManifest(paths, manifest);
  return { added: newEntries.length, total: manifest.entries.length };
}

// ------------------------------------------------------------------ set sintetis

const SYNTH_CATEGORY: Record<string, ManifestEntry['store_category']> = {
  'struk-aeon': 'hypermarket',
  'struk-alfamart-timeout': 'minimarket',
  'struk-buram': 'lokal',
  'struk-tanpa-toko': 'lokal',
  'label-milo': 'hypermarket',
  'label-kamera': 'hypermarket',
  'shopee-milo': 'marketplace',
  'shopee-milo-ragu': 'marketplace',
};

/**
 * Set sintetis (§13.1): gambar dari generator (Playwright) atau dari fixture JPEG yang sudah di-commit
 * (`fromFixtures`, tanpa browser), ground truth = `output` fixture stub. Tidak ada data asli.
 */
export async function initSynthetic(paths: EvalPaths, opts: { fromFixtures?: boolean; seed?: number } = {}): Promise<{ added: number }> {
  ensureDirs(paths);
  const { SPECS } = await import('./synthetic/specs.ts');
  let images: Map<string, Buffer>;
  if (opts.fromFixtures) {
    images = new Map(SPECS.map((s) => [s.name, readFileSync(join(REPO_ROOT, s.fixtureDir, `${s.name}.jpg`))]));
  } else {
    const { render } = await import('./synthetic/generate.ts');
    images = await render();
  }
  const uploadedAt = '2026-10-20T03:00:00.000Z';
  const base = SPECS.map((s) => ({ name: s.name, kind: s.kind as CaptureKind, store_category: SYNTH_CATEGORY[s.name] ?? null, spec: s }));
  const entries = assignSplits(base, opts.seed ?? 16);
  const manifest: Manifest = { version: 1, entries: [] };
  for (const e of entries) {
    const file = `${e.name}-1.jpg`;
    writeFileSync(join(paths.images, file), images.get(e.name)!);
    manifest.entries.push({ id: e.name, kind: e.kind, images: [file], split: e.split, store_category: e.store_category, uploaded_at: uploadedAt, synthetic: true });
    const fx = JSON.parse(readFileSync(join(REPO_ROOT, e.spec.fixtureDir, `${e.name}.json`), 'utf8')) as { output: unknown };
    const unreadable = e.name === 'struk-buram';
    const expected = unreadable ? null : ParsedOutputSchema.parse(fx.output);
    const memberLines: Record<string, { member_discount: boolean }> = {};
    if (expected?.kind === 'receipt') {
      for (const l of expected.lines) if (l.line_type === 'discount') memberLines[String(l.line_no)] = { member_discount: /member/i.test(l.raw_text) };
    }
    const truth: Truth = {
      id: e.name,
      kind: e.kind,
      images: [file],
      split: e.split,
      store_category: e.store_category,
      conditions: e.spec.conditions.filter((c): c is Truth['conditions'][number] => ['long', 'faded', 'skewed', 'crumpled', 'dark', 'glare', 'handwritten', 'blurry', 'low_confidence'].includes(c)),
      expected,
      annotations: {
        lines: memberLines,
        transcript_pii: expected?.kind === 'receipt' ? Object.values(expected.pii) : [],
      },
      verified: { by: 'synthetic', at: uploadedAt.slice(0, 10), prefill: null },
      synthetic: true,
    };
    writeTruth(paths, truth);
  }
  writeManifest(paths, manifest);
  return { added: manifest.entries.length };
}
