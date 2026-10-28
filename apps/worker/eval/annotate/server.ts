// Alat anotasi lokal (docs/08 §4.2 langkah 3, §4.3): server kecil HANYA di 127.0.0.1 + satu halaman
// HTML statis. Gambar di kiri, form ground truth di kanan. Pra-isi dari run arm terakhir (`--prefill`),
// kecuali N struk pertama (default 5) yang sengaja tanpa pra-isi untuk mengukur bias pra-isi.
// Setiap field pra-isi bertanda "belum diperiksa" sampai disentuh; jumlahnya dicatat di `verified`.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareImage } from '../../src/images/prepare.ts';
import { latestRecords } from '../report.ts';
import { flatFields } from '../score.ts';
import type { EvalPaths } from '../paths.ts';
import { TruthSchema, readManifest, readTruth, writeManifest, writeTruth, type ManifestEntry } from '../truth.ts';

export const ANNOTATE_PORT = 4317;
const HTML = join(import.meta.dirname, 'index.html');
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export interface AnnotateOptions {
  prefillArm: string | null;
  /** N struk pertama (urut manifest) tanpa pra-isi. */
  noPrefillFirst: number;
}

function noPrefillIds(entries: ManifestEntry[], n: number): Set<string> {
  return new Set(entries.filter((e) => e.kind === 'receipt').slice(0, n).map((e) => e.id));
}

export function prefillFor(paths: EvalPaths, id: string, opts: AnnotateOptions) {
  if (!opts.prefillArm) return null;
  const entries = readManifest(paths).entries;
  if (noPrefillIds(entries, opts.noPrefillFirst).has(id)) return null;
  const rec = latestRecords(paths)
    .filter((r) => r.id === id && r.arm === opts.prefillArm && r.ok && r.output)
    .sort((a, b) => a.repeat - b.repeat)[0];
  return rec?.output ?? null;
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : (body as Buffer | string));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 5_000_000) throw new Error('body terlalu besar');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createAnnotateServer(paths: EvalPaths, opts: AnnotateOptions): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      // Hanya permintaan dari halaman sendiri (cegah situs lain menulis lewat browser).
      if (req.method !== 'GET' && req.headers.origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(req.headers.origin)) {
        return send(res, 403, { error: 'origin' });
      }
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, readFileSync(HTML), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
        const file = decodeURIComponent(url.pathname.slice('/images/'.length));
        if (!/^[a-z0-9-]+\.(jpe?g|png|webp|heic|heif)$/i.test(file)) return send(res, 400, { error: 'nama file' });
        const p = join(paths.images, file);
        if (!existsSync(p)) return send(res, 404, { error: 'tidak ada' });
        const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
        // HEIC tidak tampil di kebanyakan browser: turunan JPEG yang sama dengan yang dikirim ke model (§6).
        if (ext === '.heic' || ext === '.heif') {
          const img = await prepareImage(readFileSync(p));
          return send(res, 200, img.data, img.mediaType);
        }
        return send(res, 200, readFileSync(p), MIME[ext] ?? 'application/octet-stream');
      }
      if (req.method === 'GET' && url.pathname === '/api/list') {
        const m = readManifest(paths);
        return send(
          res,
          200,
          m.entries.map((e) => {
            const t = readTruth(paths, e.id);
            return { id: e.id, kind: e.kind, split: e.split, store_category: e.store_category, images: e.images, status: t?.verified ? 'verified' : t ? 'draft' : 'none' };
          }),
        );
      }
      const item = url.pathname.match(/^\/api\/item\/([a-z0-9-]+)$/);
      if (item) {
        const id = item[1]!;
        const m = readManifest(paths);
        const entry = m.entries.find((e) => e.id === id);
        if (!entry) return send(res, 404, { error: 'id tidak dikenal' });
        if (req.method === 'GET') {
          const truth = readTruth(paths, id);
          const prefill = truth ? null : prefillFor(paths, id, opts);
          return send(res, 200, { entry, truth, prefill, prefill_arm: prefill ? opts.prefillArm : null });
        }
        if (req.method === 'PUT') {
          const body = (await readBody(req)) as { truth: unknown; unchecked: number; prefill_arm: string | null };
          const parsed = TruthSchema.safeParse({ ...(body.truth as object), id, kind: entry.kind, images: entry.images, split: entry.split });
          if (!parsed.success) return send(res, 422, { error: 'tidak valid', issues: parsed.error.issues.slice(0, 20) });
          const prefill = body.prefill_arm ? prefillFor(paths, id, { ...opts, prefillArm: body.prefill_arm }) : null;
          let changed: number | undefined;
          if (prefill) {
            const a = flatFields(prefill);
            const b = flatFields(parsed.data.expected ?? undefined);
            changed = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).length;
          }
          const saved = writeTruth(paths, {
            ...parsed.data,
            verified: {
              by: 'owner',
              at: new Date().toISOString().slice(0, 10),
              prefill: prefill ? body.prefill_arm : null,
              ...(changed != null ? { prefill_changed_fields: changed } : {}),
              unchecked_fields: Math.max(0, Math.floor(body.unchecked ?? 0)),
            },
          });
          entry.store_category = saved.store_category;
          writeManifest(paths, m);
          return send(res, 200, { ok: true, verified: saved.verified });
        }
      }
      return send(res, 404, { error: 'tidak ada' });
    } catch (e) {
      return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
}

export function startAnnotate(paths: EvalPaths, opts: AnnotateOptions, port = ANNOTATE_PORT): Promise<Server> {
  const server = createAnnotateServer(paths, opts);
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
