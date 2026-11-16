/* One invoice (#/invoice/:id). A finished one is shown as the document the customer gets (built from the same data
   as the PDF, in the customer's language), with the PAYÉ stamp; beside it: what is left to pay, « Encaisser »,
   « Envoyer par texto », « Relancer », PDF, its payments (the office can remove one), the texts sent, « Trop-perçu »
   with « Rembourser », and « Annuler la facture ». A draft opens the editor of the job sheet; a draft whose
   « Terminer la facture » waits for the network is shown finished (number to come). */
import { useRef, useState } from 'preact/hooks';
import { Send, BellRing, FileDown, Banknote, Wrench, Ban } from 'lucide-preact';
import type { ScreenProps } from '../../platform/router';
import type { Invoice, Payment } from '../../data/types';
import { job as jobRow, vehicle, settings, invoiceNumber } from '../../data/select';
import { removePayment, voidInvoice } from '../../data/api';
import { net } from '../../data/sync';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { stamp as stampText } from '../../lib/dates';
import { Page, Panel, Button, Banner, Empty, Skeleton, InvoicePill, Rows, RowItem, askText, run, toast } from '../../ui';
import { invoicePdfData } from '../../domain/money/document';
import { viewOf, type InvoiceView } from '../../domain/money/view';
import { waitingEntries, paymentsWaiting, finishEntries, waitingForNetwork } from '../../domain/money/waiting';
import { invoiceById, paymentsOfInvoice, invoiceCustomer, invoiceWho, canEditInvoiceOf, canManageInvoices, methodWord, invoiceTexts } from '../../shared/invoices/select';
import { DraftInvoice, PaymentsList, ReopenButton } from '../../shared/invoices/InvoicePanel';
import { OverBanner, UnbilledBanner, PayWaitingBanner } from '../../shared/invoices/InvoiceBanners';
import { PaySheet } from '../../shared/invoices/PaySheet';
import { sendText, SendSheet, type SendResult } from '../../shared/invoices/send';
import { usePdf } from '../../shared/invoices/usePdf';
import { InvoiceDocument } from './InvoiceDocument';
import '../../shared/invoices/invoices.css';

export default function InvoiceScreen({ params }: ScreenProps) {
  const inv = invoiceById(params.id);
  if (!inv) {
    return (
      <Page title={t('invoices.invoice')} back="/invoices">
        {net.value.ready
          ? <Panel><Empty title={t('invoices.screen.missing')} text={t('invoices.screen.missingText')} action={<Button variant="primary" href="#/invoices">{t('invoices.screen.toList')}</Button>} /></Panel>
          : <Panel><Skeleton h={28} lines={5} /></Panel>}
      </Page>
    );
  }
  const view = viewOf(inv);
  if (inv.status === 'draft' && !view.finishing) return <DraftScreen inv={inv} />;
  return <DocScreen view={view} />;
}

function DraftScreen(p: { inv: Invoice }) {
  const j = jobRow(p.inv.job_id);
  return (
    <Page title={t('invoices.draftTitle')} sub={invoiceWho(p.inv)} back="/invoices"
      actions={j ? <Button icon={<Wrench />} href={`#/job/${j.id}`}>{t('invoices.screen.toJob', { n: j.number })}</Button> : undefined}>
      <DraftInvoice job={j} inv={p.inv} />
    </Page>
  );
}

