/* A draft invoice: its lines, the taxes switch, the note for the customer, all saved by themselves; then « Terminer
   la facture » (its number). The draft follows the job's work by itself (settleLines): work taken off the job leaves
   it, work accepted or added after it was made goes on it, and finishing asks when billable work is still missing. */
import { useEffect, useState } from 'preact/hooks';
import { RotateCcw, Ban, Receipt } from 'lucide-preact';
import type { Invoice, Job, JobItem } from '../../data/types';
import { itemsOf, settings, invoiceNumber } from '../../data/select';
import { invoiceForJob, saveInvoiceDraft, finishInvoice, voidInvoice, updateItem } from '../../data/api';
import { net } from '../../data/sync';
import { getRow } from '../../data/store';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { Panel, Button, Banner, Totals, InvoicePill, Switch, Field, Textarea, askText, run, attempt, toast } from '../../ui';
import { jobRights } from '../../domain/jobs/rights';
import { linesTotals, draftProblems, cleanLine } from '../../domain/money/invoice';
import { workMissing, workToAdd, lineOfWork, settleLines, draftPatch, isBillable, jobOpen, type WorkItem } from '../../domain/money/draft';
import { withKeys, keepKeys, type EditLine } from '../../domain/money/editLines';
import { waitingEntries, rowWaiting } from '../../domain/money/waiting';
import { aheadOf } from '../../domain/money/view';
import { canEditInvoiceOf, canManageInvoices } from './select';
import { LinesEditor, percentWords } from './LinesEditor';
import { LinesView } from './LinesView';
import { CatalogSheet } from './CatalogSheet';
import { MissingWorkSheet } from './MissingWorkSheet';
import { useDraft } from './useDraft';

interface DraftValue { lines: EditLine[]; taxesOn: boolean; notes: string }
const draftSig = (v: DraftValue) => JSON.stringify({ l: v.lines.map((x) => cleanLine(x)), t: v.taxesOn, n: v.notes.trim() });
const fromInvoice = (inv: Invoice): DraftValue => ({ lines: withKeys(inv.lines), taxesOn: inv.taxes_on !== false, notes: inv.notes || '' });
const keyed = (work: WorkItem[]) => withKeys(work.map(lineOfWork));

