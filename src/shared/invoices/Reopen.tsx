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
    An invoice paid MORE than its total (« Trop-perçu ») opens again too, since the owner's rule of 2026-11-20: a
    numbered draft under what was paid is finished « paid » (invoice_finish answers over_cents, after the app's question),
    so it never stays a draft. Before, it was hidden until the office gave the money back (review invoices-r2-1), and
    work added after that payment could not be billed: the job could not be « Terminé » (unbilled) until the office acted. */
export function mayReopen(inv: Invoice | undefined, job: Job | undefined): boolean {
  return !!inv && (inv.status === 'issued' || inv.status === 'paid') && !!job && jobOpen(job.status) && canEditInvoiceOf(job)
    && !finishWaiting(waitingEntries(), inv.id);
}
export function ReopenButton(p: { inv: Invoice; job: Job | undefined; block?: boolean; variant?: 'primary' | 'ghost' }) {
  if (!mayReopen(p.inv, p.job)) return null;
  const go = () => run(() => reopenInvoice(p.inv.id), { ok: t('invoices.reopen.done', { n: invoiceNumber(p.inv) }) });
  return <Button block={p.block} variant={p.variant} icon={<PencilLine />} confirm={t('invoices.reopen.confirm')} onClick={go} data-testid="invoice-reopen">{t('invoices.reopen.button')}</Button>;
}