function DocScreen(p: { view: InvoiceView }) {
  const { view } = p;
  const inv = view.inv;
  const l = lang.value;
  const j = jobRow(inv.job_id);
  const a = view.amounts;
  const pays = paymentsOfInvoice(inv.id);
  const waiting = paymentsWaiting(waitingEntries(), { invoiceId: inv.id, jobId: inv.job_id });
  const number = invoiceNumber(inv);
  const who = invoiceWho(inv);
  const editable = canEditInvoiceOf(j);
  const manage = canManageInvoices();
  // « Terminer la facture » waits for the network: nothing that needs the number (texts, PDF, cancel, reopen) yet
  const finishing = view.finishing;
  const offlineFinish = finishing && waitingForNetwork(finishEntries(waitingEntries(), inv.id), net.value.online).length > 0;
  const [sheet, setSheet] = useState<'pay' | 'refund' | null>(null);
  const [manual, setManual] = useState<SendResult | null>(null);
  const pdf = usePdf();
  const prev = useRef(inv.status);
  const landed = useRef(false);
  if (prev.current !== inv.status) { if (inv.status === 'paid') landed.current = true; prev.current = inv.status; }

  const data = invoicePdfData({ invoice: inv, customer: invoiceCustomer(inv), vehicle: vehicle(j?.vehicle_id), km: j?.odometer_km, payments: pays, settings: settings.value });
  const send = async (kind: 'invoice' | 'payment_reminder') => {
    if (!inv.job_id) return;
    const r = await sendText(kind, inv.job_id, kind === 'invoice' && inv.status === 'paid' ? t('invoices.send.receiptSent') : undefined);
    if (r) setManual(r);
  };
  const cancel = async () => {
    if (pays.length) { toast(t('invoices.void.hasPayments'), { kind: 'bad' }); return; }
    const reason = await askText({ title: t('invoices.void.title', { n: number }), text: t('invoices.void.text'), label: t('invoices.void.reason'), ok: t('invoices.void.ok'), danger: true });
    if (reason == null) return;
    await run(() => voidInvoice(inv.id, reason), { ok: t('invoices.void.done', { n: number }) });
  };
  const remove = (x: Payment) => run(() => removePayment(x.id), { ok: t('invoices.payments.removed') });
  const texts = invoiceTexts(inv.job_id);
  const lastPay = pays[pays.length - 1];

  return (
    <Page title={<>{t('invoices.invoice')} <span class="nowrap">{number}</span></>} sub={who} back="/invoices" wide
      actions={finishing ? undefined : <Button icon={<FileDown />} onClick={() => pdf.make(() => data)} data-testid="invoice-pdf">{t('invoices.screen.pdf')}</Button>}>
      <div class="inv-doc-layout">
        <InvoiceDocument d={data} animate={landed.current} />

        <aside class="inv-side">
          <Panel class="inv-side-summary" data-testid="invoice-summary">
            <div class="stack">
              {offlineFinish && <Banner kind="warn">{t('invoices.draft.waiting')}</Banner>}
              <div class="inv-hero">
                <span class="inv-hero-label row-wrap">
                  {inv.status === 'issued' && a.paid > 0 ? t('invoices.screen.balance') : t('invoices.screen.total')}
                  <InvoicePill status={inv.status} paidCents={inv.paid_cents} />
                </span>
                <span class="inv-hero-amount money" data-testid="invoice-balance">{money(inv.status === 'issued' ? a.balance : a.total, l)}</span>
                <span class="muted small">
                  {inv.status === 'void' ? (inv.void_reason ? t('invoices.screen.voidedOn', { when: stampText(inv.voided_at, l), reason: inv.void_reason }) : t('invoices.screen.voidedAt', { when: stampText(inv.voided_at, l) }))
                    : inv.status === 'paid' && lastPay ? t('invoices.panel.paidOn', { when: stampText(lastPay.paid_at, l), how: [...new Set(pays.map((x) => methodWord(x.method, l)))].join(', ') })
                      : a.paid > 0 ? t('invoices.screen.partial', { paid: money(a.paid, l), total: money(a.total, l) })
                        : inv.issued_at ? t('invoices.screen.issuedOn', { when: stampText(inv.issued_at, l) }) : null}
                </span>
              </div>
              <OverBanner over={view.over} canRefund={editable && !finishing} onRefund={() => setSheet('refund')} />
              <UnbilledBanner inv={inv} job={j} />
              {inv.status === 'issued' && editable && (view.due > 0
                ? <Button variant="primary" block class="inv-pay-btn" icon={<Banknote />} onClick={() => setSheet('pay')} data-tour="invoice-pay" data-testid="invoice-pay">
                  {t('invoices.panel.pay', { amount: money(view.due, l) })}
                </Button>
                : view.waiting > 0 && <PayWaitingBanner cents={view.waiting} />)}
              {inv.status === 'issued' && !finishing && <ReopenButton inv={inv} job={j} block variant="ghost" />}
              {inv.status !== 'void' && inv.job_id && !finishing && (
                <div class="inv-actions">
                  <Button icon={<Send />} onClick={() => send('invoice')} data-tour="invoice-send" data-testid="invoice-send">
                    {inv.status === 'paid' ? t('invoices.panel.sendReceipt') : t('invoices.panel.send')}
                  </Button>
                  {inv.status === 'issued' && <Button icon={<BellRing />} onClick={() => send('payment_reminder')} data-testid="invoice-remind">{t('invoices.screen.remind')}</Button>}
                </div>
              )}
              {inv.status === 'void' && <Banner kind="info">{t('invoices.screen.voidHelp')}</Banner>}
              {j && <Button variant="ghost" icon={<Wrench />} href={`#/job/${j.id}`} data-testid="invoice-job">{t('invoices.screen.toJob', { n: j.number })}</Button>}
            </div>
          </Panel>

          {(pays.length > 0 || waiting.length > 0) && (
            <Panel title={t('invoices.payments.title')} class="inv-side-pays">
              <PaymentsList bare pays={pays} waiting={waiting} onRemove={manage && inv.status !== 'void' ? remove : undefined}
                canRemove={(x) => x.method !== 'card_online'} />
              {manage && pays.some((x) => x.method === 'card_online') && <p class="muted small" style={{ margin: 'var(--sp-2) 0 0' }}>{t('invoices.payments.onlineNote')}</p>}
            </Panel>
          )}

          {(inv.sent_at || texts.length > 0) && (
            <Panel title={t('invoices.screen.history')} class="inv-history inv-side-history">
              <Rows>
                {texts.map((m) => (
                  <RowItem key={m.id} title={t(`invoices.screen.text.${m.kind === 'payment_reminder' ? 'reminder' : 'invoice'}`)}
                    sub={`${stampText(m.created_at, l)}${m.status !== 'sent' ? `, ${t('invoices.screen.textNotSent')}` : ''}`} />
                ))}
                {!texts.length && inv.sent_at && <RowItem title={t('invoices.screen.text.invoice')} sub={stampText(inv.sent_at, l)} />}
              </Rows>
            </Panel>
          )}

          {inv.status === 'issued' && !finishing && manage && (
            <Panel class="inv-side-void">
              <div class="stack">
                <Button variant="danger" icon={<Ban />} onClick={cancel} data-testid="invoice-void">{t('invoices.void.button')}</Button>
                <p class="muted small" style={{ margin: 0 }}>{pays.length ? t('invoices.void.hasPayments') : t('invoices.void.hint')}</p>
              </div>
            </Panel>
          )}
        </aside>
      </div>
      <PaySheet open={sheet != null} refund={sheet === 'refund'} onClose={() => setSheet(null)} invoiceId={inv.id} />
      <SendSheet result={manual} onClose={() => setManual(null)} />
      {pdf.sheet}
    </Page>
  );
}
