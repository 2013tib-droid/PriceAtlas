// Google Cloud Vision `DOCUMENT_TEXT_DETECTION` (docs/08 §4.5, §5.6) lewat REST `images:annotate`
// dengan kunci API (GOOGLE_VISION_API_KEY). Satu request per gambar, paralel maks 4. Error vendor
// dipetakan dengan aturan yang sama dengan Claude: 429/5xx/jaringan → sementara; 400 gambar →
// `unsupported`; 401/403 → sementara + log konfigurasi. `fetch` disuntikkan supaya test tanpa jaringan.
import { log } from '../../log.ts';
import { PermanentError, TransientError, type PreparedImage } from '../../pipeline/types.ts';
import type { Box, OcrEngine, OcrPage } from '../ocr-parse.ts';

export const GCV_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
/** Harga daftar DOCUMENT_TEXT_DETECTION: US$1,50 per 1.000 unit (setelah 1.000 unit gratis/bulan). */
export const GCV_COST_PER_IMAGE_USD = 0.0015;
const PARALLEL = 4;

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface Vertex {
  x?: number;
  y?: number;
}
interface GcvWord {
  symbols?: { text?: string; property?: { detectedBreak?: { type?: string } } }[];
  boundingBox?: { vertices?: Vertex[] };
}
interface GcvResponse {
  fullTextAnnotation?: {
    text?: string;
    pages?: { width?: number; height?: number; blocks?: { paragraphs?: { words?: GcvWord[] }[] }[] }[];
  };
  error?: { code?: number; message?: string };
}

export class GoogleVisionOcr implements OcrEngine {
  readonly name = 'gcv';
  readonly costPerImageUsd = GCV_COST_PER_IMAGE_USD;

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: Fetch = fetch as unknown as Fetch,
  ) {
    if (!apiKey) throw new Error('GOOGLE_VISION_API_KEY wajib untuk OCR Google Cloud Vision');
  }

  async recognize(images: PreparedImage[], signal?: AbortSignal): Promise<OcrPage[]> {
    const out: OcrPage[] = new Array(images.length);
    for (let i = 0; i < images.length; i += PARALLEL) {
      const chunk = images.slice(i, i + PARALLEL);
      const pages = await Promise.all(chunk.map((img) => this.one(img, signal)));
      pages.forEach((p, j) => (out[i + j] = p));
    }
    return out;
  }

  private async one(img: PreparedImage, signal?: AbortSignal): Promise<OcrPage> {
    let res: Awaited<ReturnType<Fetch>>;
    try {
      res = await this.fetchFn(`${GCV_ENDPOINT}?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requests: [{ image: { content: img.data.toString('base64') }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['id', 'en'] } }],
        }),
        signal,
      });
    } catch {
      throw new TransientError('ocr: koneksi/timeout');
    }
    if (res.status === 429 || res.status >= 500) throw new TransientError(`ocr: server ${res.status}`);
    if (res.status === 400) throw new PermanentError('unsupported', 'Format gambar ini belum didukung.');
    if (!res.ok) {
      log('ai.config_error', { vendor: 'gcv', status: res.status });
      throw new TransientError('ocr: kesalahan konfigurasi');
    }
    const body = (await res.json()) as { responses?: GcvResponse[] };
    const r = body.responses?.[0] ?? {};
    if (r.error?.code) {
      // Error per gambar (mis. gambar rusak) dikembalikan dengan HTTP 200.
      if (r.error.code === 3) throw new PermanentError('unsupported', 'Format gambar ini belum didukung.');
      throw new TransientError(`ocr: error ${r.error.code}`);
    }
    return parseGcv(r, img);
  }
}

/** Respons GCV → teks + baris berkoordinat (kata digabung per baris sesuai `detectedBreak`). */
export function parseGcv(r: GcvResponse, img: Pick<PreparedImage, 'position' | 'width' | 'height'>): OcrPage {
  const fta = r.fullTextAnnotation;
  const lines: OcrPage['lines'] = [];
  for (const page of fta?.pages ?? []) {
    const W = page.width || img.width;
    const H = page.height || img.height;
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        let text = '';
        let verts: Vertex[] = [];
        const flush = () => {
          if (text.trim()) lines.push({ text: text.trim(), box: boxOf(verts, W, H) });
          text = '';
          verts = [];
        };
        for (const w of para.words ?? []) {
          verts.push(...(w.boundingBox?.vertices ?? []));
          for (const s of w.symbols ?? []) {
            text += s.text ?? '';
            const br = s.property?.detectedBreak?.type;
            if (br === 'SPACE' || br === 'SURE_SPACE') text += ' ';
            if (br === 'EOL_SURE_SPACE' || br === 'LINE_BREAK') flush();
          }
        }
        flush();
      }
    }
  }
  return { position: img.position, text: fta?.text ?? '', lines };
}

function boxOf(v: Vertex[], W: number, H: number): Box | null {
  if (!v.length || !W || !H) return null;
  const xs = v.map((p) => p.x ?? 0);
  const ys = v.map((p) => p.y ?? 0);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const c = (n: number) => Math.min(1, Math.max(0, n));
  return { x: c(x0 / W), y: c(y0 / H), w: c((Math.max(...xs) - x0) / W), h: c((Math.max(...ys) - y0) / H) };
}
