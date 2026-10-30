// Deklarasi tipe untuk form.js (JS murni supaya bisa dimuat langsung oleh browser alat anotasi).
export interface FieldDef {
  path?: string;
  key?: string;
  label: string;
  type: string;
}
export type Expected = Record<string, unknown> & { kind: string; lines?: Record<string, unknown>[]; items?: Record<string, unknown>[] };
export interface FormState {
  expected: Expected | null;
  checked: Set<string> | string[];
  annotations: { lines?: Record<string, Record<string, boolean>>; transcript_pii?: string[]; notes?: string | null };
  store_category: string;
  conditions: string[];
  unreadable?: boolean;
}
export const LINE_TYPES: string[];
export const PAYMENT_METHODS: string[];
export const HEADER_FIELDS: FieldDef[];
export const LINE_FIELDS: FieldDef[];
export const ITEM_FIELDS: FieldDef[];
export function blankExpected(kind: string): Expected;
export function blankLine(no: number): Record<string, unknown>;
export function blankItem(): Record<string, unknown>;
export function parseRupiah(raw: unknown): number | null;
export function parseValue(type: string, raw: unknown): unknown;
export function getPath(obj: unknown, path: string): unknown;
export function setPath<T extends object>(obj: T, path: string, value: unknown): T;
export function fieldPaths(expected: Expected | null): string[];
export function uncheckedPaths(expected: Expected | null, checked: Set<string> | string[]): string[];
export function invalidPaths(expected: Expected | null): string[];
export function addLine(expected: Expected): Expected;
export function removeLine(expected: Expected, i: number): Expected;
export function shiftChecked(checked: Iterable<string>, coll: 'lines' | 'items', i: number): Set<string>;
export function cleanAnnotations(ann: FormState['annotations']): { lines: Record<string, Record<string, boolean>>; transcript_pii: string[]; notes: string | null };
export function truthPayload(state: FormState): {
  expected: Expected | null;
  annotations: ReturnType<typeof cleanAnnotations>;
  store_category: string;
  conditions: string[];
  complete: boolean;
};
