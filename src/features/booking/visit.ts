/* What « Réserver » sends: one appointment per car that has work, in the same moment. Pure (visit.test.ts). */
import { bookSummary, toItemInputs, choicePayload } from '../../domain/moment/logic';
import type { BlockChoice, VehicleKind } from '../../domain/moment/choice';
import type { BookInput, ItemInput } from '../../data/api';
import type { TaxRates } from '../../lib/money';
import type { PlannedCar } from './draft';

/** what every car's appointment shares: the customer, the place, the notes, the options */
export type VisitBase = Omit<BookInput, 'id' | 'day' | 'block' | 'vehicle_id' | 'duration_min' | 'problem' | 'win_start' | 'win_flex' | 'force'>;
export interface VisitJob { key: string; job: BookInput; lines: ItemInput[] }

/** the minutes a car's work books (its lines, or the duration chosen by hand, or 60 for a problem alone) */
export const carMinutes = (c: PlannedCar, taxes: TaxRates): number => bookSummary(c.work.items, taxes, { override: c.work.dur }).minutes;

/** the vehicle asked for. The tire machine needed by one car of several: every car goes with the truck, so one visit
    stays one vehicle in the driveway (each appointment is planned alone, and work without the machine would go to the
    car first). One car: the server reads its lines itself. */
export function kindFor(need: boolean, cars: number, kind: VehicleKind): VehicleKind {
  if (!need) return kind;
  return cars > 1 ? 'truck' : null;
}

/** each car's appointment: its own id (made once for that car), its car on file (`carOf`: null when the car has no
    file), its minutes, its problem; the estimate goes with the first one only. A walk-in has no moment. */
export function visitJobs(cars: PlannedCar[], base: VisitBase, o: { choice: BlockChoice | null; taxes: TaxRates; carOf: (key: string) => string | null }): VisitJob[] {
  return cars.map((c, k) => {
    const job: BookInput = {
      ...base, ...(o.choice ? choicePayload(o.choice) : {}), id: c.jobId, vehicle_id: o.carOf(c.key), duration_min: carMinutes(c, o.taxes),
      problem: c.work.problem.trim() || null, quote_id: k === 0 ? base.quote_id ?? null : null
    } as BookInput;
    return { key: c.key, job, lines: toItemInputs(c.work.items) };
  });
}

/** « Réserver quand même »: no window is asked (the server gives it from where the stop ends up) */
export function forcedJob(job: BookInput, choice: BlockChoice): BookInput {
  const { win_start: _w, win_flex: _f, ...rest } = job;
  return { ...rest, ...choicePayload(choice, true), force: true };
}
