/* « Ajouter une dépense » / « Modifier la dépense »: the receipt photo first (it is read for you: vendor, date,
   amounts), then the amounts with Québec taxes worked out from the total (or from the price before taxes), then the
   rest. Everything the reader proposes stays editable, and what the person typed is never overwritten by it. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Camera, ImagePlus, Paperclip, ScanText, X, Trash, Expand } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { money, QC_TAXES, type TaxRates } from '../../lib/money';
import { today, isValidDay } from '../../lib/dates';
import { saveExpense, errorMessage } from '../../data/api';
import { settings, trucks, truckLabel, expensesList } from '../../data/select';
import { net } from '../../data/sync';
import type { Expense } from '../../data/types';
import { Sheet, Form, Field, Input, Textarea, Select, MoneyInput, Seg, Chips, DateInput, Button, Banner, Spinner, Skeleton, toast, attempt, run } from '../../ui';
import { Meter } from '../dashboard/charts';
import { parseReceipt, splitFromSubtotal, splitFromTotal, guessCategory, type ReceiptGuess } from './receipt';
import { shrinkPhoto, readReceipt, type Photo, type Reading } from './ocr';
import { categories, EXPENSE_METHODS, methodLabel, uploadReceipt, removeExpense, receiptImage, rememberReceipt, keepAfterSave } from './data';

type Anchor = 'total' | 'subtotal';
interface Draft {
  day: string; vendor: string; category: string; description: string;
  total: number | null; subtotal: number | null; tps: number | null; tvq: number | null; taxed: boolean; anchor: Anchor;
  method: string | null; truck_id: string | null; receipt_id: string | null;
}
type Errors = Partial<Record<'day' | 'total' | 'category' | 'sum', string>>;

function fresh(e?: Expense | null): Draft {
  if (e) {
    return {
      day: e.day, vendor: e.vendor || '', category: e.category || '', description: e.description || '',
      total: e.total_cents, subtotal: e.subtotal_cents, tps: e.tps_cents, tvq: e.tvq_cents,
      taxed: (e.tps_cents || 0) + (e.tvq_cents || 0) !== 0 || e.subtotal_cents !== e.total_cents, anchor: 'total',
      method: e.method || null, truck_id: e.truck_id || null, receipt_id: e.receipt_id || null
    };
  }
  return { day: today(), vendor: '', category: '', description: '', total: null, subtotal: null, tps: null, tvq: null, taxed: true, anchor: 'total', method: null, truck_id: null, receipt_id: null };
}
/* the amounts: the total paid is the truth (it is on the receipt), unless the person typed the price before taxes */
export function withTotal(d: Draft, total: number | null, rates: TaxRates): Draft {
  if (total == null) return { ...d, total: null, subtotal: null, tps: d.taxed ? null : 0, tvq: d.taxed ? null : 0, anchor: 'total' };
  if (!d.taxed) return { ...d, total, subtotal: total, tps: 0, tvq: 0, anchor: 'total' };
  return { ...d, ...splitFromTotal(total, rates), anchor: 'total' };
}
export function withSubtotal(d: Draft, subtotal: number | null, rates: TaxRates): Draft {
  if (subtotal == null) return { ...d, subtotal: null, total: null, tps: d.taxed ? null : 0, tvq: d.taxed ? null : 0, anchor: 'subtotal' };
  if (!d.taxed) return { ...d, subtotal, total: subtotal, tps: 0, tvq: 0, anchor: 'subtotal' };
  return { ...d, ...splitFromSubtotal(subtotal, rates), anchor: 'subtotal' };
}
function withTax(d: Draft, key: 'tps' | 'tvq', v: number | null): Draft {
  const n = { ...d, [key]: v };
  if (n.anchor === 'subtotal') { if (n.subtotal != null) n.total = n.subtotal + (n.tps ?? 0) + (n.tvq ?? 0); }
  else if (n.total != null) n.subtotal = n.total - (n.tps ?? 0) - (n.tvq ?? 0);
  return n;
}
function withTaxed(d: Draft, taxed: boolean, rates: TaxRates): Draft {
  const n = { ...d, taxed };
  return n.anchor === 'subtotal' ? withSubtotal(n, n.subtotal, rates) : withTotal(n, n.total, rates);
}
function check(d: Draft): Errors {
  const e: Errors = {};
  if (!isValidDay(d.day)) e.day = t('treasury.form.errDay');
  if (d.total == null || d.total <= 0) e.total = t('treasury.form.errTotal');
  if (!d.category.trim()) e.category = t('treasury.form.errCategory');
  if (!e.total && d.taxed && (d.subtotal == null || d.tps == null || d.tvq == null || d.subtotal < 0 || d.subtotal + d.tps + d.tvq !== d.total)) e.sum = t('treasury.form.errSum');
  return e;
}

