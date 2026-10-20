// Pembaca metadata gambar kecil buatan sendiri (docs/07 §6.2): jenis file dari magic bytes, ukuran
// piksel dari header (tanpa decoding), dan hanya tag EXIF yang dipakai: Orientation,
// DateTimeOriginal (+ OffsetTimeOriginal), dan ada/tidaknya blok GPS. Tanpa dependensi.
// JPEG (APP1 Exif, SOFn), PNG (IHDR, eXIf), WebP (VP8/VP8L/VP8X, EXIF). HEIC hanya dikenali jenisnya.

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

export interface ImageMeta {
  /** Jenis dari magic bytes; null jika tidak dikenali. */
  sniffed: ImageMime | null;
  width: number | null;
  height: number | null;
  orientation: number | null;
  /** "2026:10:12 14:05:33" (waktu lokal kamera, tanpa zona). */
  dateTimeOriginal: string | null;
  /** "+07:00" jika kamera menulisnya. */
  offsetTimeOriginal: string | null;
  hasGps: boolean;
}

interface Exif {
  orientation: number | null;
  dateTimeOriginal: string | null;
  offsetTimeOriginal: string | null;
  hasGps: boolean;
}

const EMPTY_EXIF: Exif = { orientation: null, dateTimeOriginal: null, offsetTimeOriginal: null, hasGps: false };

function ascii(b: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

export function sniffMime(b: Uint8Array): ImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a) return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (
    b.length >= 12 &&
    ascii(b, 4, 4) === 'ftyp' &&
    /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1|heif)$/.test(ascii(b, 8, 4))
  )
    return 'image/heic';
  return null;
}

/** Struktur TIFF (isi blok EXIF). Offset relatif terhadap awal TIFF. */
export function parseTiff(b: Uint8Array, start: number, end = b.length): Exif {
  const out: Exif = { ...EMPTY_EXIF };
  if (end - start < 8) return out;
  const order = ascii(b, start, 2);
  if (order !== 'II' && order !== 'MM') return out;
  const le = order === 'II';
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o: number) => (o + 2 <= end ? dv.getUint16(o, le) : 0);
  const u32 = (o: number) => (o + 4 <= end ? dv.getUint32(o, le) : 0);
  if (u16(start + 2) !== 42) return out;

  const readAscii = (entry: number): string | null => {
    const count = u32(entry + 4);
    const at = count <= 4 ? entry + 8 : start + u32(entry + 8);
    if (count === 0 || at + count > end) return null;
    return ascii(b, at, count).replace(/\0+$/, '').trim() || null;
  };
  const walk = (ifd: number, visit: (tag: number, entry: number) => void) => {
    const base = start + ifd;
    if (ifd === 0 || base + 2 > end) return;
    const n = Math.min(u16(base), 512);
    for (let i = 0; i < n; i++) {
      const e = base + 2 + i * 12;
      if (e + 12 > end) return;
      visit(u16(e), e);
    }
  };

  let exifIfd = 0;
  walk(u32(start + 4), (tag, e) => {
    if (tag === 0x0112) out.orientation = u16(e + 8) || null;
    else if (tag === 0x8769) exifIfd = u32(e + 8);
    else if (tag === 0x8825 && u32(e + 8) > 0) out.hasGps = true;
  });
  walk(exifIfd, (tag, e) => {
    if (tag === 0x9003) out.dateTimeOriginal = readAscii(e);
    else if (tag === 0x9011) out.offsetTimeOriginal = readAscii(e);
  });
  return out;
}

function exifPayload(b: Uint8Array, start: number, end: number): Exif {
  // Beberapa penulis (APP1, WebP EXIF) mendahului TIFF dengan "Exif\0\0".
  const off = ascii(b, start, 6) === 'Exif\0\0' ? 6 : 0;
  return parseTiff(b, start + off, end);
}

