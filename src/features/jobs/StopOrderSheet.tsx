/* « Ordre des arrêts » (the owner, the office, the truck's driver): the stops of this truck in this block (its whole day when the
   jobs are booked by arrival window), put in the
   order wanted (« Mahdi d'abord »). The ones on the way or there stay first. « Laisser l'app choisir » gives the order
   back to the planner. The server plans the block again at once: new arrival times for everyone.
   « Plages d'arrivée »: each stop shows the window told to the customer; an order that would probably reach one outside
   its window is said before saving (a guess from the times shown), and a stop already outside is marked « Hors plage ».
   « Vraies routes » on: no guess. The arrival times of the order built, and who would be late (after the window, else
   the block, told), are the server's (stop_order_preview: set_stop_order run and undone), asked a short moment after the
   last change (previews.ts); until it answers, or when it does not: no time, no warning, « Heures d'arrivée : pas encore
   calculées », and « Enregistrer » still works. A stop whose trips are not all measured (the server's `measured` false):
   « heure : trajets pas encore mesurés », no time, no « late » (domain/jobs/stopOrder.ts serverOrder). */
import { useEffect, useState } from 'preact/hooks';
import { ArrowUp, ArrowDown, ChevronsUp, Wand2 } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { clock } from '../../lib/dates';
import { allJobs, truckLabel, settings, roadsOn } from '../../data/select';
import { setStopOrder } from '../../data/api';
import type { Job } from '../../data/types';
import { Sheet, Button, IconButton, Banner, Pill, run } from '../../ui';
import { jobName, isWindowJob, blockRange, momentWord, outsideWindow, etaUnsure } from '../../shared/jobs/select';
import { promisedWindow } from '../../domain/jobs/when';
import { routeOf, putFirst, moveBy, isManual, sameOrder, brokenWindows, serverOrder } from '../../domain/jobs/stopOrder';
import { useOrderPreview } from './previews';
import '../../shared/jobs/jobs.css';

/** « Mettre en premier »: straight away, without the list */
export async function stopFirst(j: Job): Promise<boolean> {
  if (!j.truck_id) return false;
  const ids = routeOf(j, allJobs.value).booked.map((x) => x.id);
  const r = await run(() => setStopOrder(j.truck_id!, j.day, j.block, putFirst(ids, j.id)), { ok: t('jobs.order.firstDone', { name: jobName(j) }) });
  return r !== undefined;
}

export function StopOrderSheet(p: { job: Job; open: boolean; onClose: () => void }) {
  if (!p.open || !p.job.truck_id) return null;
  return <Open job={p.job} onClose={p.onClose} />;
}

