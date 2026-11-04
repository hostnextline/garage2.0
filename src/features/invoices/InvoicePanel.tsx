/* The invoice part of a job sheet (shared: the jobs section shows it). Make it from the work, change the draft lines
   (saved by themselves), finish it (its number), text it to the customer with the « Payer » link, take the payment,
   and the PAYÉ stamp. Who may change it mirrors the server (invoice_editable): the office, or the mechanic of the job. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { FileText, Send, FileDown, RotateCcw, Ban, Receipt, Banknote } from 'lucide-preact';
import type { Invoice, Job, Payment } from '../../data/types';
import { job as jobRow, invoiceOf, jobTotals, itemsOf, settings, invoiceNumber, vehicle } from '../../data/select';
import { invoiceForJob, saveInvoiceDraft, finishInvoice, voidInvoice, errorMessage } from '../../data/api';
import { net, outboxList } from '../../data/sync';
import type { OutboxEntry } from '../../data/local';
import { getRow } from '../../data/store';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { clock, stamp as stampText, dayOf, today } from '../../lib/dates';
import { Panel, Button, Banner, Totals, InvoicePill, Stamp, Switch, Field, Textarea, askText, run, toast, Rows, RowItem, Money } from '../../ui';
import { linesTotals, draftProblems, cleanLine } from './logic';
import { voidedOf, paymentsOfInvoice, amountsOf, canEditInvoiceOf, canManageInvoices, methodWord, invoiceCustomer } from './select';
import { LinesEditor, LinesView, CatalogSheet, withKeys, type EditLine } from './Lines';
import { PaySheet } from './PaySheet';
import { sendText, SendSheet, type SendResult } from './send';
import { usePdf } from './usePdf';
import { invoicePdfData } from './pdf';
import { useDraft } from './useDraft';
import './invoices.css';

export interface InvoicePanelProps { jobId: string }

/** operations of this invoice still waiting on the phone (no signal) */
function usePending(match: (e: OutboxEntry) => boolean): OutboxEntry[] {
  const n = net.value;
  const [list, setList] = useState<OutboxEntry[]>([]);
  useEffect(() => {
    let alive = true;
    void outboxList().then((all) => { if (alive) setList(all.filter((e) => e.state === 'pending' && match(e))); }, () => undefined);
    return () => { alive = false; };
  }, [n.pending, n.online, n.sending]);
  return n.online ? list.filter((e) => e.tries > 0) : list;
}

export function InvoicePanel(p: InvoicePanelProps) {
  const j = jobRow(p.jobId);
  const inv = invoiceOf(p.jobId);
  if (!j) return <Panel title={t('invoices.panel.title')}><p class="muted" style={{ margin: 0 }}>{t('invoices.panel.noJob')}</p></Panel>;
  if (!inv) return <NoInvoice job={j} />;
  if (inv.status === 'draft') return <DraftInvoice key={inv.id} job={j} inv={inv} />;
  return <FinishedInvoice job={j} inv={inv} />;
}

/* ---------- no invoice yet: what the work is worth, « Faire la facture » ---------- */
function NoInvoice(p: { job: Job }) {
  const tt = jobTotals(p.job.id);
  const hasWork = itemsOf(p.job.id).some((i) => ['planned', 'done', 'approved'].includes(i.status));
  const editable = canEditInvoiceOf(p.job);
  const old = voidedOf(p.job.id);
  const waiting = usePending((e) => e.rpc === 'invoice_for_job' && e.args?.p_job === p.job.id);
  const make = () => run(() => invoiceForJob(p.job.id, true), { ok: t('invoices.panel.made') });
  return (
    <Panel title={t('invoices.panel.title')} help={t('invoices.panel.help')} data-testid="invoice-panel" class="inv-panel">
      <div class="stack">
        {old && <Banner kind="info">{old.void_reason ? t('invoices.panel.voided', { n: invoiceNumber(old), reason: old.void_reason }) : t('invoices.panel.voidedPlain', { n: invoiceNumber(old) })}</Banner>}
        <div class="inv-hero">
          <span class="inv-hero-label">{t('invoices.panel.expected')}</span>
          <span class="inv-hero-amount money" data-testid="expected-total">{money(tt.total, lang.value)}</span>
          <span class="muted small">{hasWork ? t('invoices.panel.expectedHint') : t('invoices.panel.noWork')}</span>
        </div>
        {waiting.length > 0
          ? <Banner kind="warn">{t('invoices.panel.waiting')}</Banner>
          : editable
            ? <Button variant="primary" block icon={<FileText />} onClick={make} data-testid="invoice-make">{t('invoices.panel.make')}</Button>
            : <p class="muted small" style={{ margin: 0 }}>{t('invoices.panel.notYours')}</p>}
        {editable && !waiting.length && <p class="muted small" style={{ margin: 0 }}>{t('invoices.panel.makeHint')}</p>}
      </div>
    </Panel>
  );
}

