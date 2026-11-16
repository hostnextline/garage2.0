/* « Modifier la facture »: a finished invoice not paid goes back to a draft with the same number (its payments wait
   on the job, then come back at the next finish). Shown on the invoice panel, the invoice screen and the sheet of a
   billed work line (jobs). Who may: as the server (invoice_editable), while the job is coming or under way. */
import { PencilLine } from 'lucide-preact';
import type { Invoice, Job } from '../../data/types';
import { invoiceNumber } from '../../data/select';
import { reopenInvoice } from '../../data/api';
import { t } from '../../lib/i18n';
import { Button, run } from '../../ui';
import { jobOpen } from '../../domain/money/draft';
import { canEditInvoiceOf } from './select';

export function mayReopen(inv: Invoice | undefined, job: Job | undefined): boolean {
  return !!inv && inv.status === 'issued' && !!job && jobOpen(job.status) && canEditInvoiceOf(job);
}
export function ReopenButton(p: { inv: Invoice; job: Job | undefined; block?: boolean; variant?: 'primary' | 'ghost' }) {
  if (!mayReopen(p.inv, p.job)) return null;
  const go = () => run(() => reopenInvoice(p.inv.id), { ok: t('invoices.reopen.done', { n: invoiceNumber(p.inv) }) });
  return <Button block={p.block} variant={p.variant} icon={<PencilLine />} confirm={t('invoices.reopen.confirm')} onClick={go} data-testid="invoice-reopen">{t('invoices.reopen.button')}</Button>;
}
