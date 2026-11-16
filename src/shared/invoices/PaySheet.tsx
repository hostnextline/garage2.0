/* « Encaisser » (shared: the job sheet opens it too). Made for the customer's door: gloves, a customer watching.
   The amount left is the hero; the payment method is one big tap; cash shows the change to give back (rounded to
   5 ¢, no pennies) and records only what is due; a card payment link can be texted when the garage has card payments.
   It counts what this phone already took and has not sent yet: a payment waiting for the network is said, with its
   amount, and never offered a second time. With `refund`, « Rembourser »: money given back to a customer who paid
   more than the invoice (a negative payment, never more than what was paid too much). */
import { useEffect, useState } from 'preact/hooks';
import { Banknote, CreditCard, Landmark, Send, FileText, Ellipsis, Vault } from 'lucide-preact';
import type { PayMethod } from '../../data/types';
import { addPayment } from '../../data/api';
import { customerName, job as jobRow } from '../../data/select';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { Sheet, Button, Field, Input, MoneyInput, Banner, Empty, run } from '../../ui';
import { cashChange } from '../../domain/money/invoice';
import { viewOf } from '../../domain/money/view';
import { payMode, amountProblem } from '../../domain/money/pay';
import { waitingEntries, coffreWaiting } from '../../domain/money/waiting';
import { mayCoffre, openCoffre } from './CoffreHost';
import { invoiceById, invoiceCustomer, invoiceLabel, methodWord, METHODS } from './select';
import { PayCash } from './PayCash';
import { PayLink } from './PayLink';
import './invoices.css';

export interface PaySheetProps {
  open: boolean; onClose: () => void; invoiceId: string; onPaid?: () => void;
  /** after the sheet closes for « Coffre » (else the shell opens the Coffre sheet itself) */
  onCoffre?: () => void;
  /** « Rembourser »: money given back to a customer who paid more than the invoice */
  refund?: boolean;
}

const ICONS: Record<string, typeof Banknote> = { cash: Banknote, debit: Landmark, credit: CreditCard, interac: Send, cheque: FileText, other: Ellipsis };

export function PaySheet(p: PaySheetProps) {
  if (!p.open) return null;
  return <PayOpen {...p} />;
}

