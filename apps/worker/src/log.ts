// Log worker: hanya id, status, dan durasi. Tidak pernah teks OCR, pii, atau gambar (§7.4).
type Fields = Record<string, string | number | boolean | null | undefined>;

let sink: (line: string) => void = (line) => process.stdout.write(line + '\n');

export function setLogSink(fn: (line: string) => void): void {
  sink = fn;
}

export function log(event: string, fields: Fields = {}): void {
  sink(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));
}