/* ---------- a draft: lines, taxes, note — saved by themselves; then « Terminer la facture » ---------- */
interface DraftValue { lines: EditLine[]; taxesOn: boolean; notes: string }
const draftSig = (v: { lines: EditLine[] | Invoice['lines']; taxesOn: boolean; notes: string | null }) =>
  JSON.stringify({ l: (v.lines || []).map((x) => cleanLine(x)), t: v.taxesOn, n: (v.notes || '').trim() });
const fromInvoice = (inv: Invoice): DraftValue => ({ lines: withKeys(inv.lines), taxesOn: inv.taxes_on !== false, notes: inv.notes || '' });

export function DraftInvoice(p: { job: Job | undefined; inv: Invoice }) {
  const { inv } = p;
  const editable = canEditInvoiceOf(p.job);
  const rates = settings.value.taxes;
  const docLang = inv.lang === 'en' ? 'en' : 'fr';
  const server = fromInvoice(inv);
  const d = useDraft<DraftValue>(server, draftSig, async (v) => {
    try { await saveInvoiceDraft(inv.id, { lines: v.lines.map(cleanLine), taxes_on: v.taxesOn, notes: v.notes.trim() || null }); }
    catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  });
  const v = d.value;
  const tt = linesTotals(v.lines, rates, v.taxesOn);
  const [showErrors, setShowErrors] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const check = draftProblems(v.lines, tt.total);
  const waiting = usePending((e) => e.rpc === 'invoice_finish' && e.args?.p_invoice === inv.id);
  // work added to the job (or an extra the customer accepted) after this draft was started, not on it yet
  const onDraft = new Set(v.lines.map((l) => l.item_id).filter(Boolean));
  const newWork = p.job ? itemsOf(p.job.id).filter((i) => ['planned', 'done', 'approved'].includes(i.status) && !onDraft.has(i.id)
    && Date.parse(String(i.updated_at || i.created_at || '')) > Date.parse(String(inv.created_at || ''))) : [];
  const addNewWork = () => d.change({ ...v, lines: [...v.lines, ...withKeys(newWork.map((i) => ({ description: i.description, qty: Number(i.qty), unit_cents: i.unit_cents, taxable: i.taxable, kind: i.kind, item_id: i.id })))] });

  const finish = async () => {
    if (check.problem) { setShowErrors(true); toast(t(`invoices.draft.problem.${check.problem}`), { kind: 'bad' }); return; }
    await d.flush();
    const r = await run(() => finishInvoice(inv.id));
    if (r && !r.queued) toast(t('invoices.draft.finished', { n: invoiceNumber({ number: r.data?.number ?? getRow<Invoice>('invoices', inv.id)?.number ?? null }) }), { kind: 'ok' });
  };
  const refresh = async () => {
    if (!p.job) return;
    const r = await run(() => invoiceForJob(p.job!.id, true), { ok: t('invoices.draft.refreshed') });
    const fresh = getRow<Invoice>('invoices', inv.id);
    if (r && !r.queued && fresh) d.reset(fromInvoice(fresh));
  };
  const remove = async () => {
    const reason = await askText({ title: t('invoices.void.draftTitle'), text: t('invoices.void.draftText'), label: t('invoices.void.reason'), ok: t('invoices.void.draftOk'), danger: true });
    if (reason == null) return;
    await run(() => voidInvoice(inv.id, reason), { ok: t('invoices.void.draftDone') });
  };

  return (
    <Panel title={<>{t('invoices.panel.title')} <InvoicePill status="draft" /></>} help={t('invoices.draft.help')}
      data-testid="invoice-panel" class="inv-panel"
      action={editable ? <span class={`inv-saved inv-saved-${d.state}`} role="status" aria-live="polite" data-testid="draft-state">{t(`invoices.draft.state.${d.state}`)}</span> : undefined}>
      <div class="stack-lg">
        {!editable && <Banner kind="info">{t('invoices.draft.readOnly')}</Banner>}
        {editable && newWork.length > 0 && (
          <Banner kind="warn" title={t('invoices.draft.newWork', { n: newWork.length })} data-testid="draft-new-work">
            <span class="inv-new-work">{newWork.map((i) => i.description).join(', ')}</span>
            <Button variant="primary" onClick={addNewWork} data-testid="draft-add-new-work">{t('invoices.draft.addNewWork')}</Button>
          </Banner>
        )}
        {editable
          ? <LinesEditor lines={v.lines} onLines={(lines) => d.change({ ...v, lines })} docLang={docLang} errorLines={showErrors ? check.lines : []} onCatalog={() => setCatalog(true)} />
          : <LinesView lines={v.lines} docLang={docLang} />}
        {editable && (
          <div class="stack">
            {rates.enabled !== false
              ? <Switch checked={v.taxesOn} onChange={(on) => d.change({ ...v, taxesOn: on })} label={t('invoices.draft.taxes')} hint={v.taxesOn ? undefined : t('invoices.draft.taxesOffHint')} data-testid="draft-taxes" />
              : <p class="muted small" style={{ margin: 0 }}>{t('invoices.draft.taxesOffSettings')}</p>}
            <Field label={t('invoices.draft.notes')} hint={t('invoices.draft.notesHint')} optional>
              <Textarea value={v.notes} onValue={(notes) => d.change({ ...v, notes })} rows={2} maxLength={1000} />
            </Field>
          </div>
        )}
        <div class="inv-totals">
          <Totals subtotal={tt.subtotal} tps={tt.tps} tvq={tt.tvq} total={tt.total} taxesOn={rates.enabled !== false && v.taxesOn} />
        </div>
        {showErrors && check.problem && <Banner kind="bad">{t(`invoices.draft.problem.${check.problem}`)}</Banner>}
        {waiting.length > 0 && <Banner kind="warn">{t('invoices.draft.waiting')}</Banner>}
        {editable && (
          <div class="stack">
            <Button variant="primary" block icon={<Receipt />} onClick={finish} disabled={waiting.length > 0} data-testid="invoice-finish">
              {t('invoices.draft.finish', { total: money(tt.total, lang.value) })}
            </Button>
            <p class="muted small" style={{ margin: 0 }}>{t('invoices.draft.finishHint')}</p>
            <div class="inv-actions">
              {p.job && <Button variant="ghost" icon={<RotateCcw />} confirm={t('invoices.draft.refreshConfirm')} onClick={refresh} data-testid="invoice-refresh">{t('invoices.draft.refresh')}</Button>}
              {canManageInvoices() && <Button variant="ghost" icon={<Ban />} onClick={remove} data-testid="draft-delete">{t('invoices.void.draftButton')}</Button>}
            </div>
          </div>
        )}
      </div>
      <CatalogSheet open={catalog} onClose={() => setCatalog(false)} docLang={docLang} onAdd={(add) => d.change({ ...v, lines: [...v.lines, ...add] })} />
    </Panel>
  );
}

