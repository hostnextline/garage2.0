/* One invoice (#/invoice/:id). A finished one is shown as the document the customer gets (built from the same data
   as the PDF, in the customer's language), with the PAYÉ stamp; beside it: what is left to pay, « Encaisser »,
   « Envoyer par texto », « Relancer », PDF, its payments (the office can remove one), the texts sent, and
   « Annuler la facture ». A draft opens the editor of the job sheet. */
import { useRef, useState } from 'preact/hooks';
import { Send, BellRing, FileDown, Banknote, Wrench, Ban } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import type { Invoice, Payment } from '../../data/types';
import { job as jobRow, vehicle, settings, invoiceNumber } from '../../data/select';
import { removePayment, voidInvoice } from '../../data/api';
import { net } from '../../data/sync';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { stamp as stampText } from '../../lib/dates';
import { Page, Panel, Button, Banner, Empty, Skeleton, InvoicePill, Rows, RowItem, askText, run, toast } from '../../ui';
import { invoiceById, paymentsOfInvoice, amountsOf, invoiceCustomer, invoiceWho, canEditInvoiceOf, canManageInvoices, methodWord, invoiceTexts } from './select';
import { invoicePdfData, type PdfData } from './pdf';
import { DraftInvoice, PaymentsList, ReopenButton } from './InvoicePanel';
import { PaySheet } from './PaySheet';
import { sendText, SendSheet, type SendResult } from './send';
import { usePdf } from './usePdf';
import './invoices.css';

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
  if (inv.status === 'draft') return <DraftScreen inv={inv} />;
  return <DocScreen inv={inv} />;
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

function DocScreen(p: { inv: Invoice }) {
  const { inv } = p;
  const l = lang.value;
  const j = jobRow(inv.job_id);
  const a = amountsOf(inv);
  const pays = paymentsOfInvoice(inv.id);
  const number = invoiceNumber(inv);
  const who = invoiceWho(inv);
  const editable = canEditInvoiceOf(j);
  const manage = canManageInvoices();
  const [payOpen, setPayOpen] = useState(false);
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
      actions={<Button icon={<FileDown />} onClick={() => pdf.make(() => data)} data-testid="invoice-pdf">{t('invoices.screen.pdf')}</Button>}>
      <div class="inv-doc-layout">
        <InvoiceDocument d={data} animate={landed.current} />

        <aside class="inv-side">
          <Panel class="inv-side-summary" data-testid="invoice-summary">
            <div class="stack">
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
                        : t('invoices.screen.issuedOn', { when: stampText(inv.issued_at, l) })}
                </span>
              </div>
              {inv.status === 'issued' && editable && (
                <Button variant="primary" block class="inv-pay-btn" icon={<Banknote />} onClick={() => setPayOpen(true)} data-tour="invoice-pay" data-testid="invoice-pay">
                  {t('invoices.panel.pay', { amount: money(a.balance, l) })}
                </Button>
              )}
              {inv.status === 'issued' && <ReopenButton inv={inv} job={j} block variant="ghost" />}
              {inv.status !== 'void' && inv.job_id && (
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

          {pays.length > 0 && (
            <Panel title={t('invoices.payments.title')} class="inv-side-pays">
              <PaymentsList bare pays={pays} onRemove={manage && inv.status !== 'void' ? remove : undefined}
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

          {inv.status === 'issued' && manage && (
            <Panel class="inv-side-void">
              <div class="stack">
                <Button variant="danger" icon={<Ban />} onClick={cancel} data-testid="invoice-void">{t('invoices.void.button')}</Button>
                <p class="muted small" style={{ margin: 0 }}>{pays.length ? t('invoices.void.hasPayments') : t('invoices.void.hint')}</p>
              </div>
            </Panel>
          )}
        </aside>
      </div>
      <PaySheet open={payOpen} onClose={() => setPayOpen(false)} invoiceId={inv.id} />
      <SendSheet result={manual} onClose={() => setManual(null)} />
      {pdf.sheet}
    </Page>
  );
}

/** the invoice as the customer reads it (the same words and numbers as its PDF) */
export function InvoiceDocument(p: { d: PdfData; animate?: boolean }) {
  const d = p.d;
  return (
    <article class="panel glass inv-doc" lang={d.lang === 'en' ? 'en-CA' : 'fr-CA'} aria-label={d.docTitle} data-testid="invoice-document">
      <header class="inv-doc-head">
        <div class="inv-doc-garage">
          <img src="./logo-his.png" alt="" width="52" height="52" />
          <div>
            <b>{d.garage.name}</b>
            {d.garage.lines.map((x, i) => <span key={i}>{x}</span>)}
          </div>
        </div>
        <div class="inv-doc-title">
          <h2>{d.title}</h2>
          {d.number && <span class="inv-doc-no">{d.number}</span>}
          {d.meta.map(([k, v]) => <span key={k}>{k}{d.lang === 'en' ? ': ' : ' : '}{v}</span>)}
        </div>
      </header>
      {(d.to || d.vehicle) && (
        <div class="inv-doc-parties">
          {d.to && <div><span class="inv-doc-label">{d.to.title}</span><p>{d.to.lines.map((x, i) => <span key={i}>{x}<br /></span>)}</p></div>}
          {d.vehicle && <div><span class="inv-doc-label">{d.vehicle.title}</span><p>{d.vehicle.text}</p></div>}
        </div>
      )}
      <table class="inv-table">
        <thead><tr>
          <th scope="col">{d.head[0]}</th><th scope="col" class="num-col col-qty">{d.head[1]}</th>
          <th scope="col" class="num-col col-price">{d.head[2]}</th><th scope="col" class="num-col">{d.head[3]}</th>
        </tr></thead>
        <tbody>
          {d.rows.map((r, i) => (
            <tr key={i}>
              <td>{r[0]}{r[1] !== '1' && <span class="inv-td-sub qty-sub">{r[1]} × {r[2]}</span>}</td>
              <td class="num-col col-qty">{r[1]}</td><td class="num-col col-price">{r[2]}</td><td class="num-col">{r[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.taxNote && <p class="muted small" style={{ margin: 'var(--sp-2) 0 0' }}>{d.taxNote}</p>}
      <div class="inv-doc-bottom">
        <div class="inv-doc-left">
          {d.stamp && (
            <span class={`stamp inv-doc-stamp${d.stamp.tone === 'void' ? ' stamp-muted' : ''}${p.animate && d.stamp.tone === 'paid' ? ' stamp-land' : ''}`}
              role="img" aria-label={d.stamp.text} data-testid={`stamp-${d.stamp.tone}`}>{d.stamp.text}</span>
          )}
          {d.payments && (
            <div>
              <span class="inv-doc-label">{d.payments.title}</span>
              {d.payments.rows.map(([k, v], i) => <p key={i} class="inv-doc-notes between row"><span>{k}</span><span class="money">{v}</span></p>)}
            </div>
          )}
          {d.notes && <div><span class="inv-doc-label">{d.notes.title}</span><p class="inv-doc-notes">{d.notes.text}</p></div>}
        </div>
        <div class="totals">
          {d.totals.map((r, i) => [
            <span key={`l${i}`} class={r.strong ? 'total' : undefined}>{r.label}</span>,
            <span key={`v${i}`} class={`money${r.strong ? ' total' : ''}`}>{r.value}</span>
          ])}
        </div>
      </div>
      {d.footer.length > 0 && <footer class="inv-doc-foot">{d.footer.map((x, i) => <p key={i}>{x}</p>)}</footer>}
    </article>
  );
}
