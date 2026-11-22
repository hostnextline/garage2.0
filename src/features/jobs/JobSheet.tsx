/* The job sheet's page. One red button says the next step (Je pars, Je suis arrivé, Faire signer, Faire la facture,
   Encaisser, Terminer); everything else is calm and below: who and where, the authorization, the work, the invoice, the
   appointment, the texts. Opened from « Ma journée » (or the agenda's menu) with ?do=waiver|answer|work|invoice|pay|move|
   truck|edit, the sheet is ready for that piece — when this person may open it. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { computed } from '@preact/signals';
import { Ellipsis, Pencil } from 'lucide-preact';
import { may } from '../../domain/rights';
import { setQuery } from '../../platform/router';
import type { Job, JobItem } from '../../data/types';
import { invoiceOf, itemsOf } from '../../data/select';
import { getRow } from '../../data/store';
import { net } from '../../data/sync';
import { t } from '../../lib/i18n';
import { Page, IconButton, Banner, Button, StatusPill } from '../../ui';
import { InvoicePanel } from '../../shared/invoices/InvoicePanel';
import { PaySheet } from '../../shared/invoices/PaySheet';
import { openCoffre } from '../../shared/invoices/CoffreHost';
import { CarFirst } from '../../shared/jobs/CarFirst';
import type { NextStep } from '../../domain/jobs/steps';
import { isOpen } from '../../domain/jobs/billing';
import { withAnswer } from '../../domain/jobs/pending';
import { jobRights, mayChangeTruck, mayEditJob } from '../../domain/jobs/rights';
import { stepOf, jobName, jobCustomer, whenLine, proposedOf } from '../../shared/jobs/select';
import { pendingJobs } from '../../shared/jobs/pending';
import { startInvoice, letGo } from '../../shared/jobs/actions';
import { StepButton, PRESSABLE } from '../../shared/jobs/StepButton';
import { TextOutcomeHost } from '../../shared/jobs/TextOutcome';
import { PartsHost } from '../../shared/jobs/PartsSheet';
import { CarCheckHost } from '../../shared/jobs/CarCheckSheet';
import { WaiverSheet, SignatureView } from './WaiverSheet';
import { WorkPanel } from './work/WorkPanel';
import { ItemSheet } from './work/ItemSheet';
import { AddWorkSheet } from './work/AddWorkSheet';
import { ProposeSheet } from './work/ProposeSheet';
import { AnswerSheet } from './work/AnswerSheet';
import { EditSheet } from './JobEdit';
import { HeadPanel } from './HeadPanel';
import { NotesSheet } from './NotesSheet';
import { WaiverPanel } from './WaiverPanel';
import { StepState } from './StepState';
import { MomentPanel } from './MomentPanel';
import { MoveSheet } from '../../shared/jobs/MoveSheet';
import { DayOrderHost, openDayOrder } from '../../shared/jobs/DayOrderHost';
import { TruckSheet } from './TruckSheet';
import { TextsPanel } from './TextsPanel';
import { MenuSheet } from './MenuSheet';
import { afterSheet, calmScroll } from './scroll';

type SheetKind = 'waiver' | 'signature' | 'add' | 'propose' | 'pay' | 'move' | 'menu' | 'notes' | 'truck' | 'edit';
/** the last request reached the server (read alone: the sheet does not redraw while a pull goes table by table) */
const online = computed(() => net.value.online);
const invoiceBox = () => document.getElementById('job-invoice');

