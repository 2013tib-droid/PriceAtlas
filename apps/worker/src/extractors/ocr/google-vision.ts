// Google Cloud Vision DOCUMENT_TEXT_DETECTION (docs/08 §4.5 arm `ocr-gcv+opus-low`, §5.6, Q-103).
// Satu request per gambar, paralel maks 4. Kunci API dibatasi ke Vision API (§15 no. 6); dikirim lewat
// header `x-goog-api-key`, tidak pernah di URL/log. Error: 429/5xx/jaringan → sementara; 400 gambar →
// unsupported; kunci/izin salah → sementara + log ai.config_error (sama dengan Claude, §5.4).
import { log } from '../../log.ts';
import { PermanentError, TransientError, type PreparedImage } from '../../pipeline/types.ts';
import type { Box, OcrEngine, OcrPage, OcrResult } from '../ocr-parse.ts';

export const GCV_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
/** Harga publik DOCUMENT_TEXT_DETECTION: US$1,50 per 1.000 gambar (1.000 pertama per bulan gratis, tidak dihitung). Dicek ulang sebelum uji (§12.2). */
export const GCV_PRICE_PER_IMAGE_USD = 0.0015;
export const GCV_PRICE_AS_OF = '2026-10-06';
const PARALLEL = 4;
const TIMEOUT_MS = 60_000;

type Vertex = { x?: number; y?: number };
type GcvSymbol = { text?: string; property?: { detectedBreak?: { type?: string } } };
type GcvWord = { symbols?: GcvSymbol[]; boundingBox?: { vertices?: Vertex[] } };
type GcvPage = { width?: number; height?: number; blocks?: { paragraphs?: { words?: GcvWord[] }[] }[] };
export interface GcvResponse {
  responses?: { fullTextAnnotation?: { text?: string; pages?: GcvPage[] }; error?: { code?: number; message?: string } }[];
  error?: { code?: number; message?: string };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Kata → baris memakai penanda jeda GCV (LINE_BREAK / EOL_SURE_SPACE), kotak baris = gabungan kotak kata. */
export function linesFromAnnotation(page: GcvPage | undefined, size: { width: number; height: number }): OcrPage['lines'] {
  const W = page?.width || size.width || 1;
  const H = page?.height || size.height || 1;
  const out: OcrPage['lines'] = [];
  let text = '';
  let xs: number[] = [];
  let ys: number[] = [];
  const flush = () => {
    const t = text.trim();
    if (t && xs.length) {
      const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
      const x0 = Math.max(0, Math.min(...xs) / W);
      const y0 = Math.max(0, Math.min(...ys) / H);
      const box: Box = { x: r4(x0), y: r4(y0), w: r4(Math.min(1, Math.max(...xs) / W) - x0), h: r4(Math.min(1, Math.max(...ys) / H) - y0) };
      out.push({ text: t, box });
    }
    text = '';
    xs = [];
    ys = [];
  };
  for (const block of page?.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const word of para.words ?? []) {
        for (const v of word.boundingBox?.vertices ?? []) {
          xs.push(v.x ?? 0);
          ys.push(v.y ?? 0);
        }
        for (const sym of word.symbols ?? []) {
          text += sym.text ?? '';
          const br = sym.property?.detectedBreak?.type;
          if (br === 'SPACE' || br === 'SURE_SPACE') text += ' ';
          if (br === 'EOL_SURE_SPACE' || br === 'LINE_BREAK') flush();
        }
      }
    }
  }
  flush();
  return out;
}

export class GoogleVisionOcr implements OcrEngine {
  readonly name = 'gcv';

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
  ) {
    if (!apiKey) throw new Error('GOOGLE_VISION_API_KEY wajib diisi untuk arm OCR (docs/08 §5.1)');
  }

  async recognize(images: PreparedImage[], signal?: AbortSignal): Promise<OcrResult> {
    const pages: OcrPage[] = new Array(images.length);
    let next = 0;
    const worker = async () => {
      while (next < images.length) {
        const i = next++;
        pages[i] = await this.one(images[i]!, signal);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, images.length) }, worker));
    return { pages, costUsd: Math.round(images.length * GCV_PRICE_PER_IMAGE_USD * 1e6) / 1e6 };
  }

  private async one(img: PreparedImage, signal?: AbortSignal): Promise<OcrPage> {
    const body = JSON.stringify({
      requests: [
        {
          image: { content: img.data.toString('base64') },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          imageContext: { languageHints: ['id', 'en'] },
        },
      ],
    });
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchFn(GCV_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      throw new TransientError('ocr: koneksi/timeout');
    }
    const json = (await res.json().catch(() => ({}))) as GcvResponse;
    const err = json.responses?.[0]?.error ?? json.error;
    const status = res.ok ? (err?.code ? httpFromGrpc(err.code) : 200) : res.status;
    if (status === 429 || status >= 500) throw new TransientError(`ocr: ${status}`);
    if (status === 400) throw new PermanentError('unsupported', 'Format gambar ini belum didukung.');
    if (status !== 200) {
      log('ai.config_error', { vendor: 'gcv', status });
      throw new TransientError('ocr: kesalahan konfigurasi');
    }
    const ann = json.responses?.[0]?.fullTextAnnotation;
    return {
      position: img.position,
      text: ann?.text ?? '',
      lines: linesFromAnnotation(ann?.pages?.[0], { width: img.width, height: img.height }),
    };
  }
}

/** Kode gRPC di body respons 200 (error per gambar) → status HTTP setara. */
function httpFromGrpc(code: number): number {
  if (code === 3) return 400; // INVALID_ARGUMENT
  if (code === 8) return 429; // RESOURCE_EXHAUSTED
  if (code === 7 || code === 16) return 403; // PERMISSION_DENIED, UNAUTHENTICATED
  if (code === 14 || code === 13 || code === 4) return 503; // UNAVAILABLE, INTERNAL, DEADLINE
  return 500;
}
