/* « Ordre des arrêts » (the owner, the office, the truck's driver): the stops of this truck in this block, put in the
   order wanted (« Mahdi d'abord »). The ones on the way or there stay first. « Laisser l'app choisir » gives the order
   back to the planner. The server plans the block again at once: new arrival times for everyone. */
import { useEffect, useState } from 'preact/hooks';
import { ArrowUp, ArrowDown, ChevronsUp, Wand2 } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { clock } from '../../lib/dates';
import { allJobs, truckLabel } from '../../data/select';
import { setStopOrder } from '../../data/api';
import type { Job } from '../../data/types';
import { Sheet, Button, IconButton, Banner, run } from '../../ui';
import { jobName } from './select';
import { routeOf, putFirst, moveBy, isManual, sameOrder } from './stopOrder';
import './jobs.css';

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
  const sub = `${truckLabel(p.job.truck_id)}, ${t(`common.blocks.${p.job.block}`).toLowerCase()}`;
  return (
    <Sheet open onClose={p.onClose} title={t('jobs.order.title')} sub={sub} data-testid="stop-order-sheet"
      footer={<>
        {isManual(route.booked) && <Button variant="ghost" icon={<Wand2 />} onClick={() => save([])} data-testid="stop-order-auto">{t('jobs.order.auto')}</Button>}
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!changed} onClick={() => save(ids)} data-testid="stop-order-save">{t('jobs.order.save')}</Button>
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
            const eta = !changed && j.eta_min != null ? t('jobs.order.eta', { time: clock(j.eta_min, l) }) : '';
            return (
              <li key={id} class={`jobs-order-row${id === p.job.id ? ' is-this' : ''}`} data-testid={`stop-order-${j.number}`}>
                <span class="jobs-order-n">{route.live.length + i + 1}</span>
                <span class="jobs-order-name"><b>{jobName(j)}</b><span class="small muted">{[`#${j.number}`, eta].filter(Boolean).join(', ')}</span></span>
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
        {changed && <Banner kind="info">{t('jobs.order.timesAfter')}</Banner>}
      </div>
    </Sheet>
  );
}