export function JobSheet({ job: j, query }: { job: Job; query: URLSearchParams }) {
  const rights = jobRights(j);
  const step = stepOf(j);
  const c = jobCustomer(j);
  const inv = invoiceOf(j.id);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [answerFor, setAnswerFor] = useState<string | null>(null);
  const [itemFor, setItemFor] = useState<string | null>(null);
  // paid far down the page (the invoice): bring « Terminer la job » into view, it is the last step
  const stepBox = useRef<HTMLDivElement>(null);
  const lastKind = useRef(step.kind);
  useEffect(() => {
    const was = lastKind.current;
    lastKind.current = step.kind;
    if (was === step.kind || step.kind !== 'finish') return;
    const tm = setTimeout(() => {
      const el = stepBox.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) calmScroll(el, 'center');
    }, 450);
    return () => clearTimeout(tm);
  }, [step.kind]);
  const close = () => setSheet(null);
  /* a piece of the sheet asked by a step, by « Ma journée » (?do=) or by the agenda's menu; each only for those who may */
  const ui = (kind: string, itemId?: string | null) => {
    switch (kind) {
      case 'waiver': if (j.status === 'on_site' && rights.act) setSheet('waiver'); break;
      case 'answer': setAnswerFor(itemId || proposedOf(j.id)[0]?.id || null); break;
      case 'work': if (rights.act && isOpen(j.status)) setSheet('add'); break;
      case 'invoice': void startInvoice(j).then(() => setTimeout(() => calmScroll(invoiceBox()), 60)); break;
      // the work missing from the finished invoice goes on it from the invoice (« Modifier la facture »)
      case 'unbilled': calmScroll(invoiceBox()); break;
      case 'pay': if (invoiceOf(j.id)) setSheet('pay'); else calmScroll(invoiceBox()); break;
      case 'move': if (j.status === 'booked' && rights.move) setSheet('move'); break;
      case 'truck': if (mayChangeTruck(j, rights)) setSheet('truck'); break;
      case 'edit': if (mayEditJob(j, rights)) setSheet('edit'); break;
    }
  };
  const onUi = (s: NextStep) => ui(s.kind, s.itemId);
  // ?do=… : clear it first (no new history step), then open the piece
  const wanted = query.get('do');
  useEffect(() => {
    if (!wanted) return;
    const item = query.get('item');
    setQuery({ do: null, item: null });
    afterSheet(() => ui(wanted, item));
  }, [wanted]);

  const title = may.customers() && c
    ? <a href={`#/customer/${c.id}`} class="jobs-title-link" aria-label={t('jobs.head.customerFile', { name: jobName(j) })}>{jobName(j)}</a>
    : jobName(j);
  // the line answered: with the customer's answer still waiting on this phone shown as given
  const answerRow = answerFor ? getRow<JobItem>('job_items', answerFor) : undefined;
  const answerItem = answerRow && withAnswer(answerRow, pendingJobs().answers);
  const openItem = itemFor ? itemsOf(j.id).find((i) => i.id === itemFor) : undefined;
  const back = may.agenda() && !rights.mine ? `/agenda/${j.day}` : '/';
  const editable = mayEditJob(j, rights);

  return (
    <Page title={title} back={back} data-testid="job-screen"
      sub={<span class="jobs-sub"><StatusPill status={j.status} /><span>{whenLine(j)}</span></span>}
      actions={<div class="row">
        {editable && <Button icon={<Pencil />} onClick={() => setSheet('edit')} data-testid="job-edit">{t('jobs.edit.button')}</Button>}
        <IconButton icon={<Ellipsis />} label={t('jobs.more')} onClick={() => setSheet('menu')} data-testid="job-menu" />
      </div>}>
      {!online.value && <Banner kind="warn">{t('jobs.offline')}</Banner>}
      {j.coffre_id && <Banner kind="info" data-testid="job-coffre">{t('coffre.job.banner')}</Banner>}
      {j.forced && j.status === 'booked' && <Banner kind="warn" data-testid="job-forced">{t('booking.force.banner')}</Banner>}
      <div class="jobs-layout">
        <div class="jobs-col">
          <CarFirst job={j} />
          {PRESSABLE.includes(step.kind) ? (
            <div class="jobs-step" ref={stepBox} data-tour={step.kind === 'pay' ? 'job-pay' : undefined}>
              <StepButton job={j} step={step} rights={rights} onUi={onUi} data-tour="job-bigstep" />
              {step.kind === 'pay' && step.payLater && (
                <Button variant="ghost" block onClick={() => letGo(j)} data-testid="job-pay-later">{t('jobs.step.payLater')}</Button>
              )}
            </div>
          ) : <StepState job={j} step={step} rights={rights} onCollect={() => setSheet('pay')} />}
          <HeadPanel job={j} rights={rights} onEditNotes={() => setSheet('notes')} />
          <WaiverPanel job={j} rights={rights} onSign={() => setSheet('waiver')} onSee={() => setSheet('signature')} />
          <WorkPanel job={j} rights={rights} onItem={setItemFor} onAnswer={setAnswerFor} onAdd={() => setSheet('add')} onPropose={() => setSheet('propose')} />
        </div>
        <div class="jobs-col">
          <div id="job-invoice" class="jobs-invoice" data-tour="job-invoice"><InvoicePanel jobId={j.id} /></div>
          <MomentPanel job={j} rights={rights} onMove={() => setSheet('move')} onOrder={() => openDayOrder(j.day, { truck: j.truck_id, job: j.id })} />
          <TextsPanel job={j} rights={rights} />
        </div>
      </div>

      <WaiverSheet job={j} open={sheet === 'waiver'} onClose={close} />
      <SignatureView job={j} open={sheet === 'signature'} onClose={close} />
      <AddWorkSheet job={j} rights={rights} open={sheet === 'add'} onClose={close} onProposed={(id) => afterSheet(() => setAnswerFor(id))} />
      <ProposeSheet job={j} open={sheet === 'propose'} onClose={close} onProposed={(id) => afterSheet(() => setAnswerFor(id))} />
      <NotesSheet job={j} open={sheet === 'notes'} onClose={close} />
      <MoveSheet job={j} open={sheet === 'move'} onClose={close} />
      <TruckSheet job={j} open={sheet === 'truck'} onClose={close} />
      {/* « Réorganiser la journée » (« Ordre des arrêts » retired into it, Part 28): the job's day, its truck, the job ringed */}
      <DayOrderHost />
      <MenuSheet job={j} rights={rights} open={sheet === 'menu'} onClose={close} onMove={() => setSheet('move')} onOrder={() => openDayOrder(j.day, { truck: j.truck_id, job: j.id })} onCoffre={() => openCoffre(j.id)} onTruck={() => setSheet('truck')}
        onEdit={editable ? () => setSheet('edit') : undefined} />
      <EditSheet job={j} rights={rights} open={sheet === 'edit'} onClose={close}
        onMove={() => afterSheet(() => setSheet('move'))} onTruck={() => afterSheet(() => setSheet('truck'))} onNotes={() => afterSheet(() => setSheet('notes'))}
        onWork={() => afterSheet(() => calmScroll(document.querySelector('[data-testid="job-work"]')))} />
      {/* « Payé par le Coffre » (from the menu or the payment sheet): the one Coffre sheet of the app, mounted by the frame (R49) */}
      {inv && <PaySheet open={sheet === 'pay'} onClose={close} invoiceId={inv.id} onPaid={close} />}
      {openItem && <ItemSheet job={j} item={openItem} rights={rights} onClose={() => setItemFor(null)}
        onAnswer={(id) => { setItemFor(null); afterSheet(() => setAnswerFor(id)); }} />}
      {answerFor && <AnswerSheet job={j} item={answerItem} rights={rights} onClose={() => setAnswerFor(null)} />}
      <TextOutcomeHost />
      <PartsHost />
      <CarCheckHost />
    </Page>
  );
}