function parseJpeg(b: Uint8Array, meta: ImageMeta) {
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return;
    const marker = b[p + 1]!;
    if (marker === 0xff) {
      p++;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return; // EOI / SOS: header selesai
    const len = (b[p + 2]! << 8) | b[p + 3]!;
    if (len < 2) return;
    const data = p + 4;
    const end = Math.min(p + 2 + len, b.length);
    if (marker === 0xe1 && ascii(b, data, 6) === 'Exif\0\0') Object.assign(meta, exifPayload(b, data, end));
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && data + 5 <= b.length && meta.width === null) {
      meta.height = (b[data + 1]! << 8) | b[data + 2]!;
      meta.width = (b[data + 3]! << 8) | b[data + 4]!;
    }
    p += 2 + len;
  }
}

function parsePng(b: Uint8Array, meta: ImageMeta) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8;
  while (p + 8 <= b.length) {
    const len = dv.getUint32(p);
    const type = ascii(b, p + 4, 4);
    const data = p + 8;
    if (type === 'IHDR' && data + 8 <= b.length) {
      meta.width = dv.getUint32(data);
      meta.height = dv.getUint32(data + 4);
    } else if (type === 'eXIf') {
      Object.assign(meta, exifPayload(b, data, Math.min(data + len, b.length)));
    } else if (type === 'IEND') return;
    p = data + len + 4; // + CRC
  }
}

function parseWebp(b: Uint8Array, meta: ImageMeta) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 12;
  while (p + 8 <= b.length) {
    const type = ascii(b, p, 4);
    const len = dv.getUint32(p + 4, true);
    const d = p + 8;
    if (type === 'VP8X' && d + 10 <= b.length) {
      meta.width = 1 + (b[d + 4]! | (b[d + 5]! << 8) | (b[d + 6]! << 16));
      meta.height = 1 + (b[d + 7]! | (b[d + 8]! << 8) | (b[d + 9]! << 16));
    } else if (type === 'VP8 ' && d + 10 <= b.length && meta.width === null) {
      meta.width = dv.getUint16(d + 6, true) & 0x3fff;
      meta.height = dv.getUint16(d + 8, true) & 0x3fff;
    } else if (type === 'VP8L' && d + 5 <= b.length && meta.width === null && b[d] === 0x2f) {
      const bits = dv.getUint32(d + 1, true);
      meta.width = (bits & 0x3fff) + 1;
      meta.height = ((bits >> 14) & 0x3fff) + 1;
    } else if (type === 'EXIF') {
      Object.assign(meta, exifPayload(b, d, Math.min(d + len, b.length)));
    }
    p = d + len + (len % 2);
  }
}

/** Metadata dari byte file. Tidak pernah melempar: bagian yang rusak dibiarkan null. */
export function readImageMeta(bytes: Uint8Array): ImageMeta {
  const meta: ImageMeta = { sniffed: sniffMime(bytes), width: null, height: null, ...EMPTY_EXIF };
  try {
    if (meta.sniffed === 'image/jpeg') parseJpeg(bytes, meta);
    else if (meta.sniffed === 'image/png') parsePng(bytes, meta);
    else if (meta.sniffed === 'image/webp') parseWebp(bytes, meta);
  } catch {
    // Header rusak: perlakukan seperti tidak terbaca (aturan lewati tidak berlaku).
  }
  return meta;
}

/**
 * `p_captured_at` dari EXIF (§6.2): "2026:10:12 14:05:33" + offset opsional → ISO dengan offset.
 * Tanpa OffsetTimeOriginal, waktu dianggap zona perangkat (kamera memakai jam HP).
 */
export function exifDateToIso(dt: string | null, offset: string | null): string | null {
  const m = dt ? /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(dt) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (y === '0000') return null;
  const local = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) return `${local}${offset}`;
  const asDate = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (Number.isNaN(asDate.getTime())) return null;
  return toIsoWithOffset(asDate);
}

/** ISO 8601 dengan offset zona perangkat, mis. 2026-10-12T14:05:33+07:00. */
export function toIsoWithOffset(d: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`
  );
}
