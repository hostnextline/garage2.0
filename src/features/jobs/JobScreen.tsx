/* The job sheet (#/job/:id) — the heart of the mechanic's day, used at the customer's door: gloves, sun, one hand, weak
   signal, a customer watching. One red button says the next step (Je pars, Je suis arrivé, Faire signer, Faire la
   facture, Encaisser, Terminer); everything else is calm and below: who and where, the authorization, the work, the
   invoice, the appointment, the texts. Opened from « Ma journée » with ?do=waiver|answer|work|invoice|pay, the sheet is
   ready for that step. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Ellipsis, Pencil } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { may } from '../../app/routes';
import { setQuery } from '../../app/router';
import type { Job, JobItem } from '../../data/types';
import { job as jobById, invoiceOf, itemsOf } from '../../data/select';
import { getRow } from '../../data/store';
import { net, refetch } from '../../data/sync';
import { t } from '../../lib/i18n';
import { Page, IconButton, Banner, Empty, Button, Skeleton, StatusPill } from '../../ui';
import { InvoicePanel } from '../invoices/InvoicePanel';
import { PaySheet } from '../invoices/PaySheet';
import { CoffreSheet } from '../coffre/CoffreSheet';
import { CarFirst } from './CarFirst';
import { startPositionSharing } from '../today/position';
import type { NextStep } from './nextStep';
import { jobRights, stepOf, jobName, jobCustomer, whenLine, proposedOf, seen } from './select';
import { startInvoice, letGo } from './flow';
import { StepButton } from './StepButton';
import { WaiverSheet, SignatureView } from './WaiverSheet';
import { WorkPanel, ItemSheet, AddWorkSheet, ProposeSheet, AnswerSheet } from './WorkPanel';
import { StopOrderSheet } from './StopOrderSheet';
import { EditSheet, mayEditJob } from './JobEdit';
import { HeadPanel, NotesSheet, WaiverPanel, StepState, MomentPanel, MoveSheet, TruckSheet, mayChangeTruck, TextsPanel, MenuSheet, afterSheet } from './JobParts';
import { TextOutcomeHost } from './TextOutcome';
import { PartsHost } from './PartsSheet';
import { CarCheckHost } from './CarCheckSheet';
import './jobs.css';

type SheetKind = 'waiver' | 'signature' | 'add' | 'propose' | 'pay' | 'move' | 'menu' | 'notes' | 'coffre' | 'order' | 'truck' | 'edit';

export default function JobScreen({ params, query }: ScreenProps) {
  const id = params.id;
  const raw = jobById(id);
  // with the steps still waiting on this phone (no signal), so the mechanic can go on
  const j = raw ? seen(raw) : undefined;
  const ready = net.value.ready;
  const [asked, setAsked] = useState(false);
  useEffect(() => { startPositionSharing(); }, []);
  // not on this phone (yet): ask the server once, it may have just been booked or moved here
  useEffect(() => {
    if (j || !ready || asked) return;
    setAsked(true);
    void refetch('jobs', id);
  }, [j, ready, asked, id]);
  if (!j) {
    if (!ready || !asked) {
      return (
        <Page title={t('jobs.title')} back="/">
          <div aria-busy="true" class="stack"><span class="sr-only">{t('jobs.loading')}</span><Skeleton h={76} /><Skeleton h={18} lines={4} /></div>
        </Page>
      );
    }
    return (
      <Page title={t('jobs.title')} back="/">
        <Empty title={t('jobs.notFound')} text={t('jobs.notFoundText')}
          action={<div class="row-wrap"><Button variant="primary" href="#/">{t('jobs.goToday')}</Button>{may.agenda() && <Button href="#/agenda">{t('jobs.goAgenda')}</Button>}</div>} />
      </Page>
    );
  }
  return <JobSheet job={j} query={query} />;
}

function JobSheet({ job: j, query }: { job: Job; query: URLSearchParams }) {
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
    if (lastKind.current !== step.kind && step.kind === 'finish') {
      setTimeout(() => {
        const el = stepBox.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.top >= 0 && r.bottom <= window.innerHeight) return;
        const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
      }, 450);
    }
    lastKind.current = step.kind;
  }, [step.kind]);
  const close = () => setSheet(null);
  const scrollToInvoice = () => {
    const el = document.getElementById('job-invoice');
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  };
  const ui = (kind: string, itemId?: string | null) => {
    switch (kind) {
      case 'waiver': setSheet('waiver'); break;
      case 'answer': setAnswerFor(itemId || proposedOf(j.id)[0]?.id || null); break;
      case 'work': setSheet('add'); break;
      case 'invoice': void startInvoice(j).then(() => setTimeout(scrollToInvoice, 60)); break;
      case 'pay': if (invoiceOf(j.id)) setSheet('pay'); break;
      // the agenda's menu: « Déplacer »
      case 'move': if (j.status === 'booked' && rights.move) setSheet('move'); break;
      case 'truck': if (mayChangeTruck(j, rights)) setSheet('truck'); break;
      case 'edit': if (mayEditJob(j, rights)) setSheet('edit'); break;
    }
  };
  const onUi = (s: NextStep) => ui(s.kind, s.itemId);
  // ?do=… from « Ma journée »: clear it first (no new history step), then open the piece
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
  const answerItem = answerFor ? getRow<JobItem>('job_items', answerFor) : undefined;
  const openItem = itemFor ? itemsOf(j.id).find((i) => i.id === itemFor) : undefined;
  const back = may.agenda() && !rights.mine ? `/agenda/${j.day}` : '/';
  const pressable = ['leave', 'arrive', 'waiver', 'answer', 'work', 'invoice', 'pay', 'finish', 'blocked'].includes(step.kind);

  return (
    <Page title={title} back={back} data-testid="job-screen"
      sub={<span class="jobs-sub"><StatusPill status={j.status} /><span>{whenLine(j)}</span></span>}
      actions={<div class="row">
        {mayEditJob(j, rights) && <Button icon={<Pencil />} onClick={() => setSheet('edit')} data-testid="job-edit">{t('jobs.edit.button')}</Button>}
        <IconButton icon={<Ellipsis />} label={t('jobs.more')} onClick={() => setSheet('menu')} data-testid="job-menu" />
      </div>}>
      {!net.value.online && <Banner kind="warn">{t('jobs.offline')}</Banner>}
      {j.coffre_id && <Banner kind="info" data-testid="job-coffre">{t('coffre.job.banner')}</Banner>}
      {j.forced && j.status === 'booked' && <Banner kind="warn" data-testid="job-forced">{t('booking.force.banner')}</Banner>}
      <div class="jobs-layout">
        <div class="jobs-col">
          <CarFirst job={j} />
          {pressable ? (
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
          <MomentPanel job={j} rights={rights} onMove={() => setSheet('move')} onOrder={() => setSheet('order')} />
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
      <StopOrderSheet job={j} open={sheet === 'order'} onClose={close} />
      <MenuSheet job={j} rights={rights} open={sheet === 'menu'} onClose={close} onMove={() => setSheet('move')} onOrder={() => setSheet('order')} onCoffre={() => setSheet('coffre')} onTruck={() => setSheet('truck')}
        onEdit={mayEditJob(j, rights) ? () => setSheet('edit') : undefined} />
      <EditSheet job={j} rights={rights} open={sheet === 'edit'} onClose={close}
        onMove={() => afterSheet(() => setSheet('move'))} onTruck={() => afterSheet(() => setSheet('truck'))} onNotes={() => afterSheet(() => setSheet('notes'))}
        onWork={() => afterSheet(() => document.querySelector('[data-testid="job-work"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))} />
      {inv && <PaySheet open={sheet === 'pay'} onClose={close} invoiceId={inv.id} onPaid={close} onCoffre={() => afterSheet(() => setSheet('coffre'))} />}
      <CoffreSheet job={j} open={sheet === 'coffre'} onClose={close} />
      {openItem && <ItemSheet job={j} item={openItem} rights={rights} onClose={() => setItemFor(null)}
        onAnswer={(id) => { setItemFor(null); afterSheet(() => setAnswerFor(id)); }} />}
      {answerFor && <AnswerSheet job={j} item={answerItem} rights={rights} onClose={() => setAnswerFor(null)} />}
      <TextOutcomeHost />
      <PartsHost />
      <CarCheckHost />
    </Page>
  );
}
