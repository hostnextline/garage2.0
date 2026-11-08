/* « Encaisser » (shared: the job sheet opens it too). Made for the customer's door: gloves, a customer watching.
   The balance is the hero; the payment method is one big tap; cash shows the change to give back (rounded to 5 ¢,
   no pennies) and records only what is due; a card payment link can be texted when the garage has card payments. */
import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Banknote, CreditCard, Landmark, Send, FileText, Ellipsis, Smartphone, Vault } from 'lucide-preact';
import type { PayMethod } from '../../data/types';
import { addPayment, team } from '../../data/api';
import { isOwner, access } from '../../data/auth';
import { customerName, job as jobRow } from '../../data/select';
import { mayCoffre, openCoffre } from '../coffre/host';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { Sheet, Button, Field, Input, MoneyInput, Banner, Empty, run } from '../../ui';
import { cashChange, cashQuick } from './logic';
import { invoiceById, amountsOf, invoiceCustomer, invoiceLabel, methodWord, METHODS } from './select';
import { sendText, SendSheet, type SendResult } from './send';
import './invoices.css';

export interface PaySheetProps { open: boolean; onClose: () => void; invoiceId: string; onPaid?: () => void; /** after the sheet closes for « Coffre » (else the shell opens the Coffre sheet itself) */ onCoffre?: () => void;
  /** « Rembourser »: money given back to a customer who paid more than the invoice (a negative payment) */ refund?: boolean }

const ICONS: Record<string, typeof Banknote> = { cash: Banknote, debit: Landmark, credit: CreditCard, interac: Send, cheque: FileText, other: Ellipsis };

/* card payments online: everyone's access says whether they are switched on (my_access → card_online);
   an older copy of the access without that answer asks the server (owner only) */
type StripeState = 'unknown' | 'on' | 'off';
const stripe = signal<StripeState | null>(null);
async function checkStripe() {
  const known = access.value?.card_online;
  if (typeof known === 'boolean') { stripe.value = known ? 'on' : 'off'; return; }
  if (!isOwner()) { stripe.value = 'unknown'; return; }
  try {
    const r = await team<{ stripe?: { on?: boolean } }>('secrets');
    stripe.value = r.ok && r.stripe ? (r.stripe.on ? 'on' : 'off') : 'unknown';
  } catch { if (stripe.value == null) stripe.value = 'unknown'; }
}

export function PaySheet(p: PaySheetProps) {
  if (!p.open) return null;
  return <PayOpen {...p} />;
}

