// Pembuat byte gambar untuk test (L5a, L5c): blok EXIF TIFF kecil, JPEG header-only, PNG/WebP header.
// Dipakai juga di browser (L5c) untuk menyisipkan EXIF GPS ke JPEG sungguhan dari kanvas.

export interface ExifSpec {
  orientation?: number;
  date?: string;
  offset?: string;
  gps?: boolean;
  bigEndian?: boolean;
}

/** TIFF: IFD0 (Orientation, ExifIFD, GPS) → ExifIFD (DateTimeOriginal, OffsetTimeOriginal) → GPS IFD. */
export function tiff(spec: ExifSpec): Uint8Array {
  const le = !spec.bigEndian;
  const buf = new Uint8Array(512);
  const dv = new DataView(buf.buffer);
  const u16 = (o: number, v: number) => dv.setUint16(o, v, le);
  const u32 = (o: number, v: number) => dv.setUint32(o, v, le);
  buf.set(le ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  u16(2, 42);
  u32(4, 8);
  const ifd0: [number, number, number, number][] = []; // tag, type, count, value
  if (spec.orientation) ifd0.push([0x0112, 3, 1, spec.orientation]);
  const exifEntries = [spec.date ? 1 : 0, spec.offset ? 1 : 0].reduce((a, b) => a + b, 0);
  const ifd0Size = 2 + (ifd0.length + 2) * 12 + 4;
  const exifAt = 8 + ifd0Size;
  const exifSize = 2 + exifEntries * 12 + 4;
  const gpsAt = exifAt + exifSize;
  const gpsSize = 2 + 12 + 4;
  let dataAt = gpsAt + gpsSize;
  ifd0.push([0x8769, 4, 1, exifAt]);
  if (spec.gps) ifd0.push([0x8825, 4, 1, gpsAt]);
  const writeIfd = (at: number, entries: [number, number, number, number][]) => {
    u16(at, entries.length);
    entries.forEach(([tag, type, count, value], i) => {
      const e = at + 2 + i * 12;
      u16(e, tag);
      u16(e + 2, type);
      u32(e + 4, count);
      if (type === 3) u16(e + 8, value);
      else u32(e + 8, value);
    });
    u32(at + 2 + entries.length * 12, 0);
  };
  const ascii = (s: string) => {
    const at = dataAt;
    for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i);
    buf[at + s.length] = 0;
    dataAt += s.length + 1;
    return at;
  };
  writeIfd(8, ifd0);
  const ex: [number, number, number, number][] = [];
  if (spec.date) ex.push([0x9003, 2, spec.date.length + 1, ascii(spec.date)]);
  if (spec.offset) ex.push([0x9011, 2, spec.offset.length + 1, ascii(spec.offset)]);
  writeIfd(exifAt, ex);
  // GPS IFD: satu tag GPSVersionID.
  writeIfd(gpsAt, [[0x0000, 1, 4, 0x02020000]]);
  return buf.slice(0, dataAt);
}

function app1(spec: ExifSpec): Uint8Array {
  const t = tiff(spec);
  const len = 2 + 6 + t.length;
  const seg = new Uint8Array(2 + len);
  seg.set([0xff, 0xe1, len >> 8, len & 0xff], 0);
  seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  seg.set(t, 10);
  return seg;
}

/** JPEG header saja (SOI, APP1 Exif, SOF0, SOS, EOI). Tidak bisa didekode; untuk parser. */
export function jpegWithExif(spec: ExifSpec & { width: number; height: number }): Uint8Array {
  const sof = new Uint8Array([
    0xff,
    0xc0,
    0,
    11,
    8,
    spec.height >> 8,
    spec.height & 0xff,
    spec.width >> 8,
    spec.width & 0xff,
    1,
    1,
    0x11,
    0,
  ]);
  const parts = [new Uint8Array([0xff, 0xd8]), app1(spec), sof, new Uint8Array([0xff, 0xda, 0, 2, 0xff, 0xd9])];
  return concat(parts);
}

/** Sisipkan APP1 Exif tepat setelah SOI dari JPEG sungguhan (L5c: foto ber-GPS). */
export function insertExif(jpeg: Uint8Array, spec: ExifSpec): Uint8Array {
  return concat([jpeg.slice(0, 2), app1(spec), jpeg.slice(2)]);
}

export function pngBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(8 + 25);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dv = new DataView(b.buffer);
  dv.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  return b;
}

export function webpVp8x(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  const s = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  const dv = new DataView(b.buffer);
  s(0, 'RIFF');
  dv.setUint32(4, 22, true);
  s(8, 'WEBP');
  s(12, 'VP8X');
  dv.setUint32(16, 10, true);
  const w = width - 1;
  const h = height - 1;
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
