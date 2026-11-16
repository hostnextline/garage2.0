/* The invoice part of a job sheet (shared: the jobs section shows it). It shows the invoice as this phone sees it
   (domain/money/view.ts): no invoice yet, a draft to change and finish, or a finished one to collect and send.
   Who may change it mirrors the server (invoice_editable): the office, or the mechanic of the job. */
import { job as jobRow, invoiceOf } from '../../data/select';
import { t } from '../../lib/i18n';
import { Panel, Banner } from '../../ui';
import { viewOf } from '../../domain/money/view';
import { waitingEntries, coffreWaiting } from '../../domain/money/waiting';
import { NoInvoice } from './NoInvoice';
import { DraftInvoice } from './DraftInvoice';
import { FinishedInvoice } from './FinishedInvoice';
import './invoices.css';

export { ReopenButton, mayReopen } from './Reopen';
export { DraftInvoice } from './DraftInvoice';
export { PaymentsList } from './PaymentsList';

export interface InvoicePanelProps { jobId: string }

export function InvoicePanel(p: InvoicePanelProps) {
  const j = jobRow(p.jobId);
  const inv = invoiceOf(p.jobId);
  if (!j) return <Panel title={t('invoices.panel.title')}><p class="muted" style={{ margin: 0 }}>{t('invoices.panel.noJob')}</p></Panel>;
  if (j.coffre_id) return <Panel title={t('invoices.panel.title')} data-testid="invoice-panel" class="inv-panel"><Banner kind="info">{t('coffre.job.banner')}</Banner></Panel>;
  // « Payé par le Coffre » tapped with no signal: settled on this phone, nothing to invoice or collect meanwhile
  if (coffreWaiting(waitingEntries(), j.id)) return <Panel title={t('invoices.panel.title')} data-testid="invoice-panel" class="inv-panel"><Banner kind="info">{t('invoices.panel.coffreWaiting')}</Banner></Panel>;
  if (!inv) return <NoInvoice job={j} />;
  const view = viewOf(inv);
  if (inv.status === 'draft' && !view.finishing) return <DraftInvoice key={inv.id} job={j} inv={inv} />;
  return <FinishedInvoice key={inv.id} job={j} view={view} />;
}
