/* « Modifier la facture »: a finished invoice, paid or not, goes back to a draft with the same number (its payments
   wait on the job, then come back at the next finish). Shown on the invoice panel, the invoice screen and the sheet of
   a billed work line (jobs). Who may: as the server (invoice_reopen, invoice_editable), while the job is coming or
   under way: work added after the customer paid can then be billed. */
import { PencilLine } from 'lucide-preact';
import type { Invoice, Job } from '../../data/types';
import { invoiceNumber } from '../../data/select';
import { reopenInvoice } from '../../data/api';
import { t } from '../../lib/i18n';
import { Button, run } from '../../ui';
import { jobOpen } from '../../domain/money/draft';
import { waitingEntries, finishWaiting } from '../../domain/money/waiting';
import { canEditInvoiceOf } from './select';

/** never while its « Terminer la facture » still waits on this phone: the server still has a draft (and refuses).
    Never on an invoice paid MORE than its total (« Trop-perçu »): reopened, its draft would hold more money than it
    costs and could not be finished again (invoice_finish refuses below_paid on a numbered draft), so it would stay a
    draft until the office records the refund or cancels it. The office gives the money back first (review invoices-r2-1). */
export function mayReopen(inv: Invoice | undefined, job: Job | undefined): boolean {
  return !!inv && (inv.status === 'issued' || inv.status === 'paid') && !!job && jobOpen(job.status) && canEditInvoiceOf(job)
    && Number(inv.paid_cents || 0) <= Number(inv.total_cents || 0)
    && !finishWaiting(waitingEntries(), inv.id);
}
export function ReopenButton(p: { inv: Invoice; job: Job | undefined; block?: boolean; variant?: 'primary' | 'ghost' }) {
  if (!mayReopen(p.inv, p.job)) return null;
  const go = () => run(() => reopenInvoice(p.inv.id), { ok: t('invoices.reopen.done', { n: invoiceNumber(p.inv) }) });
  return <Button block={p.block} variant={p.variant} icon={<PencilLine />} confirm={t('invoices.reopen.confirm')} onClick={go} data-testid="invoice-reopen">{t('invoices.reopen.button')}</Button>;
}
