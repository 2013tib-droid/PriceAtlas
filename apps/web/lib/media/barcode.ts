'use client';
// Scan barcode (D-58, D-82, docs/07 §5.7): BarcodeDetector bawaan saja, tanpa polyfill di MVP.
import { useEffect, useState } from 'react';

/** GTIN + PLU/internal (§5.7). */
export const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] as const;

export interface DetectedBarcode {
  rawValue: string;
  format: string;
}
export interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: readonly string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

function ctor(): BarcodeDetectorCtor | null {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
    ? (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector
    : null;
}

/** Didukung jika BarcodeDetector ada DAN mendukung ean_13 (D-58). */
export async function isBarcodeSupported(): Promise<boolean> {
  const BD = ctor();
  if (!BD) return false;
  try {
    return (await BD.getSupportedFormats()).includes('ean_13');
  } catch {
    return false;
  }
}

export async function createBarcodeDetector(): Promise<BarcodeDetectorLike | null> {
  const BD = ctor();
  if (!BD) return null;
  const supported = await BD.getSupportedFormats().catch(() => [] as string[]);
  const formats = BARCODE_FORMATS.filter((f) => supported.includes(f));
  return formats.includes('ean_13') ? new BD({ formats }) : null;
}

/** false sampai terbukti didukung: ikon scan tidak pernah berkedip muncul lalu hilang. */
export function useBarcodeSupport(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    void isBarcodeSupported().then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, []);
  return ok;
}