function PayOpen(p: PaySheetProps) {
  const inv = invoiceById(p.invoiceId);
  const a = inv ? amountsOf(inv) : null;
  const refund = !!p.refund;
  // the amount in play: what is left to pay, or (refund) what was paid too much
  const balance = refund ? (a?.over ?? 0) : (a?.balance ?? 0);
  const [amount, setAmount] = useState<number | null>(balance);
  const [touched, setTouched] = useState(false);
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [received, setReceived] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [manual, setManual] = useState<SendResult | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => { void checkStripe(); }, []);
  // a payment that arrives meanwhile (card online, another phone) changes the balance: follow it until edited
  useEffect(() => { if (!touched) setAmount(balance); }, [balance]);

  const close = p.onClose;
  const l = lang.value;
  const who = inv ? customerName(invoiceCustomer(inv)) : '';
  const title = refund ? t('invoices.pay.refund.title') : t('invoices.pay.title');
  if (!inv || !a) {
    return <Sheet open onClose={close} title={title}><Empty title={t('invoices.pay.missing')} text={t('invoices.pay.missingText')} /></Sheet>;
  }
  const sub = who ? t('invoices.pay.sub', { n: invoiceLabel(inv, l), who }) : t('invoices.numbered', { n: invoiceLabel(inv, l) });
  // (while a payment is being sent, its own rows arrive just before the sheet closes: keep the form)
  if (!sending && (refund ? balance <= 0 : (inv.status !== 'issued' || balance <= 0))) {
    const kind = refund ? 'refund' : inv.status === 'draft' ? 'draft' : inv.status === 'void' ? 'void' : 'paid';
    return (
      <Sheet open onClose={close} title={title} sub={sub} footer={<Button variant="primary" onClick={close}>{t('common.close')}</Button>} data-testid="pay-sheet">
        <Banner kind={kind === 'paid' || kind === 'refund' ? 'ok' : 'warn'}>{kind === 'refund' ? t('invoices.pay.refund.none') : t(`invoices.pay.not.${kind}`)}</Banner>
      </Sheet>
    );
  }

  const isCash = method === 'cash';
  const cash = isCash && !refund ? cashChange(amount ?? 0, received) : null;
  const record = cash ? cash.record : amount ?? 0;
  const amountError = amount == null || amount <= 0 ? t('invoices.pay.errAmount') : amount > balance ? t('invoices.pay.errTooMuch', { max: money(balance, l) }) : null;
  const canPay = !!method && !amountError && record > 0;
  const needsRef = method === 'cheque' || method === 'interac' || method === 'other';

  const pay = async () => {
    if (!canPay || !method) return;
    const change = cash?.change || 0;
    setSending(true);
    const r = await run(() => addPayment(inv.id, refund ? -record : record, method, needsRef && reference.trim() ? reference.trim() : null, inv.job_id),
      { ok: refund ? t('invoices.pay.refund.done', { amount: money(record, l) }) : change > 0 ? t('invoices.pay.doneChange', { change: money(change, l) }) : t('invoices.pay.done') });
    if (r !== undefined) { close(); p.onPaid?.(); } else setSending(false);
  };

  const theJob = inv.job_id ? jobRow(inv.job_id) : undefined;
  const coffreOk = !refund && !!theJob && mayCoffre(theJob) && a.paid <= 0;
  const toCoffre = () => {
    if (!theJob) return;
    close();
    if (p.onCoffre) p.onCoffre(); else openCoffre(theJob.id);
  };
  const confirmLabel = !method ? t('invoices.pay.pickMethod') : refund ? t('invoices.pay.refund.confirm', { amount: money(record, l) }) : t('invoices.pay.confirm', { amount: money(record, l) });
  return (
    <Sheet open onClose={close} title={title} sub={sub} data-testid="pay-sheet"
      footer={<>
        <Button onClick={close} class="pay-cancel">{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!canPay} onClick={pay} class="pay-confirm" data-testid="pay-confirm">{confirmLabel}</Button>
      </>}>
      <div class="stack-lg">
        <div class="pay-due">
          <span class="pay-due-label">{refund ? t('invoices.pay.refund.toGive') : a.paid > 0 ? t('invoices.pay.balance') : t('invoices.pay.toPay')}</span>
          <span class="pay-due-amount money" data-testid="pay-balance">{money(balance, l)}</span>
          {refund
            ? <span class="muted small">{t('invoices.pay.already', { paid: money(a.paid, l), total: money(a.total, l) })}</span>
            : a.paid > 0 && <span class="muted small">{t('invoices.pay.already', { paid: money(a.paid, l), total: money(a.total, l) })}</span>}
        </div>
        {refund && <Banner kind="info">{t('invoices.pay.refund.hint')}</Banner>}

        <Field label={t('invoices.pay.method')} group>
          <div class="pay-methods" role="radiogroup" aria-label={t('invoices.pay.method')}>
            {METHODS.map((m) => {
              const Icon = ICONS[m];
              return (
                <button key={m} type="button" role="radio" aria-checked={method === m} class="pay-method" onClick={() => setMethod(m)} data-testid={`pay-${m}`}>
                  <Icon aria-hidden="true" /><span>{methodWord(m, l)}</span>
                </button>
              );
            })}
            {/* « Coffre » (family and friends): no invoice, no taxes; the jobs are chosen in the Coffre sheet */}
            {coffreOk && (
              <button type="button" class="pay-method pay-method-coffre" onClick={toCoffre} data-testid="pay-coffre">
                <Vault aria-hidden="true" /><span>{t('coffre.pay.method')}</span>
              </button>
            )}
          </div>
        </Field>

        <Field label={refund ? t('invoices.pay.refund.amount') : t('invoices.pay.amount')} hint={!refund && !amountError && amount != null && amount < balance ? t('invoices.pay.partial', { left: money(balance - amount, l) }) : undefined} error={touched ? amountError : null}>
          <div class="pay-amount"><MoneyInput cents={amount} onCents={(c) => { setTouched(true); setAmount(c); }} aria-label={refund ? t('invoices.pay.refund.amount') : t('invoices.pay.amount')} /></div>
        </Field>

        {isCash && cash && (
          <div class="pay-cash stack" data-testid="pay-cash">
            <Field label={t('invoices.pay.received')} hint={cash.dueCash !== cash.due ? t('invoices.pay.rounded', { amount: money(cash.dueCash, l) }) : undefined}>
              <div class="pay-amount"><MoneyInput cents={received} onCents={setReceived} aria-label={t('invoices.pay.received')} /></div>
            </Field>
            <div class="chips" role="group" aria-label={t('invoices.pay.quick')}>
              {cashQuick(cash.dueCash).map((c) => (
                <button key={c} type="button" class="chip pay-bill" aria-pressed={received === c} onClick={() => setReceived(c)}>
                  {c === cash.dueCash ? t('invoices.pay.exact') : money(c, l, { whole: true })}
                </button>
              ))}
            </div>
            {received != null && (cash.short > 0
              ? <Banner kind="warn" title={t('invoices.pay.short', { amount: money(cash.short, l) })}>{t('invoices.pay.shortText', { amount: money(cash.record, l), left: money(balance - cash.record, l) })}</Banner>
              : (
                <div class="pay-change" role="status" data-testid="pay-change">
                  <span>{t('invoices.pay.giveBack')}</span>
                  <b class="money">{money(cash.change, l)}</b>
                </div>
              ))}
          </div>
        )}

        {needsRef && (
          <Field label={t(`invoices.pay.ref.${method}`)} optional>
            <Input value={reference} onValue={setReference} autoComplete="off" maxLength={80} data-testid="pay-ref" />
          </Field>
        )}

        {inv.job_id && !refund && (
          <div class="pay-link">
            <h3 class="pay-link-title"><Smartphone aria-hidden="true" />{t('invoices.pay.link.title')}</h3>
            {stripe.value === 'off'
              ? <p class="muted small" style={{ margin: 0 }}>{t('invoices.pay.link.off')}{isOwner() && <> <a href="#/settings/connect" onClick={close}>{t('invoices.pay.link.settings')}</a></>}</p>
              : <>
                <p class="muted small" style={{ margin: 0 }}>{stripe.value === 'on' ? t('invoices.pay.link.on') : t('invoices.pay.link.unknown')}</p>
                <Button icon={<Send />} onClick={async () => { const r = await sendText('invoice', inv.job_id!, t('invoices.pay.link.sent')); if (r) setManual(r); }} data-testid="pay-link">
                  {t('invoices.pay.link.send')}
                </Button>
              </>}
          </div>
        )}
      </div>
      <SendSheet result={manual} onClose={() => setManual(null)} />
    </Sheet>
  );
}
