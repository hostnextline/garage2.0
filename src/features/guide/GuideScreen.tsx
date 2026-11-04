/* « Par où commencer » (#/guide): the first steps of my role, checked from the real data, each one a tap away from
   the right screen; the calm guided tour; installing the app; short answers to common questions. */
import { useEffect, useState } from 'preact/hooks';
import { Check, CirclePlay } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { t } from '../../lib/i18n';
import { shortDate, dayOf } from '../../lib/dates';
import { lang } from '../../lib/i18n';
import { me } from '../../data/auth';
import { Page, Panel, Button, Banner, toast } from '../../ui';
import { computeChecklist, progress, nextStep, type GuideStep, type Role, type Detail } from './checklist';
import { guideInput, myRoles, nextJobId, readLocal, markStep, refreshChecks, watchScreens } from './guide-data';
import { startTour, openStep } from './tour';
import { InstallPanel } from './Install';
import { HelpCenter, isTopic, type Topic } from './HelpCenter';
import './guide.css';

export function detailText(d: Detail | null): string | null {
  if (!d) return null;
  if (d.key === 'missing') return t('guide.detail.missing', { list: (d.list || []).map((f) => t(`guide.fields.${f}`)).join(', ') });
  return t(`guide.detail.${d.key}`, d.vars);
}

export function Progress(p: { done: number; total: number }) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <span class="guide-progress" role="img" aria-label={t('guide.progressLabel', { done: p.done, total: p.total })} data-testid="guide-progress">
      <span class="guide-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <b aria-hidden="true">{t('guide.progress', { done: p.done, total: p.total })}</b>
    </span>
  );
}

function StepRow(p: { s: GuideStep; n: number; next: boolean }) {
  const { s } = p;
  const state = s.done === true ? 'done' : s.done === null ? 'unknown' : 'todo';
  const sub = s.done === null ? t('guide.detail.offline') : (s.done ? null : detailText(s.detail)) || t(`guide.steps.${s.id}.text`);
  const confirm = () => { markStep(s.id); toast(t('guide.confirmed'), { kind: 'ok' }); };
  return (
    <div class={`guide-step${state === 'done' ? ' is-done' : ''}${p.next ? ' is-next' : ''}`} role="listitem" data-testid={`guide-step-${s.id}`} data-state={state}>
      <button type="button" class="guide-step-main" onClick={() => openStep(s)}>
        <span class={`guide-mark${state === 'done' ? ' is-done' : state === 'unknown' ? ' is-unknown' : ''}`} role="img"
          aria-label={state === 'done' ? t('guide.done') : state === 'unknown' ? t('guide.unknown') : t('guide.todo')}>
          {state === 'done' ? <Check aria-hidden="true" /> : p.n}
        </span>
        <span class="guide-step-txt">
          <span class="guide-step-title">{t(`guide.steps.${s.id}.title`)}</span>
          <span class="guide-step-sub">{sub}</span>
          {p.next && <span class="btn btn-primary btn-sm guide-step-go" aria-hidden="true">{s.kind === 'tour' ? t('guide.tour.start') : t('guide.go')}</span>}
        </span>
      </button>
      {s.canConfirm && <span class="guide-step-end"><Button onClick={confirm} data-testid="guide-confirm">{t('guide.confirm')}</Button></span>}
    </div>
  );
}

const JOB_STEPS = ['leave', 'arrive', 'waiver', 'invoice', 'pay', 'finish'] as const;
function JobSteps() {
  return (
    <Panel title={t('guide.jobSteps.title')} sub={t('guide.jobSteps.lead')} data-testid="guide-jobsteps">
      <ol class="guide-job">
        {JOB_STEPS.map((k, i) => (
          <li key={k}>
            <span class="guide-job-n" aria-hidden="true">{i + 1}</span>
            <span><b>{t(`guide.jobSteps.${k}.title`)}</b><span class="guide-job-t">{t(`guide.jobSteps.${k}.text`)}</span></span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function TourPanel(p: { main: Role; roles: Role[]; owner: boolean; finished: string | undefined }) {
  const others: Role[] = p.owner ? (['office', 'mechanic', 'treasurer'] as Role[]).filter((r) => r !== p.main) : p.roles.slice(1);
  return (
    <Panel title={t('guide.tour.title')} sub={t('guide.tour.lead')} data-testid="guide-tour">
      <div class="stack">
        <div class="row-wrap" style={{ gap: 'var(--sp-3)' }}>
          <Button icon={<CirclePlay size={18} />} onClick={() => startTour(p.main)} data-testid="guide-tour-start">
            {p.finished ? t('guide.tour.again') : t('guide.tour.start')}
          </Button>
          {p.finished && <span class="muted small">{t('guide.tour.finishedOn', { date: shortDate(dayOf(new Date(p.finished)), lang.value) })}</span>}
        </div>
        {others.length > 0 && (
          <div class="stack" style={{ gap: 'var(--sp-2)' }}>
            <span class="muted small">{p.owner ? `${t('guide.tour.others')}. ${t('guide.tour.othersLead')}` : t('guide.tour.others')}</span>
            <div class="row-wrap">
              {others.map((r) => <Button key={r} variant="ghost" icon={<CirclePlay size={18} />} onClick={() => startTour(r)} data-testid={`guide-tour-${r}`}>{t(`guide.roles.${r}`)}</Button>)}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function GuideScreen({ query }: ScreenProps) {
  const roles = myRoles();
  const main = roles[0];
  const faq = query.get('faq');
  const [topic, setTopic] = useState<Topic>(() => (isTopic(faq) ? faq : main === 'mechanic' ? 'offline' : main === 'treasurer' ? 'payments' : 'book'));
  useEffect(() => { watchScreens(); void refreshChecks(60 * 1000); }, []);
  // « Sans réseau » from the checklist or the card: open that topic and bring it into view
  useEffect(() => {
    if (!isTopic(faq)) return;
    setTopic(faq);
    if (faq === 'offline') markStep('offline');
    requestAnimationFrame(() => document.getElementById('guide-faq')?.scrollIntoView({ block: 'start', behavior: 'auto' }));
  }, [faq]);

  const a = me.value;
  const input = guideInput();
  const steps = input ? computeChecklist(input, nextJobId()) : [];
  const pr = progress(steps);
  const nx = nextStep(steps);
  const local = readLocal(a?.id);
  const allDone = steps.length > 0 && pr.done === pr.total;
  const pickTopic = (x: Topic) => { setTopic(x); if (x === 'offline') markStep('offline'); };
  return (
    <Page title={t('guide.title')} sub={t(`guide.sub.${main}`)} help={t('guide.help')} data-testid="guide-screen">
      <Panel flush title={t('guide.checklist')} sub={<Progress {...pr} />} data-testid="guide-checklist">
        {allDone && <div style={{ padding: '0 var(--sp-5) var(--sp-3)' }}><Banner kind="ok">{t('guide.allDone')}</Banner></div>}
        <div class="guide-steps" role="list">
          {steps.map((s, i) => <StepRow key={s.id} s={s} n={i + 1} next={nx?.id === s.id} />)}
        </div>
      </Panel>
      {roles.includes('mechanic') && <JobSteps />}
      <TourPanel main={main} roles={roles} owner={!!a?.owner} finished={local.tours[main]} />
      <InstallPanel />
      <HelpCenter topic={topic} onTopic={pickTopic} onOpen={(x) => { if (x === 'offline') markStep('offline'); }} />
    </Page>
  );
}
