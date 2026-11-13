/* The red button of a job: its one next step, in the same words on « Ma journée » and on the job sheet.
   Je pars, Je suis arrivé and Terminer la job happen right here. The steps that need the job sheet (the signature, the
   customer's answer, the invoice, the payment) open the sheet ready for it (#/job/ID?do=…), or call onUi there. */
import { type LucideIcon, Truck, MapPinCheck, ScanLine, Signature, PenLine, Wrench, ReceiptText, HandCoins, CircleCheckBig } from 'lucide-preact';
import type { Job, JobItem } from '../../data/types';
import { BigStep } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { money, lineTotal } from '../../lib/money';
import { getRow } from '../../data/store';
import { net } from '../../data/sync';
import { me } from '../../data/auth';
import { job as jobById } from '../../data/select';
import type { NextStep, StepKind } from './nextStep';
import { jobFirstName, customerGetsTexts, type JobRights } from './select';
import { doLeave, doArrive, doFinish, doVin } from './flow';

const ICONS: Partial<Record<StepKind, LucideIcon>> = {
  leave: Truck, arrive: MapPinCheck, vin: ScanLine, waiver: Signature, answer: PenLine, work: Wrench, invoice: ReceiptText, pay: HandCoins, finish: CircleCheckBig, blocked: HandCoins
};
/** the steps that are a button (the others are a state: done, closed, later, none) */
export const PRESSABLE: StepKind[] = ['leave', 'arrive', 'vin', 'waiver', 'answer', 'work', 'invoice', 'pay', 'finish', 'blocked'];
/** the steps that need the job sheet's own pieces */
export const ON_SHEET: StepKind[] = ['waiver', 'answer', 'work', 'invoice', 'pay'];

export function stepWords(j: Job, s: NextStep): { label: string; sub: string } {
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
    case 'invoice': return { label: t('jobs.step.invoice'), sub: !s.draft && !net.value.online ? t('jobs.step.invoiceOfflineSub') : s.stale ? t('jobs.step.invoiceStaleSub') : s.draft ? t('jobs.step.invoiceDraftSub') : t('jobs.step.invoiceSub') };
    case 'pay': return { label: t('jobs.step.pay'), sub: t('jobs.step.paySub', { amount: money(s.due ?? 0, l) }) };
    case 'finish': return { label: t('jobs.step.finish'), sub: s.later ? t('jobs.step.finishLaterSub') : t('jobs.step.finishPaidSub') };
    case 'blocked': {
      const other = jobById(s.jobId);
      return { label: t('jobs.step.blocked', { name: other ? jobFirstName(other) : '' }), sub: t('jobs.step.blockedSub') };
    }
    default: return { label: '', sub: '' };
  }
}

export interface StepButtonProps {
  job: Job; step: NextStep; rights: JobRights;
  /** on the job sheet: open its own piece (signature, answer, invoice, payment); elsewhere the sheet opens for it */
  onUi?: (s: NextStep) => void;
  'data-tour'?: string;
}
export function StepButton(p: StepButtonProps) {
  const { job: j, step: s } = p;
  if (!PRESSABLE.includes(s.kind)) return null;
  const Icon = ICONS[s.kind] || CircleCheckBig;
  const { label, sub } = stepWords(j, s);
  const common = { icon: <Icon size={24} />, label, sub: sub || undefined, 'data-tour': p['data-tour'], 'data-testid': `step-${s.kind}` };
  if (s.kind === 'blocked') return <BigStep {...common} href={`#/job/${s.jobId}`} />;
  if (ON_SHEET.includes(s.kind)) {
    if (p.onUi) return <BigStep {...common} onClick={() => p.onUi!(s)} />;
    return <BigStep {...common} href={`#/job/${j.id}?do=${s.kind}${s.itemId ? `&item=${s.itemId}` : ''}`} />;
  }
  const act = s.kind === 'leave' ? () => doLeave(j) : s.kind === 'arrive' ? () => doArrive(j) : s.kind === 'vin' ? () => doVin(j) : () => doFinish(j, p.rights);
  return <BigStep {...common} onClick={act} />;
}
