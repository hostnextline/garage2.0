/* A finished invoice in the job sheet: read-only lines and totals, its payments (and those waiting on this phone),
   « Encaisser » what is left, « Modifier la facture », « Envoyer par texto », PDF, « Annuler la facture », the PAYÉ
   stamp (it lands only when the invoice becomes paid in front of the person), « Trop-perçu » with « Rembourser ».
   It is also the invoice whose « Terminer la facture » waits for the network: shown finished, number to come, and
   « Encaisser » works (the payment waits behind the finish). */
import { useRef, useState } from 'preact/hooks';
import { Send, FileDown, Ban, Banknote } from 'lucide-preact';
import type { Invoice, Job } from '../../data/types';
import { settings, invoiceNumber, vehicle } from '../../data/select';
import { voidInvoice } from '../../data/api';
import { net } from '../../data/sync';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { stamp as stampText } from '../../lib/dates';
import { Panel, Button, Banner, Totals, InvoicePill, Stamp, askText, run, toast } from '../../ui';
import { invoicePdfData } from '../../domain/money/document';
import { waitingEntries, unsentPayments, finishEntries, waitingForNetwork } from '../../domain/money/waiting';
import { mayRefund } from '../../domain/money/pay';
import type { InvoiceView } from '../../domain/money/view';
import { paymentsOfInvoice, canEditInvoiceOf, canManageInvoices, methodWord, invoiceCustomer } from './select';
import { ReopenButton } from './Reopen';
import { OverBanner, UnbilledBanner, PayWaitingBanner } from './InvoiceBanners';
import { PaymentsList } from './PaymentsList';
import { LinesView } from './LinesView';
import { PaySheet } from './PaySheet';
import { sendText, SendSheet, type SendResult } from './send';
import { usePdf } from './usePdf';

export function FinishedInvoice(p: { job: Job; view: InvoiceView }) {
  const { job, view } = p;
  const inv: Invoice = view.inv;
  const a = view.amounts;
  const l = lang.value;
  const pays = paymentsOfInvoice(inv.id);
  const waiting = unsentPayments({ invoiceId: inv.id, jobId: inv.job_id });
  const editable = canEditInvoiceOf(job);
  // money given back (« Rembourser ») and « Annuler la facture »: the office only, as the server (payment_add, invoice_void)
  const manage = canManageInvoices();
  const [sheet, setSheet] = useState<'pay' | 'refund' | null>(null);
  const [manual, setManual] = useState<SendResult | null>(null);
  const pdf = usePdf();
  // the stamp lands only when the invoice becomes paid in front of the person
  const prev = useRef(inv.status);
  const landed = useRef(false);
  if (prev.current !== inv.status) { if (inv.status === 'paid') landed.current = true; prev.current = inv.status; }
  const paid = inv.status === 'paid';
  const number = invoiceNumber(inv);
  // « Terminer la facture » waits for the network: nothing that needs the number (texts, PDF, cancel, reopen) yet
  const finishing = view.finishing;
  const offlineFinish = finishing && waitingForNetwork(finishEntries(waitingEntries(), inv.id), net.value.online).length > 0;
  const send = async () => { const r = await sendText('invoice', job.id, paid ? t('invoices.send.receiptSent') : undefined); if (r) setManual(r); };
  const makePdf = () => pdf.make(() => invoicePdfData({ invoice: inv, customer: invoiceCustomer(inv), vehicle: vehicle(job.vehicle_id), km: job.odometer_km, payments: pays, settings: settings.value }));
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
        {offlineFinish && <Banner kind="warn">{t('invoices.draft.waiting')}</Banner>}
        {paid && (
          <div class="inv-paid-row">
            <Stamp kind="paid" animate={landed.current} />
            {pays.length > 0 && <p>{t('invoices.panel.paidOn', { when: stampText(pays[pays.length - 1].paid_at, l), how: [...new Set(pays.map((x) => methodWord(x.method, l)))].join(', ') })}</p>}
          </div>
        )}
        <UnbilledBanner inv={inv} job={job} finishing={finishing} />
        <LinesView lines={inv.lines || []} docLang={inv.lang} />
        <div class="inv-totals">
          <Totals subtotal={a.subtotal} tps={a.tps} tvq={a.tvq} total={a.total} paid={a.paid} taxesOn={a.showTaxes} />
        </div>
        {(pays.length > 0 || waiting.length > 0) && <PaymentsList pays={pays} waiting={waiting} />}
        <OverBanner over={view.over} office={manage} canRefund={manage && mayRefund(view)} onRefund={() => setSheet('refund')} />
        {inv.status === 'issued' && (
          <div class="stack">
            {!editable
              ? <p class="muted small" style={{ margin: 0 }}>{t('invoices.panel.payNotYours')}</p>
              : view.due > 0
                ? <Button variant="primary" block class="inv-pay-btn" icon={<Banknote />} onClick={() => setSheet('pay')} data-tour="job-pay" data-testid="invoice-pay">
                  {t('invoices.panel.pay', { amount: money(view.due, l) })}
                </Button>
                : view.waitingIn > 0 && <PayWaitingBanner cents={view.waitingIn} />}
            {!finishing && <ReopenButton inv={inv} job={job} block />}
          </div>
        )}
        {/* paid, the job still coming or under way: work added after the customer paid can be billed (R42) */}
        {paid && !finishing && <ReopenButton inv={inv} job={job} block />}
        {!finishing && (
          <div class="inv-actions">
            <Button icon={<Send />} onClick={send} data-testid="invoice-send">{paid ? t('invoices.panel.sendReceipt') : t('invoices.panel.send')}</Button>
            <Button icon={<FileDown />} onClick={makePdf} data-testid="invoice-pdf">{paid ? t('invoices.panel.pdfReceipt') : t('invoices.panel.pdf')}</Button>
            <Button variant="ghost" href={`#/invoice/${inv.id}`}>{t('invoices.panel.open')}</Button>
          </div>
        )}
        {inv.status === 'issued' && !finishing && manage && (
          <Button variant="danger" icon={<Ban />} onClick={cancel} class="inv-void-btn" data-testid="invoice-void">{t('invoices.void.button')}</Button>
        )}
      </div>
      <PaySheet open={sheet != null} refund={sheet === 'refund'} onClose={() => setSheet(null)} invoiceId={inv.id} />
      <SendSheet result={manual} onClose={() => setManual(null)} />
      {pdf.sheet}
    </Panel>
  );
}