export function ExpenseSheet(p: { open: boolean; onClose: () => void; expense?: Expense | null }) {
  if (!p.open) return null;
  return <ExpenseForm key={p.expense?.id || 'new'} {...p} />;
}

function ExpenseForm(p: { open: boolean; onClose: () => void; expense?: Expense | null }) {
  const l = lang.value;
  const editing = !!p.expense;
  const rates: TaxRates = { ...QC_TAXES, tps: settings.value.taxes?.tps ?? QC_TAXES.tps, tvq: settings.value.taxes?.tvq ?? QC_TAXES.tvq, enabled: true };
  const [d, setDraft] = useState<Draft>(() => fresh(p.expense));
  const dRef = useRef(d);
  const setD = (n: Draft) => { dRef.current = n; setDraft(n); };
  const [errors, setErrors] = useState<Errors>({});
  const touched = useRef(new Set<string>());
  const touch = (k: string) => { touched.current.add(k); setFromReceipt((s) => { if (!s.has(k)) return s; const n = new Set(s); n.delete(k); return n; }); };
  const [fromReceipt, setFromReceipt] = useState<Set<string>>(new Set());
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [thumb, setThumb] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [reading, setReading] = useState<{ pct: number; stage: 'load' | 'read' } | null>(null);
  const [readMsg, setReadMsg] = useState<{ kind: 'ok' | 'info' | 'warn'; text: string } | null>(null);
  const [viewer, setViewer] = useState(false);
  const readRef = useRef<Reading | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const saving = useRef(false);

  // an expense that already has a receipt: its picture, when there is signal
  useEffect(() => {
    const id = p.expense?.receipt_id;
    if (!id) return;
    let alive = true;
    setThumb('loading');
    receiptImage(id).then((u) => { if (alive) { setShown(u); setThumb(u ? 'idle' : 'failed'); } }, () => { if (alive) setThumb('failed'); });
    return () => { alive = false; };
  }, []);
  useEffect(() => () => readRef.current?.cancel(), []);

  const history = useMemo(() => expensesList.value.map((e) => ({ vendor: e.vendor, category: e.category })), [expensesList.value]);
  const vendors = useMemo(() => [...new Set(expensesList.value.map((e) => (e.vendor || '').trim()).filter(Boolean))].slice(0, 40), [expensesList.value]);
  const cats = categories.value.includes(d.category) || !d.category ? categories.value : [...categories.value, d.category];

  function apply(g: ReceiptGuess & { consistent: boolean }) {
    let n = { ...dRef.current };
    const filled = new Set<string>();
    if (!touched.current.has('vendor') && g.vendor) { n.vendor = g.vendor; filled.add('vendor'); }
    if (!touched.current.has('day') && g.day) { n.day = g.day; filled.add('day'); }
    if (!touched.current.has('category') && !n.category) {
      const c = guessCategory(n.vendor, categories.value, history);
      if (c) { n.category = c; filled.add('category'); }
    }
    if (!touched.current.has('amounts')) {
      if (g.consistent && g.total != null) { n = { ...n, total: g.total, subtotal: g.subtotal, tps: g.tps, tvq: g.tvq, taxed: (g.tps ?? 0) + (g.tvq ?? 0) > 0, anchor: 'total' }; filled.add('amounts'); }
      else if (g.total != null) { n = withTotal({ ...n, taxed: true }, g.total, rates); filled.add('amounts'); }
      else if (g.subtotal != null) { n = withSubtotal({ ...n, taxed: true }, g.subtotal, rates); filled.add('amounts'); }
    }
    setD(n);
    setFromReceipt(filled);
    setErrors({});
    const any = g.total != null || g.subtotal != null || !!g.vendor || !!g.day;
    setReadMsg(!any ? { kind: 'warn', text: t('treasury.form.nothing') } : g.consistent ? { kind: 'ok', text: t('treasury.form.read') } : { kind: 'info', text: t('treasury.form.partial') });
  }

  async function onFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setReadMsg(null);
    let ph: Photo;
    try { ph = await shrinkPhoto(file); } catch { setReadMsg({ kind: 'warn', text: t('treasury.form.photoBad') }); return; }
    setPhoto(ph); setShown(ph.dataUrl); setThumb('idle');
    readRef.current?.cancel();
    setReading({ pct: 0, stage: 'load' });
    let r: Reading | null = null;
    r = readReceipt(ph.dataUrl, (pct, stage) => { if (!r || readRef.current === r) setReading({ pct, stage }); });
    readRef.current = r;
    try {
      const text = await r.result;
      if (readRef.current !== r) return;
      apply(parseReceipt(text, today(), rates));
    } catch (e) {
      if (readRef.current !== r) return;
      setReadMsg((e as { code?: string }).code === 'stopped' ? { kind: 'info', text: t('treasury.form.stopped') } : { kind: 'warn', text: t('treasury.form.noReader') });
    } finally {
      if (readRef.current === r) { readRef.current = null; setReading(null); }
    }
  }
  function dropPhoto() {
    readRef.current?.cancel();
    readRef.current = null;
    setReading(null); setPhoto(null); setShown(null); setThumb('idle'); setReadMsg(null);
    setD({ ...dRef.current, receipt_id: null });
  }

  async function save() {
    if (saving.current) return;
    const cur = dRef.current;
    const errs = check(cur);
    setErrors(errs);
    if (Object.keys(errs).length) { toast(t('treasury.form.fix'), { kind: 'bad' }); return; }
    saving.current = true;
    try {
      let receipt_id = cur.receipt_id;
      if (photo) {
        try {
          const up = await uploadReceipt(photo);
          receipt_id = up.id;
          rememberReceipt(up.id, photo.dataUrl);
          if (up.queued) toast(t('treasury.form.receiptQueued'));
        } catch (e) { toast(errorMessage(e), { kind: 'bad' }); return; }
      }
      const offline = !net.value.online;
      const id = await run(() => saveExpense({
        ...(p.expense ? { id: p.expense.id } : {}),
        day: cur.day, vendor: cur.vendor.trim() || null, category: cur.category.trim(), description: cur.description.trim() || null,
        subtotal_cents: cur.taxed ? cur.subtotal! : cur.total!, tps_cents: cur.taxed ? cur.tps! : 0, tvq_cents: cur.taxed ? cur.tvq! : 0, total_cents: cur.total!,
        method: cur.method, truck_id: cur.truck_id, receipt_id
      }), { ok: offline ? undefined : t('treasury.form.saved') });
      if (!id) return;
      keepAfterSave('expenses', id);
      if (offline) toast(t('shell.queued'));
      p.onClose();
    } finally { saving.current = false; }
  }

  const sum = (d.subtotal ?? 0) + (d.tps ?? 0) + (d.tvq ?? 0);
  const sumKnown = d.total != null && d.subtotal != null && d.tps != null && d.tvq != null;
  const pctText = reading ? new Intl.NumberFormat(l === 'en' ? 'en-CA' : 'fr-CA', { style: 'percent', maximumFractionDigits: 0 }).format(reading.pct) : '';
  const hasPicture = !!(shown || d.receipt_id);

  return (
    <Sheet open onClose={p.onClose} wide title={editing ? t('treasury.form.editTitle') : t('treasury.form.newTitle')} data-testid="expense-sheet"
      footer={<>
        {editing && <Button variant="danger" icon={<Trash size={18} />} confirm={t('common.confirmDelete')} data-testid="expense-delete"
          onClick={async () => { if (await attempt(() => removeExpense(p.expense!.id), { ok: t('treasury.form.deleted') })) p.onClose(); }}>{t('common.delete')}</Button>}
        <Button variant="primary" onClick={save} data-testid="expense-save">{t('treasury.form.save')}</Button>
      </>}>
      <Form id="expense-form" class="tre-form" onSubmit={save}>
        <div class="tre-photo stack">
          {!hasPicture ? (
            <>
              <button type="button" class="tre-shoot" onClick={() => camRef.current?.click()} data-testid="receipt-shoot">
                <span class="tre-shoot-icon" aria-hidden="true"><Camera /></span>
                <span class="tre-shoot-txt"><b>{t('treasury.form.photo')}</b><span>{t('treasury.form.photoSub')}</span></span>
              </button>
              <Button variant="ghost" icon={<ImagePlus size={18} />} onClick={() => pickRef.current?.click()} data-testid="receipt-pick">{t('treasury.form.pick')}</Button>
            </>
          ) : (
            <>
              {shown ? (
                <button type="button" class="tre-thumb" onClick={() => setViewer(true)} aria-label={t('treasury.form.see')} data-testid="receipt-thumb">
                  <img src={shown} alt={t('treasury.form.photoAlt')} />
                  <span class="tre-thumb-zoom" aria-hidden="true"><Expand size={18} /></span>
                </button>
              ) : thumb === 'loading' ? <div class="tre-thumb tre-thumb-empty"><Skeleton h={180} /></div>
                : <div class="tre-thumb tre-thumb-empty"><Paperclip /><Button variant="secondary" onClick={() => setViewer(true)}>{t('treasury.form.see')}</Button></div>}
              <div class="row-wrap">
                <Button variant="secondary" icon={<Camera size={18} />} onClick={() => camRef.current?.click()} data-testid="receipt-change">{t('treasury.form.change')}</Button>
                <Button variant="ghost" icon={<X size={18} />} onClick={dropPhoto} data-testid="receipt-remove">{t('treasury.form.remove')}</Button>
              </div>
            </>
          )}
          {reading && (
            <div class="tre-reading" role="status" data-testid="receipt-reading">
              <div class="row">
                <ScanText size={20} aria-hidden="true" />
                <span class="grow">{reading.stage === 'read' ? t('treasury.form.reading', { pct: pctText }) : t('treasury.form.preparing')}</span>
                <Button variant="ghost" onClick={() => readRef.current?.cancel()} data-testid="receipt-stop">{t('treasury.form.stop')}</Button>
              </div>
              <Meter value={reading.stage === 'read' ? reading.pct : 0.04} label={t('treasury.form.preparing')} />
            </div>
          )}
          {readMsg && <Banner kind={readMsg.kind} data-testid="receipt-message">{readMsg.text}</Banner>}
        </div>

        <div class="tre-fields stack">
          <Field label={t('treasury.form.total')} hint={fromReceipt.has('amounts') ? <span class="tre-read">{t('treasury.form.fromReceipt')}</span> : t('treasury.form.totalHint')} error={errors.total}>
            <span class="tre-total"><MoneyInput cents={d.total} invalid={!!errors.total} aria-label={t('treasury.form.total')}
              onCents={(c) => { touch('amounts'); setErrors((x) => ({ ...x, total: undefined, sum: undefined })); setD(withTotal(dRef.current, c, rates)); }} /></span>
          </Field>
          <Field group label={t('treasury.form.taxes')}>
            <Seg value={d.taxed ? 'yes' : 'no'} label={t('treasury.form.taxes')} data-testid="expense-taxed"
              options={[{ value: 'yes', label: t('treasury.form.taxed') }, { value: 'no', label: t('treasury.form.untaxed') }]}
              onValue={(v) => { touch('amounts'); setErrors((x) => ({ ...x, sum: undefined })); setD(withTaxed(dRef.current, v === 'yes', rates)); }} />
          </Field>
          {d.taxed && (
            <>
              <div class="tre-split">
                <Field label={t('treasury.form.subtotal')}>
                  <MoneyInput cents={d.subtotal} aria-label={t('treasury.form.subtotal')} onCents={(c) => { touch('amounts'); setErrors((x) => ({ ...x, sum: undefined })); setD(withSubtotal(dRef.current, c, rates)); }} />
                </Field>
                <Field label={t('treasury.form.tps')}>
                  <MoneyInput cents={d.tps} aria-label={t('treasury.form.tps')} onCents={(c) => { touch('amounts'); setErrors((x) => ({ ...x, sum: undefined })); setD(withTax(dRef.current, 'tps', c)); }} />
                </Field>
                <Field label={t('treasury.form.tvq')}>
                  <MoneyInput cents={d.tvq} aria-label={t('treasury.form.tvq')} onCents={(c) => { touch('amounts'); setErrors((x) => ({ ...x, sum: undefined })); setD(withTax(dRef.current, 'tvq', c)); }} />
                </Field>
              </div>
              {errors.sum ? <p class="field-error" role="alert" style={{ margin: 0 }}>{errors.sum}</p>
                : sumKnown && (sum === d.total
                  ? <p class="small muted" style={{ margin: 0 }} data-testid="expense-sum">{t('treasury.form.sumOk', { total: money(d.total, l) })} {!fromReceipt.has('amounts') && t('treasury.form.computed')}</p>
                  : <p class="small tre-warn" style={{ margin: 0 }} role="status" data-testid="expense-sum">{t('treasury.form.sumBad', { sum: money(sum, l), total: money(d.total, l) })}</p>)}
            </>
          )}
          <div class="grid-2">
            <Field label={t('treasury.form.day')} error={errors.day} hint={fromReceipt.has('day') ? <span class="tre-read">{t('treasury.form.fromReceipt')}</span> : undefined}>
              <DateInput value={d.day} max={today()} aria-label={t('treasury.form.day')} onValue={(v) => { touch('day'); setErrors((x) => ({ ...x, day: undefined })); setD({ ...dRef.current, day: v }); }} />
            </Field>
            <Field label={t('treasury.form.vendor')} hint={fromReceipt.has('vendor') ? <span class="tre-read">{t('treasury.form.fromReceipt')}</span> : t('treasury.form.vendorHint')}>
              <Input value={d.vendor} list="tre-vendors" autoComplete="off" maxLength={120} data-testid="expense-vendor"
                onValue={(v) => { touch('vendor'); setD({ ...dRef.current, vendor: v }); }}
                onBlur={() => {
                  const cur = dRef.current;
                  if (cur.category || touched.current.has('category')) return;
                  const c = guessCategory(cur.vendor, categories.value, history);
                  if (c) setD({ ...cur, category: c });
                }} />
              <datalist id="tre-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
            </Field>
          </div>
          <Field label={t('treasury.form.category')} error={errors.category} hint={fromReceipt.has('category') ? <span class="tre-read">{t('treasury.form.fromReceipt')}</span> : undefined}>
            <Select value={d.category || ''} placeholder={t('treasury.form.chooseCategory')} aria-label={t('treasury.form.category')}
              options={cats.map((c) => ({ value: c, label: c }))}
              onValue={(v) => { touch('category'); setErrors((x) => ({ ...x, category: undefined })); setD({ ...dRef.current, category: v }); }} />
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

/** the receipt, large */
export function ReceiptViewer(p: { open: boolean; onClose: () => void; src?: string | null; id?: string | null }) {
  const [st, setSt] = useState<{ url: string | null; err: string | null; loading: boolean }>({ url: null, err: null, loading: false });
  // opened over the expense: Escape closes this one only (every open sheet of the kit listens to Escape)
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  useEffect(() => {
    if (!p.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); closeRef.current(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [p.open]);
  useEffect(() => {
    if (!p.open) return;
    if (p.src) { setSt({ url: p.src, err: null, loading: false }); return; }
    if (!p.id) { setSt({ url: null, err: t('treasury.viewer.missing'), loading: false }); return; }
    let alive = true;
    setSt({ url: null, err: null, loading: true });
    receiptImage(p.id).then(
      (u) => { if (alive) setSt({ url: u, err: u ? null : t('treasury.viewer.missing'), loading: false }); },
      () => { if (alive) setSt({ url: null, err: net.value.online ? t('treasury.viewer.missing') : t('treasury.viewer.offline'), loading: false }); }
    );
    return () => { alive = false; };
  }, [p.open, p.src, p.id]);
  const openLarge = async () => {
    if (!st.url) return;
    try {
      const blob = await (await fetch(st.url)).blob();
      const u = URL.createObjectURL(blob);
      window.open(u, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch { /* the picture stays in the sheet */ }
  };
  return (
    <Sheet open={p.open} onClose={p.onClose} wide title={t('treasury.viewer.title')} data-testid="receipt-viewer"
      footer={st.url ? <Button variant="secondary" icon={<Expand size={18} />} onClick={openLarge}>{t('treasury.viewer.open')}</Button> : undefined}>
      {st.loading ? <Spinner label={t('treasury.viewer.loading')} />
        : st.err ? <Banner kind="warn">{st.err}</Banner>
        : st.url && <img class="tre-receipt-img" src={st.url} alt={t('treasury.form.photoAlt')} />}
    </Sheet>
  );
}