function Open(p: { job: Job; onClose: () => void }) {
  const l = lang.value;
  const route = routeOf(p.job, allJobs.value);
  const start = route.booked.map((j) => j.id);
  const [ids, setIds] = useState<string[]>(start);
  // a stop that left or was moved meanwhile: drop it, add the new ones at the end
  useEffect(() => {
    setIds((cur) => [...cur.filter((x) => start.includes(x)), ...start.filter((x) => !cur.includes(x))]);
  }, [start.join(',')]);
  const byId = new Map(route.booked.map((j) => [j.id, j]));
  const changed = !sameOrder(ids, start);
  const save = async (list: string[]) => {
    const r = await run(() => setStopOrder(p.job.truck_id!, p.job.day, p.job.block, list), { ok: list.length ? t('jobs.order.saved') : t('jobs.order.autoDone') });
    if (r !== undefined) p.onClose();
  };
  const win = isWindowJob(p.job);
  const sub = `${truckLabel(p.job.truck_id)}, ${win ? t('jobs.win.order.wholeDay') : momentWord(p.job)}`;
  const on = roadsOn.value;
  // switch on: the server's times for the order on screen (only once it differs from the planner's)
  const asked = useOrderPreview(on && changed, p.job.truck_id, p.job.day, p.job.block, ids);
  const server = asked.kind === 'done' ? serverOrder(asked.answer, ids) : null;
  // switch off: the new order, guessed from the times shown: who would be reached after their window
  const broken = !on && win && changed ? brokenWindows(ids, route.booked, settings.value.booking.unknown_min) : null;
  const late = on ? new Map((server?.late || []).map((id) => [id, server!.byId.get(id)!.eta])) : new Map((broken || []).map((x) => [x.job.id, x.eta]));
  const lateNames = on ? (server?.late || []).map((id) => jobName(byId.get(id)!)).filter(Boolean) : (broken || []).map((x) => jobName(x.job));
  return (
    <Sheet open onClose={p.onClose} title={t('jobs.order.title')} sub={sub} data-testid="stop-order-sheet"
      footer={<>
        {isManual(route.booked) && <Button variant="ghost" icon={<Wand2 />} onClick={() => save([])} data-testid="stop-order-auto">{t('jobs.order.auto')}</Button>}
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!changed} onClick={() => save(ids)} data-testid="stop-order-save">{late.size ? t('jobs.win.order.saveAnyway') : t('jobs.order.save')}</Button>
      </>}>
      <div class="stack">
        <p class="small muted" style={{ margin: 0 }}>{t('jobs.order.lead')}</p>
        <ol class="jobs-order" data-testid="stop-order-list">
          {route.live.map((j) => (
            <li key={j.id} class="jobs-order-row is-live">
              <span class="jobs-order-n" aria-hidden="true">•</span>
              <span class="jobs-order-name"><b>{jobName(j)}</b><span class="small muted">{t(`jobs.order.live.${j.status}`)}</span></span>
            </li>
          ))}
          {ids.map((id, i) => {
            const j = byId.get(id);
            if (!j) return null;
            const said = on && changed ? server?.byId.get(id)?.eta ?? null : null;
            // a stop whose trips are not all measured: no arrival time (and never « late » from a guess)
            const unsure = on && changed && server?.byId.get(id)?.unmeasured === true;
            // the order as it is: the plan's time, or no time while a trip before that stop is not measured (final-guess G1)
            const eta = !changed && etaUnsure(j) ? t('jobs.order.etaUnmeasured')
              : !changed && j.eta_min != null ? t('jobs.order.eta', { time: clock(j.eta_min, l) })
              : on ? (unsure ? t('jobs.order.etaUnmeasured') : said != null ? t('jobs.order.eta', { time: clock(said, l) }) : '')
                : late.has(id) ? t('jobs.win.order.about', { time: clock(late.get(id)!, l) }) : '';
            const told = isWindowJob(j) ? t('jobs.win.order.told', { window: blockRange(j, l) }) : '';
            const out = late.has(id) || (!changed && outsideWindow(j));
            // the server says late for a block job too (after the block told), or for a window job with no window told yet
            // (« flexible », late after the day): « En retard »; a window told and missed: « Hors plage »
            const outWord = promisedWindow(j) ? t('common.window.late') : t('jobs.order.late');
            return (
              <li key={id} class={`jobs-order-row${id === p.job.id ? ' is-this' : ''}`} data-testid={`stop-order-${j.number}`}>
                <span class="jobs-order-n">{route.live.length + i + 1}</span>
                <span class="jobs-order-name"><b>{jobName(j)}</b><span class="small muted">{[`#${j.number}`, eta, told].filter(Boolean).join(', ')}</span>{out && <Pill tone="warn" data-testid={`stop-late-${j.number}`}>{outWord}</Pill>}</span>
                <span class="jobs-order-btns">
                  <IconButton icon={<ChevronsUp />} label={t('jobs.order.first', { name: jobName(j) })} disabled={i === 0} onClick={() => setIds(putFirst(ids, id))} data-testid={`stop-first-${j.number}`} />
                  <IconButton icon={<ArrowUp />} label={t('jobs.order.up', { name: jobName(j) })} disabled={i === 0} onClick={() => setIds(moveBy(ids, id, -1))} />
                  <IconButton icon={<ArrowDown />} label={t('jobs.order.down', { name: jobName(j) })} disabled={i === ids.length - 1} onClick={() => setIds(moveBy(ids, id, 1))} />
                </span>
              </li>
            );
          })}
        </ol>
        {!ids.length && <p class="muted" style={{ margin: 0 }}>{t('jobs.order.none')}</p>}
        {/* switch on: one line says the times are not worked out yet (the pending line below), not two */}
        {changed && !on && <Banner kind="info">{t('jobs.order.timesAfter')}</Banner>}
        {on && changed && !server && <p class="small muted" style={{ margin: 0 }} data-testid="stop-order-pending">{t('jobs.order.pending')}</p>}
        {on && changed && server && <p class="small muted" style={{ margin: 0 }} data-testid="stop-order-server">{t('jobs.order.serverTimes')}</p>}
        {late.size > 0 && <Banner kind="warn" data-testid="stop-order-late">{on ? t('jobs.order.lateServer', { n: late.size, names: lateNames.join(', ') }) : t('jobs.win.order.breaks', { n: late.size, names: lateNames.join(', ') })}</Banner>}
        {win && !late.size && (on || !changed || broken == null) && <p class="small muted" style={{ margin: 0 }} data-testid="stop-order-note">{t('jobs.win.order.note')}</p>}
      </div>
    </Sheet>
  );
}
