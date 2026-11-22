/* What the server would do, asked before the person decides (« Vraies routes » on; off nothing is asked and the sheets
   work as before). Nothing is written: move_preview runs the action and undoes it.
   (useOrderPreview, « Ordre des arrêts », went in Part 28: « Réorganiser la journée » asks its own preview,
   src/shared/jobs/DayOrderSheet.tsx.)
   - useTruckFits (« Changer de camion »): for each truck, whether it can take the appointment and its arrival there.
   Never throw: no signal, an error, an older server → « pas encore calculé ». Tested in TruckSheet.test.tsx. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { movePreview, roadsTick } from '../../data/roads';
import { exactPreview, exactRefusal, ARRIVE_LATE } from '../../data/exact';
import type { BlockKey } from '../../lib/dates';
import { Answers, type Asked } from '../../domain/jobs/asked';
import { fitOf } from '../../domain/jobs/move';
import { exactFitOf, type ExactFit } from '../../domain/jobs/exact';

/** what the server says of one truck: it fits (its arrival there, or none while a trip of that day is not measured:
    `unmeasured`), or not */
export type Fit = Asked<ExactFit>;
/** each truck of `truckIds`: can it take this appointment (same day, same block or window), and its arrival there, or
    why not (the refusal's code). The move previewed is the one the tap sends: the 5-argument move_job (`asTold`: the
    window kept as told, fix-sql « C »); with the appointment's time kept (`at`, « exact move » A1) the exact preview of
    that minute on that truck (it keeps that time, somebody would be late, or not before …). Each truck asked once while
    the sheet is open, again when a measure of the roads ends (the answer shown kept meanwhile; an older ask answering
    last dropped: Answers). */
export function useTruckFits(on: boolean, job: { id: string; day: string; block: string }, truckIds: readonly string[], at: number | null = null): Record<string, Fit> {
  const tick = roadsTick.value;
  const base = on ? `${job.id}|${job.day}|${job.block}|${at ?? ''}` : '';
  const list = truckIds.join(',');
  const memo = useRef(new Answers<ExactFit>());
  const live = useRef(true);
  const [, redraw] = useState(0);
  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => {
    if (!base) return;
    for (const id of truckIds) {
      const k = `${id}|${base}`;
      if (!memo.current.start(k, tick)) continue;
      const said = (v: ExactFit | null | undefined) => { if (memo.current.take(k, tick, v) && live.current) redraw((x) => x + 1); };
      if (at != null) {
        exactPreview(job.id, job.day, id, at).then((a) => said(exactFitOf(a, job.id, at)), (e: unknown) => {
          // a refusal thrown (the truck cannot be there then, another rule): said; no signal, an error: not said
          const r = exactRefusal(e);
          said(r ? { fits: false, eta: null, unmeasured: false, why: r.code, ...(r.code === ARRIVE_LATE ? { earliest: r.earliest } : {}) } : undefined);
        });
      } else movePreview(id, job.day, job.block as BlockKey, [job.id], { asTold: true }).then((a) => said(fitOf(a, job.id)), () => said(undefined));
    }
  }, [base, list, tick]);
  if (!base) return {};
  return Object.fromEntries(truckIds.map((id) => [id, memo.current.shown(`${id}|${base}`)]));
}
