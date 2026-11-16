/* The red button of a job: its one next step, in the same words on « Ma journée » and on the job sheet.
   Je pars, Je suis arrivé, the VIN and Terminer la job happen right here. The steps that need the job sheet (the signature,
   the customer's answer, the invoice, the payment) open the sheet ready for it (#/job/ID?do=…), or call onUi there.
   The same button at the same place becomes the next step as soon as one is done (« Je pars » → « Je suis arrivé »): for a
   moment after it changes it takes no tap, so a late second tap of a gloved finger never does the next step. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { type LucideIcon, Truck, MapPinCheck, ScanLine, Signature, PenLine, Wrench, ReceiptText, HandCoins, CircleCheckBig, FilePlus2 } from 'lucide-preact';
import type { Job, JobItem } from '../../data/types';
import { BigStep } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { money, lineTotal } from '../../lib/money';
import { getRow } from '../../data/store';
import { net } from '../../data/sync';
import { me } from '../../data/auth';
import { job as jobById } from '../../data/select';
import type { NextStep, StepKind } from '../../domain/jobs/steps';
import type { JobRights } from '../../domain/jobs/rights';
import { jobFirstName, customerGetsTexts, invoiceWaiting } from './select';
import { doLeave, doArrive, doFinish, doVin } from './actions';
import './jobs.css';

const ICONS: Partial<Record<StepKind, LucideIcon>> = {
  leave: Truck, arrive: MapPinCheck, vin: ScanLine, waiver: Signature, answer: PenLine, work: Wrench, invoice: ReceiptText, unbilled: FilePlus2,
  pay: HandCoins, finish: CircleCheckBig, blocked: HandCoins
};
/** the steps that are a button (the others are a state: done, closed, later, none) */
export const PRESSABLE: StepKind[] = ['leave', 'arrive', 'vin', 'waiver', 'answer', 'work', 'invoice', 'unbilled', 'pay', 'finish', 'blocked'];
/** the steps that need the job sheet's own pieces, and the ?do= that opens it ready for them (the missing work is put
    on the invoice from the invoice) */
const ON_SHEET: Partial<Record<StepKind, string>> = { waiver: 'waiver', answer: 'answer', work: 'work', invoice: 'invoice', unbilled: 'invoice', pay: 'pay' };
/** after the step changes under the finger, taps are refused this long */
export const MORPH_MS = 700;

function stepWords(j: Job, s: NextStep): { label: string; sub: string } {
  const l = lang.value;
  switch (s.kind) {
    case 'leave': {
      // said before pressing: does the text go by itself (texts switched on), or will the mechanic send it?
      const sub = !customerGetsTexts(j) ? t('jobs.step.leaveSubQuiet') : me.value?.texts_online === false ? t('jobs.step.leaveSubManual') : t('jobs.step.leaveSub');
      return { label: t('jobs.step.leave'), sub };
    }
    case 'arrive': return { label: t('jobs.step.arrive'), sub: t('jobs.step.arriveSub', { name: jobFirstName(j) }) };
    case 'vin': return { label: t('jobs.step.vin'), sub: t('jobs.step.vinSub') };
    case 'waiver': return { label: t('jobs.step.waiver'), sub: t('jobs.step.waiverSub') };
    case 'answer': {
      const it = getRow<JobItem>('job_items', s.itemId);
      const price = it ? money(lineTotal({ qty: Number(it.qty), unitCents: it.unit_cents }), l) : '';
      return { label: t('jobs.step.answer'), sub: it ? t('jobs.step.answerSub', { what: it.description, price }) : '' };
    }
    case 'work': return { label: t('jobs.step.work'), sub: t('jobs.step.workSub') };
    case 'invoice': {
      const later = !s.draft && (!net.value.online || invoiceWaiting(j.id));
      return { label: t('jobs.step.invoice'), sub: later ? t('jobs.step.invoiceOfflineSub') : s.stale ? t('jobs.step.invoiceStaleSub') : s.draft ? t('jobs.step.invoiceDraftSub') : t('jobs.step.invoiceSub') };
    }
    case 'unbilled': {
      const what = getRow<JobItem>('job_items', s.itemId)?.description || '';
      const more = (s.count ?? 1) - 1;
      const sub = s.paid ? t('jobs.step.unbilledPaidSub', { what }) : more > 0 ? t('jobs.step.unbilledSubMore', { what, n: more }) : t('jobs.step.unbilledSub', { what });
      return { label: t('jobs.step.unbilled'), sub };
    }
    case 'pay': return { label: t('jobs.step.pay'), sub: t(s.waiting ? 'jobs.step.payWaitingSub' : 'jobs.step.paySub', { amount: money(s.due ?? 0, l) }) };
    case 'finish': return { label: t('jobs.step.finish'), sub: s.waiting ? t('jobs.step.finishWaitingSub') : s.later ? t('jobs.step.finishLaterSub') : t('jobs.step.finishPaidSub') };
    case 'blocked': {
      const other = jobById(s.jobId);
      return { label: t('jobs.step.blocked', { name: other ? jobFirstName(other) : '' }), sub: t('jobs.step.blockedSub') };
    }
    default: return { label: '', sub: '' };
  }
}

/** true for a moment after `key` changes (not when the button first appears): the button takes no tap meanwhile */
function useCooling(key: string, ms = MORPH_MS): boolean {
  const last = useRef(key);
  const since = useRef(0);
  // decided while drawing, so the very first frame of the new step is already closed to taps
  if (last.current !== key) { last.current = key; since.current = Date.now(); }
  const cooling = Date.now() - since.current < ms;
  const [, wake] = useState(0);
  useEffect(() => {
    if (!cooling) return;
    const tm = setTimeout(() => wake((n) => n + 1), ms - (Date.now() - since.current) + 5);
    return () => clearTimeout(tm);
  }, [key, cooling]);
  return cooling;
}

export interface StepButtonProps {
  job: Job; step: NextStep; rights: JobRights;
  /** on the job sheet: open its own piece (signature, answer, invoice, payment); elsewhere the sheet opens for it */
  onUi?: (s: NextStep) => void;
  'data-tour'?: string;
}
export function StepButton(p: StepButtonProps) {
  const { job: j, step: s } = p;
  const key = `${j.id}:${s.kind}`;
  const cooling = useCooling(key);
  if (!PRESSABLE.includes(s.kind)) return null;
  const Icon = ICONS[s.kind] || CircleCheckBig;
  const { label, sub } = stepWords(j, s);
  // keyed by job and step: the spinner or the « touch again » of one step never stays on the next one
  const common = { key, icon: <Icon size={24} />, label, sub: sub || undefined, disabled: cooling, 'data-tour': p['data-tour'], 'data-testid': `step-${s.kind}` };
  const sheet = ON_SHEET[s.kind];
  const button = s.kind === 'blocked' ? <BigStep {...common} href={`#/job/${s.jobId}`} />
    : sheet ? (p.onUi ? <BigStep {...common} onClick={() => p.onUi!(s)} /> : <BigStep {...common} href={`#/job/${j.id}?do=${sheet}${s.itemId && s.kind === 'answer' ? `&item=${s.itemId}` : ''}`} />)
      : <BigStep {...common} onClick={s.kind === 'leave' ? () => doLeave(j, p.rights) : s.kind === 'arrive' ? () => doArrive(j) : s.kind === 'vin' ? () => doVin(j) : () => doFinish(j, p.rights)} />;
  // the pause is not a « disabled » look: the button keeps its colours (jobs.css, .jobs-stepbtn)
  return <span class={`jobs-stepbtn${cooling ? ' is-cooling' : ''}`}>{button}</span>;
}
