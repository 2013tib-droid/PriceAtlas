'use client';
// Koreksi baris struk (W7 correct_receipt_line, docs/05 §4.3): jumlah, total baris, tambah diskon.
// Dipakai S-10 mode tersimpan (F-52) dan S-16 untuk record struk ("Ubah baris struk", USE_RECEIPT_LINE).
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RECEIPT_COPY as C } from '@/lib/copy/id';

/** Bagian baris yang dibutuhkan editor (R15 ReceiptLine atau R20 receipt_line). */
export interface EditableLine {
  id: string;
  raw_text: string | null;
  quantity: number | null;
  line_amount: number;
  updated_at: string;
}

/** Koreksi baris struk di mode tersimpan (W7 correct_receipt_line, docs/05 §4.3). */
export function LineEditDialog({
  line,
  onClose,
  pending,
  error,
  onSave,
}: {
  line: EditableLine | null;
  onClose: () => void;
  pending: boolean;
  error: string | null;
  onSave: (patch: { quantity?: number; line_amount?: number; add_discount?: { line_amount: number } }) => void;
}) {
  return (
    <Dialog open={Boolean(line)} onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent>
        {line ? <LineEditForm line={line} onClose={onClose} pending={pending} error={error} onSave={onSave} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function LineEditForm({
  line,
  onClose,
  pending,
  error,
  onSave,
}: Omit<Parameters<typeof LineEditDialog>[0], 'line'> & { line: EditableLine }) {
  const [qty, setQty] = useState(line.quantity != null ? String(line.quantity) : '');
  const [amount, setAmount] = useState(String(line.line_amount));
  const [disc, setDisc] = useState('');
  const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch: { quantity?: number; line_amount?: number; add_discount?: { line_amount: number } } = {};
    if (qty && num(qty) > 0 && num(qty) !== line.quantity) patch.quantity = num(qty);
    if (amount && Number.isFinite(num(amount)) && num(amount) !== line.line_amount) patch.line_amount = num(amount);
    if (disc && num(disc) > 0) patch.add_discount = { line_amount: num(disc) };
    if (!Object.keys(patch).length) return onClose();
    onSave(patch);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogTitle>{C.editLineTitle}</DialogTitle>
      <DialogDescription className="font-mono">{line.raw_text}</DialogDescription>
      <div className="flex gap-2">
        <div className="flex w-24 flex-col gap-1">
          <Label htmlFor="baris-jumlah">{C.lineQty}</Label>
          <Input id="baris-jumlah" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="baris-total">{C.lineAmount}</Label>
          <Input id="baris-total" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="baris-diskon">{C.lineDiscount}</Label>
        <Input id="baris-diskon" inputMode="numeric" value={disc} onChange={(e) => setDisc(e.target.value)} />
      </div>
      <p className="text-sm text-muted-foreground">{C.lineDetailLater}</p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          {C.cancel}
        </Button>
        <Button type="submit" className="flex-1" disabled={pending}>
          {C.lineSave}
        </Button>
      </div>
    </form>
  );
}
