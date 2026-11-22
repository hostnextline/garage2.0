/* « Ajouter une dépense » / « Modifier la dépense »: the receipt photo first (it is read for you: vendor, date,
   amounts), then the amounts with Québec taxes worked out from the total (or from the price before taxes), then the
   rest. Everything the reader proposes stays editable, and what the person typed is never overwritten by it.
   The rules of the amounts and of the reader's proposals are in expenseDraft.ts; sending the photo in receipts.ts. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Trash } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { QC_TAXES, type TaxRates } from '../../lib/money';
import { today } from '../../lib/dates';
import { saveExpense, errorMessage } from '../../data/api';
import { settings, trucks, truckLabel, expensesList } from '../../data/select';
import { net, uuid } from '../../data/sync';
import type { Expense } from '../../data/types';
import { Sheet, Form, Field, Input, Textarea, Select, Chips, DateInput, Button, toast, attempt, run } from '../../ui';
import { removeExpense, keepAfterSave } from '../../domain/money/expenses';
import { shrinkPhoto } from '../../shared/export/ocr';
import { parseReceipt, guessCategory } from './receipt';
import { freshDraft, typedAmount, withTaxed, checkDraft, applyReceipt, draftAmounts, type AmountField, type Draft, type DraftError, type ReadField } from './expenseDraft';
import { categories, EXPENSE_METHODS, methodLabel } from './select';
import { receiptImage, receiptQueue, rememberReceipt, startReceiptQueue, type ReceiptPhoto } from './receipts';
import { useReceiptReading } from './useReceiptReading';
import { ReceiptCapture } from './ReceiptCapture';
import { AmountFields } from './AmountFields';
import { ReceiptViewer } from './ReceiptViewer';

export function ExpenseSheet(p: { open: boolean; onClose: () => void; expense?: Expense | null }) {
  if (!p.open) return null;
  return <ExpenseForm key={p.expense?.id || 'new'} {...p} />;
}

const READ_WORDS = { read: { kind: 'ok', text: 'treasury.form.read' }, partial: { kind: 'info', text: 'treasury.form.partial' }, nothing: { kind: 'warn', text: 'treasury.form.nothing' } } as const;

function ExpenseForm(p: { open: boolean; onClose: () => void; expense?: Expense | null }) {
  const l = lang.value;
  const editing = !!p.expense;
  const taxes = settings.value.taxes;
  // the split always uses the rates; whether a new expense starts taxed follows the garage's settings
  const rates: TaxRates = { ...QC_TAXES, tps: taxes?.tps ?? QC_TAXES.tps, tvq: taxes?.tvq ?? QC_TAXES.tvq, enabled: true };
  const taxedByDefault = taxes?.enabled !== false;
  // made once: a second « Enregistrer » (or a retry) changes this same expense, never makes a second one
  const [expenseId] = useState(() => p.expense?.id || uuid());
  const [waiting, setWaiting] = useState(() => (p.expense ? receiptQueue.waitingFor(p.expense.id) : null));
  const [d, setDraft] = useState<Draft>(() => freshDraft(p.expense, today(), taxedByDefault));
  const dRef = useRef(d);
  const setD = (n: Draft) => { dRef.current = n; setDraft(n); };
  const [errors, setErrors] = useState<Partial<Record<DraftError, string>>>({});
  const clearErrors = (...keys: DraftError[]) => setErrors((x) => { const n = { ...x }; for (const k of keys) delete n[k]; return n; });
  // what the person typed (the reader never overwrites it), and what the reader filled (« Lu sur le reçu »)
  const typed = useRef(new Set<ReadField>());
  const [fromReceipt, setFromReceipt] = useState<Set<ReadField>>(new Set());
  const touch = (k: ReadField) => { typed.current.add(k); setFromReceipt((s) => { if (!s.has(k)) return s; const n = new Set(s); n.delete(k); return n; }); };
  const [photo, setPhoto] = useState<ReceiptPhoto | null>(null);
  const [shown, setShown] = useState<string | null>(() => waiting?.dataUrl ?? null);
  const [thumb, setThumb] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [viewer, setViewer] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  // the photo was changed or taken off in this sheet (else a change of this expense leaves its receipt_id alone:
  // a photo that waited may have been linked to it by the queue meanwhile)
  const photoTouched = useRef(false);

  const history = useMemo(() => expensesList.value.map((e) => ({ vendor: e.vendor, category: e.category })), [expensesList.value]);
  const vendors = useMemo(() => [...new Set(expensesList.value.map((e) => (e.vendor || '').trim()).filter(Boolean))].slice(0, 40), [expensesList.value]);
  const cats = categories.value.includes(d.category) || !d.category ? categories.value : [...categories.value, d.category];

  const reader = useReceiptReading((text) => {
    const r = applyReceipt(dRef.current, parseReceipt(text, today(), rates), typed.current, { categories: categories.value, history, rates, taxedByDefault });
    setD(r.draft);
    setFromReceipt(r.filled);
    setErrors({});
    reader.setMsg({ kind: READ_WORDS[r.message].kind, text: t(READ_WORDS[r.message].text) });
  });

  // photos left waiting by an earlier visit go now; an expense that already has a receipt: its picture
  useEffect(() => {
    startReceiptQueue();
    const id = p.expense?.receipt_id;
    if (!id || waiting) return;
    let alive = true;
    setThumb('loading');
    receiptImage(id).then((u) => { if (alive) { setShown(u); setThumb(u ? 'idle' : 'failed'); } }, () => { if (alive) setThumb('failed'); });
    return () => { alive = false; };
  }, []);

  async function onFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    reader.setMsg(null);
    let ph: ReceiptPhoto;
    try { ph = { ...(await shrinkPhoto(file)), id: uuid() }; } catch { reader.setMsg({ kind: 'warn', text: t('treasury.form.photoBad') }); return; }
    photoTouched.current = true;
    setPhoto(ph); setShown(ph.dataUrl); setThumb('idle');
    await reader.read(ph.dataUrl);
  }
  function dropPhoto() {
    reader.reset();
    photoTouched.current = true;
    setPhoto(null); setShown(null); setThumb('idle');
    setD({ ...dRef.current, receipt_id: null });
  }
  const onAmount = (field: AmountField, c: number | null) => {
    const n = typedAmount(dRef.current, field, c, rates);
    if (!n) return;
    touch('amounts');
    clearErrors(...(field === 'total' ? ['total', 'sum'] as DraftError[] : ['sum'] as DraftError[]));
    setD(n);
  };

  async function save() {
    if (saving.current) return;
    const cur = dRef.current;
    const errs = Object.fromEntries(Object.entries(checkDraft(cur, today())).map(([k, w]) => [k, t(w)])) as Partial<Record<DraftError, string>>;
    setErrors(errs);
    if (Object.keys(errs).length) { toast(t('treasury.form.fix'), { kind: 'bad' }); return; }
    saving.current = true;
    try {
      let receipt_id = cur.receipt_id;
      let told = false;
      if (photo) {
        try {
          const up = await receiptQueue.send(photo, expenseId);
          // a photo still waiting cannot be named yet (the server would refuse the expense): it is linked once sent
          if (up.queued) { toast(t('treasury.form.receiptQueued')); told = true; }
          else { receipt_id = up.id; rememberReceipt(up.id, photo.dataUrl); }
        } catch (e) { toast(errorMessage(e), { kind: 'bad' }); return; }
      }
      // the photo waiting from before was changed or taken off: it is not sent any more
      if (waiting && photoTouched.current && waiting.id !== photo?.id) { await receiptQueue.drop(waiting.id); setWaiting(null); }
      // the photo the server refused before, kept: saving again gives it a new try
      else if (waiting?.failed && !photoTouched.current) { await receiptQueue.retry(waiting.id); setWaiting({ ...waiting, failed: false }); }
      const offline = told || !net.value.online;
      const id = await run(() => saveExpense({
        id: expenseId,
        day: cur.day, vendor: cur.vendor.trim() || null, category: cur.category.trim(), description: cur.description.trim() || null,
        ...draftAmounts(cur), method: cur.method, truck_id: cur.truck_id, ...(editing && !photoTouched.current ? {} : { receipt_id })
      }), { ok: offline ? undefined : t('treasury.form.saved') });
      if (!id) return;
      keepAfterSave('expenses', id);
      if (offline && !told) toast(t('shell.queued'));
      p.onClose();
    } finally { saving.current = false; }
  }

  return (
    <Sheet open onClose={p.onClose} wide title={editing ? t('treasury.form.editTitle') : t('treasury.form.newTitle')} data-testid="expense-sheet"
      footer={<>
        {editing && <Button variant="danger" icon={<Trash size={18} />} confirm={t('common.confirmDelete')} data-testid="expense-delete"
          onClick={async () => { if (await attempt(() => removeExpense(p.expense!.id), { ok: t('treasury.form.deleted') })) p.onClose(); }}>{t('common.delete')}</Button>}
        <Button variant="primary" onClick={save} data-testid="expense-save">{t('treasury.form.save')}</Button>
      </>}>
      <Form id="expense-form" class="tre-form" onSubmit={save}>
        <ReceiptCapture shown={shown} attached={!!d.receipt_id} thumb={thumb} waiting={!!waiting && !waiting.failed && !photo && shown === waiting.dataUrl}
          refused={!!waiting?.failed && !photo && shown === waiting.dataUrl}
          reading={reader.reading} msg={reader.msg} l={l}
          onShoot={() => camRef.current?.click()} onPick={() => pickRef.current?.click()} onRemove={dropPhoto} onView={() => setViewer(true)} onStop={reader.stop} />

        <div class="tre-fields stack">
          <AmountFields d={d} l={l} fromReceipt={fromReceipt.has('amounts')} errors={errors} onAmount={onAmount}
            onTaxed={(taxed) => { touch('amounts'); clearErrors('sum'); setD(withTaxed(dRef.current, taxed, rates)); }} />
          <div class="grid-2">
            <Field label={t('treasury.form.day')} error={errors.day} hint={fromReceipt.has('day') ? <span class="tre-read">{t('treasury.form.fromReceipt')}</span> : undefined}>
              <DateInput value={d.day} max={today()} aria-label={t('treasury.form.day')} onValue={(v) => { touch('day'); clearErrors('day'); setD({ ...dRef.current, day: v }); }} />
            </Field>
            <Field label={t('treasury.form.vendor')} hint={fromReceipt.has('vendor') ? <span class="tre-read">{t('treasury.form.fromReceipt')}</span> : t('treasury.form.vendorHint')}>
              <Input value={d.vendor} list="tre-vendors" autoComplete="off" maxLength={120} data-testid="expense-vendor"
                onValue={(v) => { touch('vendor'); setD({ ...dRef.current, vendor: v }); }}
                onBlur={() => {
                  // leaving the vendor proposes its category (the one used last time, else the kind of store)
                  const cur = dRef.current;
                  if (cur.category || typed.current.has('category')) return;
                  const c = guessCategory(cur.vendor, categories.value, history);
                  if (c) setD({ ...cur, category: c });
                }} />
              <datalist id="tre-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
            </Field>
          </div>
          <Field label={t('treasury.form.category')} error={errors.category} hint={fromReceipt.has('category') ? <span class="tre-read">{t('treasury.form.fromReceipt')}</span> : undefined}>
            <Select value={d.category || ''} placeholder={t('treasury.form.chooseCategory')} aria-label={t('treasury.form.category')}
              options={cats.map((c) => ({ value: c, label: c }))}
              onValue={(v) => { touch('category'); clearErrors('category'); setD({ ...dRef.current, category: v }); }} />
          </Field>
          <Field group label={t('treasury.form.method')} optional>
            <Chips label={t('treasury.form.method')} value={d.method ? [d.method] : []} data-testid="expense-method"
              options={EXPENSE_METHODS.map((m) => ({ value: m, label: methodLabel(m) }))}
              onValue={(v) => setD({ ...dRef.current, method: v[0] || null })} />
          </Field>
          {trucks.value.length > 0 && (
            <Field label={t('treasury.form.truck')} optional>
              <Select value={d.truck_id || ''} aria-label={t('treasury.form.truck')}
                options={[{ value: '', label: t('treasury.form.noTruck') }, ...trucks.value.map((tr) => ({ value: tr.id, label: truckLabel(tr.id) }))]}
                onValue={(v) => setD({ ...dRef.current, truck_id: v || null })} />
            </Field>
          )}
          <Field label={t('treasury.form.description')} optional hint={t('treasury.form.descriptionHint')}>
            <Textarea value={d.description} rows={2} maxLength={500} onValue={(v) => setD({ ...dRef.current, description: v })} />
          </Field>
        </div>
        {/* last in the form: the sheet puts the focus on its first field, never on these */}
        <input ref={camRef} type="file" accept="image/*" capture="environment" class="sr-only" tabIndex={-1} aria-hidden="true" data-testid="receipt-camera" onChange={(e) => void onFile(e.currentTarget)} />
        <input ref={pickRef} type="file" accept="image/*" class="sr-only" tabIndex={-1} aria-hidden="true" data-testid="receipt-file" onChange={(e) => void onFile(e.currentTarget)} />
      </Form>
      <ReceiptViewer open={viewer} onClose={() => setViewer(false)} src={shown} id={photo ? null : d.receipt_id} />
    </Sheet>
  );
}
