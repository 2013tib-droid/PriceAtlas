// Server alat anotasi lokal (docs/08 §4.2 langkah 3): http://localhost:4317 — gambar di kiri, form di
// kanan. HANYA mendengarkan 127.0.0.1 dan menolak Host selain localhost (DNS rebinding). Membaca/menulis
// folder data (truth/<id>.json); gambar dikirim sebagai turunan JPEG bersih (prepareImage: HEIC → JPEG,
// orientasi EXIF, metadata dibuang), sehingga HEIC juga tampil di browser non-Safari.
// Pra-isi (--prefill <arm>): output model arm itu (catatan run terakhir yang berhasil) tanpa confidence.
// N struk pertama (default 5) TANPA pra-isi untuk mengukur bias anotator (§4.2).
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { prepareImage } from '../../src/images/prepare.ts';
import {
  TruthSchema,
  readManifest,
  readTruth,
  stripConfidence,
  truthPath,
  writeJson,
  type ManifestEntry,
  type Truth,
} from '../data.ts';
import { readRecords, type RunRecord } from '../run.ts';

export const ANNOTATE_PORT = 4317;
export const BLIND_RECEIPTS = 5;

export interface AnnotateOptions {
  dir: string;
  prefillArm?: string | null;
  blind?: number;
  by?: string;
  now?: () => Date;
}

/** Id struk yang dianotasi tanpa pra-isi: N struk pertama di manifest (§4.2). */
export function blindIds(entries: ManifestEntry[], n = BLIND_RECEIPTS): Set<string> {
  return new Set(entries.filter((e) => e.kind === 'receipt').slice(0, n).map((e) => e.id));
}

/** Catatan run terbaru yang berhasil untuk (arm, id). */
export function latestOk(records: RunRecord[], arm: string, id: string): RunRecord | null {
  return records.filter((r) => r.arm === arm && r.id === id && r.ok && r.output).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : (body as Buffer | string));
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 5_000_000) throw new Error('body terlalu besar');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createAnnotateServer(opts: AnnotateOptions): Server {
  const html = readFileSync(join(import.meta.dirname, 'index.html'));
  const formJs = readFileSync(join(import.meta.dirname, 'form.js'));
  const now = opts.now ?? (() => new Date());

  return createServer((req, res) => {
    void (async () => {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return send(res, 403, { error: 'host' });
      const url = new URL(req.url ?? '/', 'http://localhost');
      const manifest = readManifest(opts.dir);
      const blind = blindIds(manifest.captures, opts.blind ?? BLIND_RECEIPTS);
      const entry = (id: string) => manifest.captures.find((c) => c.id === id);

      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, html, 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/form.js') return send(res, 200, formJs, 'text/javascript; charset=utf-8');

      if (req.method === 'GET' && url.pathname === '/api/captures') {
        const records = opts.prefillArm ? readRecords(opts.dir) : [];
        return send(res, 200, {
          prefill_arm: opts.prefillArm ?? null,
          captures: manifest.captures.map((c) => {
            const t = readTruth(opts.dir, c.id);
            return {
              id: c.id, kind: c.kind, split: c.split, store_category: c.store_category, images: c.images.length,
              status: t?.verified ? 'verified' : t ? 'draft' : 'new',
              blind: blind.has(c.id),
              prefill: !blind.has(c.id) && !!opts.prefillArm && !!latestOk(records, opts.prefillArm, c.id),
            };
          }),
        });
      }

      const cap = url.pathname.match(/^\/api\/capture\/([a-z0-9-]+)$/);
      if (req.method === 'GET' && cap) {
        const e = entry(cap[1]!);
        if (!e) return send(res, 404, { error: 'not_found' });
        const truth = readTruth(opts.dir, e.id);
        let prefill: unknown = null;
        let prefillPii: string[] = [];
        if (!truth && opts.prefillArm && !blind.has(e.id)) {
          const r = latestOk(readRecords(opts.dir), opts.prefillArm, e.id);
          if (r?.output) {
            prefill = stripConfidence(r.output);
            prefillPii = r.output.kind === 'receipt' ? Object.values(r.output.pii ?? {}) : [];
          }
        }
        return send(res, 200, { entry: e, truth, prefill, prefill_pii: prefillPii, prefill_arm: prefill ? opts.prefillArm : null, blind: blind.has(e.id) });
      }

      const img = url.pathname.match(/^\/images\/([a-z0-9.-]+)$/);
      if (req.method === 'GET' && img) {
        const file = img[1]!;
        if (!manifest.captures.some((c) => c.images.includes(file))) return send(res, 404, { error: 'not_found' });
        try {
          const p = await prepareImage(readFileSync(join(opts.dir, 'images', file)));
          return send(res, 200, p.data, p.mediaType);
        } catch {
          return send(res, 422, { error: 'undecodable' });
        }
      }

      const put = url.pathname.match(/^\/api\/truth\/([a-z0-9-]+)$/);
      if (req.method === 'PUT' && put) {
        const e = entry(put[1]!);
        if (!e) return send(res, 404, { error: 'not_found' });
        const b = (await body(req)) as {
          expected: unknown; annotations: unknown; store_category?: string; conditions?: string[]; complete?: boolean; prefill_arm?: string | null;
        };
        const candidate = {
          id: e.id, kind: e.kind, images: e.images, split: e.split,
          store_category: b.store_category ?? e.store_category,
          conditions: b.conditions ?? e.conditions,
          expected: b.expected,
          annotations: b.annotations,
          verified: b.complete ? { by: opts.by ?? 'owner', at: now().toISOString().slice(0, 10), prefill: b.prefill_arm ?? null } : null,
        };
        const parsed = TruthSchema.safeParse(candidate);
        if (!parsed.success) {
          return send(res, 400, { error: 'invalid', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
        }
        if (parsed.data.expected && parsed.data.expected.kind !== e.kind) return send(res, 400, { error: 'kind_mismatch' });
        writeJson(truthPath(opts.dir, e.id), parsed.data satisfies Truth);
        // Kategori/kondisi juga diperbarui di manifest (untuk laporan per kategori).
        e.store_category = parsed.data.store_category;
        e.conditions = parsed.data.conditions;
        writeJson(join(opts.dir, 'manifest.json'), manifest);
        return send(res, 200, { ok: true, verified: parsed.data.verified !== null });
      }
      return send(res, 404, { error: 'not_found' });
    })().catch((e: unknown) => send(res, 500, { error: e instanceof Error ? e.message : 'error' }));
  });
}

export function listen(server: Server, port = ANNOTATE_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
  });
}
