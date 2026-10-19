// Redaksi PII teks OCR mentah (§7.4). STUB regex di Tahap 4: digit kartu, nomor HP
// Indonesia, email, dan nilai receipt.pii hasil parsing. Redaksi berbasis AI di Tahap 6.
export const REDACTED = '[REDAKSI]';

const PATTERNS: RegExp[] = [
  // HP Indonesia: 08…, 628…, +628… (sebelum pola kartu, supaya "+62…" tersamar utuh).
  /(?:\+62|\b62|\b0)8\d(?:[ -]?\d){6,11}\b/g,
  // Nomor kartu 13–19 digit, boleh dipisah spasi/strip; juga bentuk tersamar "**** 1234".
  /\b(?:\d[ -]?){12,18}\d\b/g,
  /(?:[*xX#]{4}[ -]?){1,3}\d{4}\b/g,
  // Email
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
];

export function redactText(text: string, piiValues: string[] = []): string {
  let out = text;
  for (const v of piiValues.filter((x) => x.trim().length >= 4).sort((a, b) => b.length - a.length)) {
    out = out.split(v).join(REDACTED);
  }
  for (const re of PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

/** Redaksi semua string di dalam JSON; objek `pii` dikosongkan. */
export function redactJson(value: unknown, piiValues: string[] = []): unknown {
  if (typeof value === 'string') return redactText(value, piiValues);
  if (Array.isArray(value)) return value.map((v) => redactJson(v, piiValues));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, k === 'pii' ? {} : redactJson(v, piiValues)]),
    );
  }
  return value;
}

export function piiStrings(pii: unknown): string[] {
  if (!pii || typeof pii !== 'object') return [];
  return Object.values(pii as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
}
