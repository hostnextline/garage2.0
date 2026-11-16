/* How full a truck is, and whether a place still books: pure (load.test.ts).
   The planner counts a job under way only for the time it still needs; a day of arrival windows is over at its last
   hour, and « closed » means nobody works that day at all, not « too little of it is left now ». */
import type { Range } from '../../lib/dates';

type Timed = { status: string; duration_min: number; travel_min: number | null; eta_min: number | null };

/** the minutes a job still takes out of its truck's hours from `now` (minutes of the day; null: not today, every job
    counts whole). On site: what is left of its work. On the way: the drive left, then the work. Done: nothing. */
export function timeLeft(j: Timed, now: number | null, arrivedMin: number | null, unknownMin: number): number {
  if (j.status === 'done') return 0;
  if (now != null && j.status === 'on_site') return Math.max(0, (arrivedMin ?? now) + j.duration_min - now);
  if (now != null && j.status === 'en_route') return (j.eta_min != null ? Math.max(0, j.eta_min - now) : j.travel_min ?? unknownMin) + j.duration_min;
  return j.duration_min + (j.travel_min ?? unknownMin);
}
/** what a truck's jobs still take (`arrivedOf` reads a job's arrival as minutes of the day) */
export function usedBy<J extends Timed>(jobs: readonly J[], now: number | null, arrivedOf: (j: J) => number | null, unknownMin: number): number {
  return jobs.reduce((n, j) => n + timeLeft(j, now, j.status === 'on_site' ? arrivedOf(j) : null, unknownMin), 0);
}

export interface PlaceState { started: boolean; open: boolean; closed: boolean }
/** a whole day as a booking place (« Plages d'arrivée »): over once its last hour has passed (not when it starts, as a
    block does); open while a truck still has enough hours left in it; closed only when no truck works that day at all
    (late in the day it is neither open nor closed: the trucks are still out on their stops). */
export function dayState(day: string, todayDay: string, now: number, span: Range, capsLeft: readonly number[], minBlock: number, worked: boolean): PlaceState {
  const started = day < todayDay || (day === todayDay && now >= span[1]);
  const need = Math.min(minBlock, span[1] - span[0]);
  const open = !started && capsLeft.some((c) => c > 0 && c >= need);
  return { started, open, closed: !started && !open && !worked };
}
/** a block as a booking place: started at its first minute; closed when it neither books nor has started */
export function blockState(s: { started: boolean; open: boolean }): PlaceState {
  return { started: s.started, open: s.open, closed: !s.open && !s.started };
}
/** some truck still has room for a short job (the garage's shortest block, not a number written in the code) */
export function hasRoom(lanes: readonly { cap: number; left: number }[], minBlock: number): boolean {
  return lanes.some((x) => x.cap >= minBlock && x.left >= minBlock);
}
