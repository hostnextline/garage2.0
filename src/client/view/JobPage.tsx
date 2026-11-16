/* An appointment's page: the greeting, the payment check notes, then the panels in the order the customer needs them
   (extra work to answer → the invoice → on site, the invoice being made → the appointment → the estimate). */
import { RefreshCw } from 'lucide-preact';
import { Button } from '../../ui/Button';
import type { JobView } from '../api';
import { ct, type CLang } from '../i18n';
import { Note, PrintIdentity, garageName } from '../ui';
import { AppointmentPanel } from './AppointmentPanel';
import { ExtrasPanel } from './ExtrasPanel';
import { InvoicePanel } from './InvoicePanel';
import type { Appointment } from './useAppointment';
import { WorkPanel } from './WorkPanel';
import { extrasToAnswer, isOnSiteBill } from './view-state';

/** « Paiement en vérification… »: also over the grey boxes while the first check runs (back from Stripe) */
export function CheckingNote(p: { l: CLang }) {
  return <Note icon={<span class="cl-spin" aria-hidden="true" />} title={ct(p.l, 'pay.checking')} data-testid="client-checking">{ct(p.l, 'pay.checkingLead')}</Note>;
}

export function JobPage(p: { v: JobView; l: CLang; token: string; a: Appointment; onPay: () => Promise<void> }) {
  const { v, l, a } = p;
  const inv = v.invoice;
  const first = v.customer?.first;
  const onSite = isOnSiteBill(v);
  const work = <WorkPanel v={v} l={l} payFailed={a.payFailed} pendingNote={a.pendingNote} onPay={p.onPay} onSign={a.sign} />;
  return (
    <>
      <section class="cl-hero">
        <p class="cl-hello">{first ? ct(l, 'hello', { name: first }) : ct(l, 'helloAlone')}</p>
        <h1>{inv ? ct(l, 'invoice.heroTitle') : onSite ? ct(l, 'work.billTitle') : ct(l, 'job.title')}</h1>
        <p class="cl-lead">{ct(l, inv ? 'job.leadInvoice' : onSite ? 'job.leadOnSite' : 'job.lead', { garage: garageName(v.garage, l) })}</p>
      </section>
      <PrintIdentity garage={v.garage} l={l} />
      {a.check === 'checking' && <CheckingNote l={l} />}
      {a.check === 'paid' && <Note kind="ok" data-testid="client-paid-note">{ct(l, 'pay.done')}</Note>}
      {a.check === 'late' && (
        <Note kind="warn" data-testid="client-late">
          <p>{ct(l, 'pay.late')}</p>
          <Button size="sm" icon={<RefreshCw />} onClick={a.checkAgain} class="cl-noprint" data-testid="client-check-again">{ct(l, 'pay.checkAgain')}</Button>
        </Note>
      )}
      {(extrasToAnswer(v).length > 0 || a.reply) && <ExtrasPanel v={v} l={l} reply={a.reply} onAnswer={a.answer} />}
      {inv && <InvoicePanel v={v} l={l} justPaid={a.justPaid} payFailed={a.payFailed} pendingNote={a.pendingNote} onPay={p.onPay} />}
      {/* the mechanic is there: the invoice to pay comes first */}
      {onSite && work}
      <AppointmentPanel v={v} l={l} printable={!inv} token={p.token} />
      {!inv && !onSite && work}
    </>
  );
}