/* ---------- finished: read-only, payments, « Encaisser », « Envoyer par texto », PDF, the PAYÉ stamp ---------- */
function FinishedInvoice(p: { job: Job; inv: Invoice }) {
  const { inv, job } = p;
  const a = amountsOf(inv);
  const l = lang.value;
  const pays = paymentsOfInvoice(inv.id);
  const editable = canEditInvoiceOf(job);
  const [payOpen, setPayOpen] = useState(false);
  const [manual, setManual] = useState<SendResult | null>(null);
  const pdf = usePdf();
  const pendingPays = usePending((e) => e.rpc === 'payment_add' && e.args?.p_invoice === inv.id);
  // the stamp lands only when the invoice becomes paid in front of the person
  const prev = useRef(inv.status);
  const landed = useRef(false);
  if (prev.current !== inv.status) { if (inv.status === 'paid') landed.current = true; prev.current = inv.status; }
  const paid = inv.status === 'paid';
  const number = invoiceNumber(inv);
  const send = async () => { const r = await sendText('invoice', job.id, paid ? t('invoices.send.receiptSent') : undefined); if (r) setManual(r); };
  const makePdf = () => pdf.make(() => invoicePdfData({ invoice: inv, customer: invoiceCustomer(inv), vehicle: vehicle(job.vehicle_id), payments: pays, settings: settings.value }));
  const cancel = async () => {
    if (pays.length) { toast(t('invoices.void.hasPayments'), { kind: 'bad' }); return; }
    const reason = await askText({ title: t('invoices.void.title', { n: number }), text: t('invoices.void.text'), label: t('invoices.void.reason'), ok: t('invoices.void.ok'), danger: true });
    if (reason == null) return;
    await run(() => voidInvoice(inv.id, reason), { ok: t('invoices.void.done', { n: number }) });
  };
  return (
    <Panel title={<>{t('invoices.invoice')} <span class="nowrap">{number}</span> <InvoicePill status={inv.status} paidCents={inv.paid_cents} /></>}
      sub={inv.issued_at ? t('invoices.panel.issued', { when: stampText(inv.issued_at, l) }) : undefined}
      help={t('invoices.panel.helpIssued')} data-testid="invoice-panel" class={`inv-panel${paid ? ' is-paid' : ''}`}>
      <div class="stack-lg">
        {paid && (
          <div class="inv-paid-row">
            <Stamp kind="paid" animate={landed.current} />
            {pays.length > 0 && <p>{t('invoices.panel.paidOn', { when: stampText(pays[pays.length - 1].paid_at, l), how: [...new Set(pays.map((x) => methodWord(x.method, l)))].join(', ') })}</p>}
          </div>
        )}
        <LinesView lines={inv.lines || []} docLang={inv.lang} />
        <div class="inv-totals">
          <Totals subtotal={a.subtotal} tps={a.tps} tvq={a.tvq} total={a.total} paid={a.paid} taxesOn={a.showTaxes} />
        </div>
        {(pays.length > 0 || pendingPays.length > 0) && <PaymentsList pays={pays} pending={pendingPays} />}
        {inv.status === 'issued' && (
          <div class="stack">
            {editable
              ? <Button variant="primary" block class="inv-pay-btn" icon={<Banknote />} onClick={() => setPayOpen(true)} data-tour="job-pay" data-testid="invoice-pay">
                {t('invoices.panel.pay', { amount: money(a.balance, l) })}
              </Button>
              : <p class="muted small" style={{ margin: 0 }}>{t('invoices.panel.payNotYours')}</p>}
          </div>
        )}
        <div class="inv-actions">
          <Button icon={<Send />} onClick={send} data-testid="invoice-send">{paid ? t('invoices.panel.sendReceipt') : t('invoices.panel.send')}</Button>
          <Button icon={<FileDown />} onClick={makePdf} data-testid="invoice-pdf">{paid ? t('invoices.panel.pdfReceipt') : t('invoices.panel.pdf')}</Button>
          <Button variant="ghost" href={`#/invoice/${inv.id}`}>{t('invoices.panel.open')}</Button>
        </div>
        {inv.status === 'issued' && canManageInvoices() && (
          <Button variant="danger" icon={<Ban />} onClick={cancel} class="inv-void-btn" data-testid="invoice-void">{t('invoices.void.button')}</Button>
        )}
      </div>
      <PaySheet open={payOpen} onClose={() => setPayOpen(false)} invoiceId={inv.id} />
      <SendSheet result={manual} onClose={() => setManual(null)} />
      {pdf.sheet}
    </Panel>
  );
}

