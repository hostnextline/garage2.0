/* « Le rendez-vous » on the job sheet: the day, the block or the window told to the customer (with « Hors plage »), the
   stop and its planned arrival, the truck, the length (changed by 15 minutes before the visit), the times left / arrived /
   finished, who booked it; « Déplacer » and « Ordre des arrêts ». */
import { useEffect, useState } from 'preact/hooks';
import { CalendarClock, ListOrdered } from 'lucide-preact';
import type { Job } from '../../data/types';
import { Panel, Button, Field, Stepper, Kv, Banner, Pill, toast } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { duration, clock } from '../../lib/dates';
import { truckLabel, staffName } from '../../data/select';
import { setJobDuration, errorMessage } from '../../data/api';
import type { JobRights } from '../../domain/jobs/rights';
import { bookedBy } from '../../shared/jobs/bookedBy';
import { dayWord, blockRange, clockOf, isWindowJob, outsideWindow, wt, capFirst, etaUnsure } from '../../shared/jobs/select';

function DurationEditor(p: { job: Job }) {
  const { job: j } = p;
  const [v, setV] = useState(j.duration_min);
  const [err, setErr] = useState<string | null>(null);
  // the server's length changed (another phone, the planner): the stepper starts again from it
  useEffect(() => { setV(j.duration_min); setErr(null); }, [j.duration_min]);
  const save = async () => {
    try {
      const r = await setJobDuration(j.id, v);
      toast((r as { queued?: boolean }).queued ? t('shell.queued') : t('jobs.moment.durationSaved', { time: duration(v, lang.value) }), { kind: 'ok' });
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <Field label={t('jobs.moment.durationLabel')} error={err} group>
      <div class="row-wrap">
        <Stepper value={v} onValue={(x) => { setV(x); setErr(null); }} step={15} min={15} max={720} format={(x) => duration(x, lang.value)} label={t('jobs.moment.durationLabel')} />
        {v !== j.duration_min && <Button size="sm" variant="primary" onClick={save} data-testid="duration-save">{t('jobs.moment.keep', { time: duration(v, lang.value) })}</Button>}
      </div>
    </Field>
  );
}

export function MomentPanel(p: { job: Job; rights: JobRights; onMove: () => void; onOrder: () => void }) {
  const { job: j, rights } = p;
  const l = lang.value;
  const booked = j.status === 'booked';
  const byWho = bookedBy(j, staffName(j.created_by), l);
  const stop = j.stop_order != null && j.status !== 'cancelled' && j.status !== 'no_show'
    ? (booked && etaUnsure(j) ? t('jobs.moment.stopValueUnsure', { n: j.stop_order })
      : j.eta_min != null && booked ? t('jobs.moment.stopValue', { n: j.stop_order, time: clock(j.eta_min, l) }) : String(j.stop_order)) : null;
  const late = outsideWindow(j);
  return (
    <Panel title={t('jobs.moment.title')} help={booked && rights.duration ? wt(j, 'jobs.moment.help') : undefined} class="jobs-moment" data-testid="job-moment">
      <div class="stack">
        <Kv items={[
          [t('jobs.moment.day'), dayWord(j.day)],
          isWindowJob(j)
            ? [t('jobs.win.label'), <span data-testid="job-window">{capFirst(blockRange(j))}{late && <> <Pill tone="warn" data-testid="job-window-late">{t('common.window.late')}</Pill></>}</span>]
            : [t('jobs.moment.block'), t('jobs.moment.blockValue', { block: t(`common.blocks.${j.block}`), range: blockRange(j) })],
          [t('jobs.moment.stop'), stop],
          [t('jobs.moment.truck'), truckLabel(j.truck_id) || null],
          [t('jobs.moment.duration'), booked && rights.duration ? null : duration(j.duration_min, l)],
          [t('jobs.moment.left'), clockOf(j.started_at) || null],
          [t('jobs.moment.arrived'), clockOf(j.arrived_at) || null],
          [t('jobs.moment.finished'), clockOf(j.finished_at) || null],
          [t('jobs.moment.booked'), byWho ? <span data-testid="job-booked-by">{byWho}</span> : null]
        ]} />
        {late && <Banner kind="warn" data-testid="job-late">{t('jobs.win.lateText', { time: clock(j.eta_min!, l), window: blockRange(j) })}</Banner>}
        {booked && rights.duration && <DurationEditor job={j} />}
        {booked && (rights.move || (rights.order && !!j.truck_id)) && (
          <div class="row-wrap">
            {rights.move && <Button icon={<CalendarClock />} onClick={p.onMove} data-testid="job-move">{t('jobs.moment.move')}</Button>}
            {rights.order && !!j.truck_id && <Button icon={<ListOrdered />} onClick={p.onOrder} data-testid="job-order">{t('jobs.order.open')}</Button>}
          </div>
        )}
      </div>
    </Panel>
  );
}
