// Antarmuka pipeline (docs/05 §5.4). Tidak bergantung pada runtime atau I/O tertentu:
// adapter database/penyimpanan dan extractor disuntikkan, sehingga pindah ke runtime
// lain (mis. Edge Function) cukup mengganti adapter.
import type { CaptureKind, Extraction } from '@priceatlas/contracts';

export type { CaptureKind, Extraction };

/** Turunan bersih untuk model (docs/08 §6): tanpa metadata, orientasi diterapkan, ≤ 2576 px. */
export interface PreparedImage {
  position: number;
  data: Buffer;
  mediaType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  sourceType: 'jpeg' | 'png' | 'webp' | 'heic';
}

export interface ImageBlob {
  position: number;
  storagePath: string;
  /** sha256 byte asli di bucket (stub memetakan fixture lewat nilai ini). */
  sha256: string;
  data: Buffer;
  /** Diisi pipeline lewat prepareImages (§6) untuk semua engine. Extractor AI hanya memakai ini. */
  prepared?: PreparedImage;
}

export interface ExtractContext {
  captureId: string;
  householdId: string;
  attempt: number;
  uploadedAt: Date;
  capturedAt: Date | null;
  /** Tenggat panggilan AI (F-107): lease − 30 dtk dari waktu claim. Aborted = waktu habis. */
  signal?: AbortSignal;
  deadlineAt?: Date;
}

/**
 * D-16 belum diputuskan. Dua implementasi Tahap 6 sama-sama memenuhi antarmuka ini:
 * VisionExtractor (Claude vision langsung) atau OcrThenParseExtractor (OCR khusus + Claude).
 * Tahap 4: StubExtractor (fixture per hash gambar).
 */
export interface CaptureExtractor {
  readonly engine: string;
  readonly model: string | null;
  readonly promptVersion: string;
  extract(input: { kind: CaptureKind; images: ImageBlob[]; ctx: ExtractContext }): Promise<Extraction>;
}

export interface UnmatchedItem {
  key: number;
  /** Nama produk dari model (struk: teks baris; label/screenshot: nama produk, Q-133). */
  raw_text: string;
  barcode?: string | null;
  /** Judul listing screenshot (cadangan matching, Q-133). */
  title?: string | null;
  /** Nominal yang terbaca: jumlah baris struk, atau harga (promo/normal) label/screenshot (F-112). */
  amount?: number | null;
  quantity?: number | null;
}

export interface MatchContext {
  householdId: string;
  storeId: string | null;
  /** Nama toko (katalog, atau yang terbaca jika toko belum dikenal) untuk konteks tier 4 (F-112). */
  storeName?: string | null;
  kind: CaptureKind;
  imageSha256s: string[];
  /** Tenggat lease yang sama dengan ekstraksi (F-107). */
  signal?: AbortSignal;
  /** Biaya panggilan tier 4, dijumlahkan pipeline ke processing_run (anggaran harian §12.3). */
  onUsage?: (usage: NonNullable<Extraction['usage']>) => void;
}

export interface MatchSuggestion {
  key: number;
  product_id: string;
  confidence: number;
}

/** Tier 4 (§5.9): hanya untuk item tanpa kandidat dari tier 1–3 (kontrol biaya). */
export interface AiMatcher {
  match(items: UnmatchedItem[], ctx: MatchContext): Promise<MatchSuggestion[]>;
}

export interface BlobStore {
  get(path: string): Promise<Buffer>;
  /** Idempoten: path yang sudah tidak ada tidak membuat error. */
  delete(paths: string[]): Promise<void>;
  /** Semua path (rekursif) di bawah prefix, mis. "{household_id}/". */
  list(prefix: string): Promise<string[]>;
}

export type PermanentCode = 'blurry' | 'not_a_receipt' | 'unsupported' | 'timeout' | 'other';

/**
 * Data mentah dari panggilan AI yang gagal setelah respons diterima (refusal, max_tokens, output
 * tidak valid). Pipeline tetap menyimpannya ke processing_run (audit, biaya) sebelum fail_run.
 */
export interface RunOutput {
  rawText?: string | null;
  rawOutput: unknown;
  usage?: Extraction['usage'];
}

/** Timeout, 5xx, rate limit: dicoba lagi otomatis dengan backoff (§5.3). */
export class TransientError extends Error {
  constructor(
    message: string,
    readonly runOutput?: RunOutput,
  ) {
    super(message);
    this.name = 'TransientError';
  }
}

/** Bukan struk, gambar tidak terbaca, format tidak didukung: langsung failed. */
export class PermanentError extends Error {
  constructor(
    readonly code: PermanentCode,
    message: string,
    readonly runOutput?: RunOutput,
  ) {
    super(message);
    this.name = 'PermanentError';
  }
}