/** payments received: the method in words, when, how much (and those waiting for signal) */
export function PaymentsList(p: { pays: Payment[]; pending?: OutboxEntry[]; onRemove?: (pay: Payment) => unknown; canRemove?: (pay: Payment) => boolean; bare?: boolean }) {
  const l = lang.value;
  const when = (iso: string) => (dayOf(new Date(iso)) === today() ? clock(new Date(iso).getHours() * 60 + new Date(iso).getMinutes(), l) : stampText(iso, l));
  return (
    <div class="inv-pays">
      {!p.bare && <h3 class="inv-subtitle">{t('invoices.payments.title')}</h3>}
      <Rows data-testid="payments">
        {p.pays.map((x) => (
          <RowItem key={x.id} title={methodWord(x.method, l)} sub={[when(x.paid_at), x.reference ? t('invoices.payments.ref', { r: x.reference }) : ''].filter(Boolean).join(', ')}
            end={<span class="row"><Money cents={x.amount_cents} />
              {p.onRemove && p.canRemove?.(x) && (
                <Button variant="ghost" confirm={t('invoices.payments.removeConfirm')} onClick={() => p.onRemove!(x)} data-testid="payment-remove">{t('invoices.payments.remove')}</Button>
              )}</span>} />
        ))}
        {(p.pending || []).map((e) => (
          <RowItem key={e.op} title={methodWord(String(e.args?.p_method || ''), l)} sub={t('invoices.payments.waiting')} end={<Money cents={Number(e.args?.p_amount_cents || 0)} />} />
        ))}
      </Rows>
    </div>
  );
}
