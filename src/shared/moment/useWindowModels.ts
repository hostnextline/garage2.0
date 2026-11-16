/* « Plages d'arrivée »: the days of the time calendar, built from the server's answers and the phone's copy of each
   day. Each day is built again only when something of THAT day changes (its answer, its appointments, the moment
   chosen or moved on it, the clock's quarter hour…): one day's answer arriving does not redraw the six other columns,
   and two different answers with the same number of rows are never taken for the same. */
import { useRef } from 'preact/hooks';
import { t, type Lang } from '../../lib/i18n';
import { clock, type Day, type Range } from '../../lib/dates';
import { blocks, jobsOn, settings, truckColor, truckRanges } from '../../data/select';
import type { Job } from '../../data/types';
import type { BlockChoice } from '../../domain/moment/choice';
import type { WindowOf } from '../../domain/moment/units';
import { jobPerson } from '../../domain/jobs/words';
import { gridJobs, windowDay, workedOf, type DayWins, type WindowDay } from './windowDays';
import type { DayRow } from './moments';

/** what the phone holds of a day's appointments, in a few characters (a change asks the server again) */
export function dayStamp(day: Day): string {
  return jobsOn(day).map((j) => `${j.id}:${j.status}:${j.eta_min ?? ''}:${j.truck_id ?? ''}:${j.win_start ?? ''}:${j.duration_min}`).join(',');
}

export interface ModelsInput {
  days: Day[]; today: Day; now: number; span: Range; len: number; windowOf: WindowOf; l: Lang;
  winsOf: (day: Day) => DayWins;
  /** the vehicles that can take the job (their hours make the units « off » or not) */
  trucks: { id: string }[];
  truckId: string | null;
  picked: BlockChoice | null;
  moving: Job | undefined;
  exclude: string | null;
  bestOf: (day: Day) => DayRow | undefined;
  farOf: (day: Day) => boolean;
}

const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function useWindowModels(i: ModelsInput): WindowDay[] {
  const cache = useRef(new Map<Day, { sig: unknown[]; model: WindowDay }>());
  // only the days shown are kept (paging for a while does not pile up every day ever drawn)
  for (const d of [...cache.current.keys()]) if (!i.days.includes(d)) cache.current.delete(d);
  return i.days.map((d) => {
    const w = i.winsOf(d);
    const stamp = dayStamp(d);
    const pk = i.picked && i.picked.day === d ? i.picked : null;
    const mv = i.moving && i.moving.day === d ? i.moving : null;
    const best = i.bestOf(d);
    const far = i.farOf(d);
    const ranges = i.trucks.map((tr) => truckRanges(tr.id, d));
    // the window rule (windowOf) reads the booking settings: a change of them draws every day again
    const sig = [w, stamp, JSON.stringify(ranges), blocks.value, settings.value.booking, pk?.win_start, pk?.win_end, pk?.eta, mv?.block, mv?.eta_min, mv?.win_start, mv?.duration_min, best, far,
      i.today, Math.floor(i.now / 15), i.span[0], i.span[1], i.len, i.windowOf, i.truckId, i.exclude, i.l];
    const hit = cache.current.get(d);
    if (hit && same(hit.sig, sig)) return hit.model;
    const model = windowDay({
      day: d, today: i.today, now: i.now, span: i.span, len: i.len, windowOf: i.windowOf, wins: w, truckId: i.truckId,
      worked: workedOf(ranges, i.span),
      picked: pk, moving: mv ?? null, best, far,
      jobs: gridJobs(jobsOn(d), i.span, { exclude: i.exclude, blocks: blocks.value, nameOf: (j) => jobPerson(j), colorOf: truckColor,
        labelOf: (name, at) => t('booking.win.grid.job', { name, time: clock(at, i.l) }) })
    });
    cache.current.set(d, { sig, model });
    return model;
  });
}
