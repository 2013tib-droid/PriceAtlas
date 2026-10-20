// capture_id dibuat di klien (D-59). crypto.randomUUID hanya ada di secure context (P-10):
// cadangan UUID v4 dari crypto.getRandomValues (tersedia di semua konteks).
export function newCaptureId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // Konteks tidak aman di beberapa browser: lempar, bukan undefined.
    }
  }
  return uuidV4FromRandom((b) => c.getRandomValues(b));
}

export function uuidV4FromRandom(fill: (b: Uint8Array) => void): string {
  const b = new Uint8Array(16);
  fill(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
