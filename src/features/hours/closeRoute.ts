/* « La voiture ferme » with the real roads on (« Vraies routes », CONTRACT §2.6): the other vehicle's day with the moved
   appointments in it is the SERVER's answer (move_preview runs move_job for each and undoes it), never the phone's
   straight-line insertion (shared/moment/preview.ts `moveStops`, kept for the switch off).
   - serverDay: the vehicle's stops in the server's order (numbered in that order), each with the server's arrival; a
     move the server refused is not on it.
   - dayAsItIs: while the server is asked, or when it gives no answer: the vehicle's day as it is (its own order, the
     server's of before); the moved appointments are drawn apart as pins without numbers (movedPins), no line through
     them and no « Route de la journée » with them.
   - useMovePreview: asks once per vehicle, day and list (remembered while the sheet is open), again when a measure of
     the roads ended (roadsTick), keeping the answer on screen meanwhile. Pure parts tested in closeRoute.test.ts, the
     screen in CloseDaySheet.test.tsx. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { movePreview, roadsTick, type MovePreview } from '../../data/roads';
import type { TeamMapAnswer } from '../../shared/map/assemble';
import type { MapMarker } from '../../shared/map/markers';
import { NEW_STOP_COLOR } from '../../shared/moment/preview';
import { NOT_ASKED, Answers, type Asked } from '../../domain/jobs/asked';

export type { Asked };


/** the day with the moved appointments where the SERVER puts them: the vehicle's stops are exactly the answer's
    `order` (numbered 1, 2, 3… in that order: assemble sorts by block, then this order), each with the server's arrival.
    A stop of that vehicle the answer does not list is not drawn on it (the server's day is the one shown); a moved
    appointment the server refused stays where it is (not on this vehicle). */
export function serverDay(a: TeamMapAnswer, truckId: string, p: Pick<MovePreview, 'order' | 'eta'>): TeamMapAnswer {
  const at = new Map(p.order.map((id, i) => [id, i]));
  const jobs = a.jobs
    .filter((j) => at.has(j.id) || j.truck_id !== truckId)
    .map((j) => (at.has(j.id) ? { ...j, truck_id: truckId, order: at.get(j.id)! + 1, eta_min: p.eta[j.id] ?? null } : j));
  return { ...a, jobs };
}

/** the day as it is, without the appointments being moved (they are drawn apart: movedPins) */
export function dayAsItIs(a: TeamMapAnswer, moved: readonly string[]): TeamMapAnswer {
  const out = new Set(moved);
  return { ...a, jobs: a.jobs.filter((j) => !out.has(j.id)) };
}

/** the moved appointments as black pins WITHOUT a number (their place in the route is not known yet) */
export function movedPins(a: TeamMapAnswer, moved: readonly string[]): MapMarker[] {
  return moved.flatMap((id): MapMarker[] => {
    const j = a.jobs.find((x) => x.id === id);
    if (!j || j.lat == null || j.lng == null || !Number.isFinite(j.lat) || !Number.isFinite(j.lng)) return [];
    return [{ id: j.id, kind: 'job', lat: j.lat, lng: j.lng, color: NEW_STOP_COLOR, number: null, active: true, label: j.name || undefined, title: j.name || '' }];
  });
}

/** where the vehicle's route starts (its own start, else « Départ des camions »): for a day where it has no stop yet */
export function startOf(a: TeamMapAnswer, truckId: string | null): { lat: number; lng: number; label: string | null; own: boolean } | null {
  const tr = truckId ? a.trucks.find((x) => x.id === truckId) : undefined;
  if (tr?.start) return { lat: tr.start.lat, lng: tr.start.lng, label: tr.start.label, own: true };
  return a.home && a.home.lat != null && a.home.lng != null ? { lat: a.home.lat, lng: a.home.lng, label: a.home.label ?? null, own: false } : null;
}

/** move_preview for that vehicle, day and list, while `on` (the switch « Vraies routes »). An EMPTY list is asked too (a
    day of the sheet where nothing goes to that vehicle: the server's day as it is, with its « Route de la journée »;
    review-sheets L1). Once per vehicle, day and list while the sheet is open; a measure of the roads that ends
    (roadsTick) asks again and the answer on screen stays until the new one replaces it (Answers, review L2). Never throws. */
export function useMovePreview(on: boolean, truckId: string | null, day: string, ids: readonly string[]): Asked<MovePreview> {
  const tick = roadsTick.value;
  const key = on && truckId ? `${truckId}|${day}|${ids.join(',')}` : '';
  const memo = useRef(new Answers<MovePreview>());
  const live = useRef(true);
  const [, redraw] = useState(0);
  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => {
    if (!key || !memo.current.start(key, tick)) return;
    // an answer is kept under ITS list: the person may be on another day meanwhile, it shows when they come back
    const said = (v: MovePreview | null | undefined) => { if (memo.current.take(key, tick, v) && live.current) redraw((x) => x + 1); };
    movePreview(truckId!, day, null, [...ids]).then(said, () => said(undefined));
  }, [key, tick]);
  return key ? memo.current.shown(key) : NOT_ASKED;
}