function PayOpen(p: PaySheetProps) {
  const raw = invoiceById(p.invoiceId);
  const view = raw ? viewOf(raw) : null;
  const refund = !!p.refund;
  const plan = view ? payMode(view, refund) : null;
  // the amount in play when the payment was confirmed: its own rows arrive just before the sheet closes, keep the form
  const [frozen, setFrozen] = useState<number | null>(null);
  const inPlay = frozen ?? plan?.inPlay ?? 0;
  const [amount, setAmount] = useState<number | null>(inPlay);
  const [touched, setTouched] = useState(false);
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [received, setReceived] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  // a payment that arrives meanwhile (card online, another phone) changes what is left: follow it until edited
  useEffect(() => { if (!touched && frozen == null) setAmount(inPlay); }, [inPlay]);

  const close = p.onClose;
  const l = lang.value;
  const title = refund ? t('invoices.pay.refund.title') : t('invoices.pay.title');
  if (!raw || !view || !plan) {
    return <Sheet open onClose={close} title={title}><Empty title={t('invoices.pay.missing')} text={t('invoices.pay.missingText')} /></Sheet>;
  }
  const inv = view.inv;
  const a = view.amounts;
  const who = customerName(invoiceCustomer(inv));
  const sub = who ? t('invoices.pay.sub', { n: invoiceLabel(inv, l), who }) : t('invoices.numbered', { n: invoiceLabel(inv, l) });
  if (frozen == null && plan.mode !== 'form') {
    return (
      <Sheet open onClose={close} title={title} sub={sub} footer={<Button variant="primary" onClick={close}>{t('common.close')}</Button>} data-testid="pay-sheet">
        {plan.mode === 'waiting'
          ? <Banner kind="info" title={t('invoices.pay.waiting', { amount: money(view.waiting, l) })} data-testid="pay-waiting">{t('invoices.pay.waitingText')}</Banner>
          : plan.mode === 'refund-waiting'
            ? <Banner kind="info" data-testid="pay-waiting">{t('invoices.pay.refund.waiting', { amount: money(-view.waiting, l) })}</Banner>
            : plan.mode === 'refund-none'
              ? <Banner kind="ok">{t('invoices.pay.refund.none')}</Banner>
              : <Banner kind={plan.mode === 'paid' ? 'ok' : 'warn'}>{t(`invoices.pay.not.${plan.mode}`)}</Banner>}
      </Sheet>
    );
  }

  const isCash = method === 'cash' && !refund;
  const cash = isCash ? cashChange(amount ?? 0, received) : null;
  const record = cash ? cash.record : amount ?? 0;
  const problem = amountProblem(amount, inPlay);
  const amountError = problem === 'amount' ? t('invoices.pay.errAmount')
    : problem === 'tooMuch' ? t(refund ? 'invoices.pay.refund.tooMuch' : 'invoices.pay.errTooMuch', { max: money(inPlay, l) }) : null;
  const canPay = !!method && !amountError && record > 0;
  const needsRef = method === 'cheque' || method === 'interac' || method === 'other';

  const pay = async () => {
    if (!canPay || !method) return;
    const change = cash?.change || 0;
    setFrozen(inPlay);
    const r = await run(() => addPayment(raw.id, refund ? -record : record, method, needsRef && reference.trim() ? reference.trim() : null, raw.job_id),
      { ok: refund ? t('invoices.pay.refund.done', { amount: money(record, l) }) : change > 0 ? t('invoices.pay.doneChange', { change: money(change, l) }) : t('invoices.pay.done') });
    if (r !== undefined) { close(); p.onPaid?.(); } else setFrozen(null);
  };

  const theJob = raw.job_id ? jobRow(raw.job_id) : undefined;
  const coffreOk = !refund && !!theJob && mayCoffre(theJob) && a.paid <= 0 && view.waiting === 0 && !coffreWaiting(waitingEntries(), theJob.id);
  const toCoffre = () => {
    if (!theJob) return;
    close();
    if (p.onCoffre) p.onCoffre(); else openCoffre(theJob.id);
  };
  const confirmLabel = !method ? t('invoices.pay.pickMethod') : t(refund ? 'invoices.pay.refund.confirm' : 'invoices.pay.confirm', { amount: money(record, l) });
  return (
    <Sheet open onClose={close} title={title} sub={sub} data-testid="pay-sheet"
      footer={<>
        <Button onClick={close} class="pay-cancel">{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!canPay} onClick={pay} class="pay-confirm" data-testid="pay-confirm">{confirmLabel}</Button>
      </>}>
      <div class="stack-lg">
        <div class="pay-due">
          <span class="pay-due-label">{refund ? t('invoices.pay.refund.toGive') : a.paid > 0 || view.waiting > 0 ? t('invoices.pay.balance') : t('invoices.pay.toPay')}</span>
          <span class="pay-due-amount money" data-testid="pay-balance">{money(inPlay, l)}</span>
          {(refund || a.paid > 0) && <span class="muted small">{t('invoices.pay.already', { paid: money(a.paid, l), total: money(a.total, l) })}</span>}
          {!refund && view.waiting > 0 && <span class="muted small" data-testid="pay-waiting-part">{t('invoices.pay.waitingPart', { amount: money(view.waiting, l) })}</span>}
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

        <Field label={refund ? t('invoices.pay.refund.amount') : t('invoices.pay.amount')} error={touched ? amountError : null}
          hint={!refund && !amountError && amount != null && amount < inPlay ? t('invoices.pay.partial', { left: money(inPlay - amount, l) }) : undefined}>
          <div class="pay-amount"><MoneyInput cents={amount} onCents={(c) => { setTouched(true); setAmount(c); }} aria-label={refund ? t('invoices.pay.refund.amount') : t('invoices.pay.amount')} /></div>
        </Field>

        {cash && <PayCash cash={cash} received={received} onReceived={setReceived} balance={inPlay} />}

        {needsRef && (
          <Field label={t(`invoices.pay.ref.${method}`)} optional>
            <Input value={reference} onValue={setReference} autoComplete="off" maxLength={80} data-testid="pay-ref" />
          </Field>
        )}

        {raw.job_id && !refund && <PayLink jobId={raw.job_id} onLeave={close} />}
      </div>
    </Sheet>
  );
}
