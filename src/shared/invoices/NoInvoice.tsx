/* No invoice yet: what the job's work is worth (« Total prévu », taxes included) and « Faire la facture ». The last
   cancelled invoice of the job is named above it. */
import { FileText } from 'lucide-preact';
import type { Job } from '../../data/types';
import { jobTotals, itemsOf, invoiceNumber } from '../../data/select';
import { invoiceForJob } from '../../data/api';
import { net } from '../../data/sync';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { Panel, Button, Banner, run } from '../../ui';
import { isBillable } from '../../domain/money/draft';
import { waitingEntries, makeWaiting, waitingForNetwork } from '../../domain/money/waiting';
import { voidedOf, canEditInvoiceOf } from './select';

export function NoInvoice(p: { job: Job }) {
  const tt = jobTotals(p.job.id);
  const hasWork = itemsOf(p.job.id).some(isBillable);
  const editable = canEditInvoiceOf(p.job);
  const old = voidedOf(p.job.id);
  const waiting = waitingForNetwork(makeWaiting(waitingEntries(), p.job.id), net.value.online);
  // p_refresh false: a « Faire la facture » sent late (no signal) never rewrites a draft someone edited meanwhile (R52)
  const make = () => run(() => invoiceForJob(p.job.id, false), { ok: t('invoices.panel.made') });
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
