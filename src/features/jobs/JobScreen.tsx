/* The job sheet (#/job/:id) — the heart of the mechanic's day, used at the customer's door: gloves, sun, one hand, weak
   signal, a customer watching. This file finds the job: from the phone's copy (with the steps still waiting on this phone),
   else asked once from the server (just booked or moved here), with a skeleton until the answer, then « introuvable ».
   The sheet itself is JobSheet.tsx. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { computed } from '@preact/signals';
import { may } from '../../domain/rights';
import type { ScreenProps } from '../../platform/router';
import { job as jobById } from '../../data/select';
import { net, refetch } from '../../data/sync';
import { t } from '../../lib/i18n';
import { Page, Empty, Button, Skeleton } from '../../ui';
import { startPositionSharing } from '../../services/position';
import { seen } from '../../shared/jobs/select';
import { JobSheet } from './JobSheet';
import '../../shared/jobs/jobs.css';

/** the first copy of the data is on screen (read alone: the sheet does not redraw on every other change of the network) */
const ready = computed(() => net.value.ready);

export default function JobScreen({ params, query }: ScreenProps) {
  const id = params.id;
  const raw = jobById(id);
  // with the steps still waiting on this phone (no signal), so the mechanic can go on
  const j = raw ? seen(raw) : undefined;
  // the server was asked for this job (not on the phone yet): until it answered, the job is « being opened », not « not found »
  const [asked, setAsked] = useState<{ id: string; done: boolean } | null>(null);
  const alive = useRef(true);
  useEffect(() => { startPositionSharing(); return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (j || !ready.value || asked?.id === id) return;
    setAsked({ id, done: false });
    void refetch('jobs', id).finally(() => { if (alive.current) setAsked((a) => (a?.id === id ? { id, done: true } : a)); });
  }, [!!j, ready.value, asked?.id, id]);
  if (!j) {
    if (!ready.value || asked?.id !== id || !asked.done) {
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
