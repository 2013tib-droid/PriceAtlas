// Program member (S-00c, S-19b; docs/07 §7.3, wireframe S-19b, D-10/D-27/D-41): daftar R21 per toko,
// aturan toggle program dihentikan, ringkasan di S-19, dan pilihan onboarding. Logika tanpa React
// supaya diuji unit (L5a).
import type { MyProgram } from '@priceatlas/contracts';
import { fill, SETTINGS_COPY as C } from '@/lib/copy/id';

export type ProgramGroup = { storeId: string; storeName: string; programs: MyProgram[] };

/** R21 sudah urut toko lalu nama; dikelompokkan per toko tanpa mengubah urutan. */
export function groupByStore(programs: readonly MyProgram[]): ProgramGroup[] {
  const out: ProgramGroup[] = [];
  for (const p of programs) {
    const last = out[out.length - 1];
    if (last && last.storeId === p.store.id) last.programs.push(p);
    else out.push({ storeId: p.store.id, storeName: p.store.name, programs: [p] });
  }
  return out;
}

/**
 * Program dihentikan: tidak bisa DITANDAI (W16 → INVALID_STATE), tetapi keanggotaan lama boleh
 * dilepas (W16 `p_member = false` tetap diterima), supaya user tidak terkunci.
 */
export function canToggle(p: Pick<MyProgram, 'status' | 'is_member'>): boolean {
  return p.status === 'active' || p.is_member;
}

/** Baris S-19 "Program member": "1 diikuti: AEON Member" / "Belum ada" (wireframe S-19). */
export function memberSummary(programs: readonly MyProgram[] | undefined): string {
  const mine = (programs ?? []).filter((p) => p.is_member);
  if (!mine.length) return C.me.memberNone;
  const names = mine.map((p) => p.program_name);
  const shown = names.slice(0, 2).join(', ') + (names.length > 2 ? fill(C.me.memberMore, { n: names.length - 2 }) : '');
  return fill(C.me.memberCount, { n: mine.length, names: shown });
}

/** S-00c: pilihan lokal sebelum "Simpan & lanjut". Program dihentikan tidak bisa dipilih. */
export function toggleSelection(
  selected: ReadonlySet<string>,
  p: Pick<MyProgram, 'program_id' | 'status'>,
): Set<string> {
  const next = new Set(selected);
  if (next.has(p.program_id)) next.delete(p.program_id);
  else if (p.status === 'active') next.add(p.program_id);
  return next;
}

/** Program yang perlu W16 `p_member = true` (yang sudah member dilewati; W16 juga idempoten). */
export function programsToJoin(selected: ReadonlySet<string>, programs: readonly MyProgram[]): string[] {
  return programs.filter((p) => selected.has(p.program_id) && !p.is_member).map((p) => p.program_id);
}

/** Pilihan awal S-00c = keanggotaan yang sudah ada (mis. kembali ke layar ini). */
export function initialSelection(programs: readonly MyProgram[] | undefined): Set<string> {
  return new Set((programs ?? []).filter((p) => p.is_member).map((p) => p.program_id));
}