export function DraftInvoice(p: { job: Job | undefined; inv: Invoice }) {
  const { inv, job } = p;
  const editable = canEditInvoiceOf(job);
  const rates = settings.value.taxes;
  const docLang = inv.lang === 'en' ? 'en' : 'fr';
  const items: JobItem[] = job ? itemsOf(job.id) : [];
  // a person who may change the job's work: their « Retirer » marks the work « Pas fait », and new work comes by itself
  const workEditable = !!job && jobOpen(job.status) && jobRights(job).act;
  const d = useDraft<DraftValue>(fromInvoice(inv), draftSig, async (v, base) => {
    const patch = draftPatch(v, base);
    if (patch) await saveInvoiceDraft(inv.id, patch);
  }, { busy: rowWaiting(waitingEntries(), 'invoices', inv.id), offline: !net.value.online, adopt: (s, shown) => ({ ...s, lines: keepKeys(s.lines, shown.lines) }) });
  const v = d.value;
  const tt = linesTotals(v.lines, rates, v.taxesOn);
  const [showErrors, setShowErrors] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [asking, setAsking] = useState<WorkItem[]>([]);
  const check = draftProblems(v.lines, tt.total);

  // the draft follows the work (and « Rabais de 10 % » its lines), on this phone at once, with or without signal
  const workSig = items.map((i) => `${i.id}.${i.status}.${i.updated_at || ''}`).join(',');
  const linesSig = JSON.stringify(v.lines.map((l) => [l.item_id, l.kind, l.description, l.qty, l.unit_cents]));
  useEffect(() => {
    if (!editable) return;
    let added: WorkItem[] = [];
    d.update((cur) => {
      const r = settleLines(cur.lines, items, { addNew: workEditable, madeAt: inv.created_at, percentWords: percentWords(), toLine: (i) => keyed([i])[0] });
      added = r.added;
      return r.lines === cur.lines ? cur : { ...cur, lines: r.lines };
    });
    if (added.length) toast(t('invoices.draft.addedWork', { what: added.map((i) => i.description).join(', ') }), { kind: 'ok' });
  }, [workSig, linesSig, editable, workEditable]);
  // work added to the job after the draft was made, for someone it does not come to by itself
  const newWork = editable && !workEditable ? workToAdd(v.lines, items, inv.created_at) : [];
  const addNewWork = () => d.update((cur) => ({ ...cur, lines: [...cur.lines, ...keyed(workToAdd(cur.lines, items, inv.created_at))] }));
  // paid by the customer (online, from the text) while the work goes on: it counts on the invoice once it is finished
  const ahead = aheadOf(job?.id);

  const doFinish = async () => {
    setAsking([]);
    const now = d.peek();
    const problem = draftProblems(now.lines, linesTotals(now.lines, rates, now.taxesOn).total).problem;
    if (problem) { setShowErrors(true); toast(t(`invoices.draft.problem.${problem}`), { kind: 'bad' }); return; }
    await d.flush();
    const r = await run(() => finishInvoice(inv.id));
    if (r && !r.queued) {
      const n = invoiceNumber({ number: r.data?.number ?? getRow<Invoice>('invoices', inv.id)?.number ?? null });
      // finished again after « Modifier la facture »: the customer may hold the old one
      const key = r.data?.again ? (inv.sent_at ? 'invoices.reopen.finishedAgain' : 'invoices.reopen.finishedAgainQuiet') : 'invoices.draft.finished';
      toast(t(key, { n }), { kind: 'ok' });
    }
  };
  const finish = async () => {
    const missing = workMissing(v.lines, items);
    if (missing.length) { setAsking(missing); return; }
    await doFinish();
  };
  const addAndFinish = async () => {
    d.update((cur) => ({ ...cur, lines: [...cur.lines, ...keyed(workMissing(cur.lines, items))] }));
    await doFinish();
  };
  // a line of the job's work taken off the invoice leaves the job too (« Pas fait »), while the job is coming or under way
  const removeWork = (line: EditLine) => {
    if (!workEditable || !line.item_id) return null;
    const it = getRow<JobItem>('job_items', line.item_id);
    if (!it || !isBillable(it)) return null;
    const was = it.status;
    void attempt(() => updateItem(it.id, { status: 'removed' }));
    return { undo: () => { void attempt(() => updateItem(it.id, { status: was })); } };
  };
  const refresh = async () => {
    if (!job) return;
    const r = await run(() => invoiceForJob(job.id, true), { ok: t('invoices.draft.refreshed') });
    const fresh = getRow<Invoice>('invoices', inv.id);
    if (r && !r.queued && fresh) d.reset(fromInvoice(fresh));
  };
  // a draft that holds a number (« Modifier la facture ») is an invoice the customer may have: it is never deleted
  const deletable = inv.number == null && canManageInvoices();
  const remove = async () => {
    const reason = await askText({ title: t('invoices.void.draftTitle'), text: t('invoices.void.draftText'), label: t('invoices.void.reason'), ok: t('invoices.void.draftOk'), danger: true });
    if (reason == null) return;
    await run(() => voidInvoice(inv.id, reason), { ok: t('invoices.void.draftDone') });
  };
  const l = lang.value;

  return (
    <Panel title={<>{t('invoices.panel.title')} <InvoicePill status="draft" /></>} help={t('invoices.draft.help')}
      data-testid="invoice-panel" class="inv-panel"
      action={editable ? <span class={`inv-saved inv-saved-${d.state}`} role="status" aria-live="polite" data-testid="draft-state">{t(`invoices.draft.state.${d.state}`)}</span> : undefined}>
      <div class="stack-lg">
        {!editable && <Banner kind="info">{t('invoices.draft.readOnly')}</Banner>}
        {inv.number != null && <Banner kind="info" data-testid="draft-reopened">{t('invoices.reopen.banner', { n: invoiceNumber(inv) })}</Banner>}
        {newWork.length > 0 && (
          <Banner kind="warn" title={t('invoices.draft.newWork', { n: newWork.length })} data-testid="draft-new-work">
            <span class="inv-new-work">{newWork.map((i) => i.description).join(', ')}</span>
            <Button variant="primary" onClick={addNewWork} data-testid="draft-add-new-work">{t('invoices.draft.addNewWork')}</Button>
          </Banner>
        )}
        {editable
          ? <LinesEditor lines={v.lines} onLines={(lines) => d.update((cur) => ({ ...cur, lines }))} docLang={docLang} errorLines={showErrors ? check.lines : []} onCatalog={() => setCatalog(true)} onRemoveWork={removeWork} />
          : <LinesView lines={v.lines} docLang={docLang} />}
        {editable && (
          <div class="stack">
            {rates.enabled !== false
              ? <Switch checked={v.taxesOn} onChange={(on) => d.update((cur) => ({ ...cur, taxesOn: on }))} label={t('invoices.draft.taxes')} hint={v.taxesOn ? undefined : t('invoices.draft.taxesOffHint')} data-testid="draft-taxes" />
              : <p class="muted small" style={{ margin: 0 }}>{t('invoices.draft.taxesOffSettings')}</p>}
            <Field label={t('invoices.draft.notes')} hint={t('invoices.draft.notesHint')} optional>
              <Textarea value={v.notes} onValue={(notes) => d.update((cur) => ({ ...cur, notes }))} rows={2} maxLength={1000} />
            </Field>
          </div>
        )}
        <div class="inv-totals">
          <Totals subtotal={tt.subtotal} tps={tt.tps} tvq={tt.tvq} total={tt.total} taxesOn={rates.enabled !== false && v.taxesOn} />
        </div>
        {ahead > 0 && (
          <Banner kind="ok" data-testid="draft-paid-ahead">
            {ahead > tt.total
              ? t('invoices.draft.paidAheadOver', { amount: money(ahead, l), over: money(ahead - tt.total, l) })
              : t(ahead >= tt.total ? 'invoices.draft.paidAheadAll' : 'invoices.draft.paidAhead', { amount: money(ahead, l), left: money(Math.max(0, tt.total - ahead), l) })}
          </Banner>
        )}
        {showErrors && check.problem && <Banner kind="bad">{t(`invoices.draft.problem.${check.problem}`)}</Banner>}
        {editable && (
          <div class="stack">
            <Button variant="primary" block icon={<Receipt />} onClick={finish} data-testid="invoice-finish">
              {t('invoices.draft.finish', { total: money(tt.total, l) })}
            </Button>
            <p class="muted small" style={{ margin: 0 }}>{t('invoices.draft.finishHint')}</p>
            <div class="inv-actions">
              {job && <Button variant="ghost" icon={<RotateCcw />} confirm={t('invoices.draft.refreshConfirm')} onClick={refresh} data-testid="invoice-refresh">{t('invoices.draft.refresh')}</Button>}
              {deletable && <Button variant="ghost" icon={<Ban />} onClick={remove} data-testid="draft-delete">{t('invoices.void.draftButton')}</Button>}
            </div>
          </div>
        )}
      </div>
      <CatalogSheet open={catalog} onClose={() => setCatalog(false)} docLang={docLang} onAdd={(add) => d.update((cur) => ({ ...cur, lines: [...cur.lines, ...add] }))} />
      <MissingWorkSheet work={asking} onClose={() => setAsking([])} onAdd={addAndFinish} onWithout={doFinish} />
    </Panel>
  );
}
