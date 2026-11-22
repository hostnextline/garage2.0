/* What is still missing before « Réserver », in the order of the form. Pure (check.test.ts). */
import type { BlockChoice } from '../../domain/moment/choice';
import type { Caller } from './draft';

export type Missing = 'quote' | 'customer' | 'caller' | 'cars' | 'work' | 'truck' | 'block' | null;
/** a car typed for a new caller: nothing typed, typed right, or typed wrong (a year, a VIN…) */
export type CarState = 'empty' | 'ok' | 'bad';
export interface CallCarCheck { id: string; state: CarState; work: number }

/** one may leave a typed car empty; with several, a car that has work must be said (an empty one without work is
    simply not made) */
export function carBad(c: CallCarCheck, count: number): boolean {
  return c.state === 'empty' ? count > 1 && c.work > 0 : c.state === 'bad';
}
export const callerOk = (c: Caller, digits: (phone: string) => string | null | undefined): boolean => !!c.first.trim() && !!digits(c.phone);

export interface CheckInput {
  walkIn: boolean;
  /** the estimate is already booked (its appointment is still on) */
  quoteDone: boolean;
  customerId: string | null;
  /** « Appel entrant », nobody chosen: the name, the number and the cars typed make the customer */
  newCaller: boolean;
  /** the search of a known customer is open instead of the new caller's fields */
  searchKnown: boolean;
  callerOk: boolean;
  callCars: CallCarCheck[];
  /** cars that have work to book */
  planned: number;
  /** the vehicle must be chosen by hand (a walk-in nobody drives, or several vehicles one could mean) */
  truckNeeded: boolean;
  truckId: string | null;
  choice: BlockChoice | null;
}
/** the vehicle already chosen when the person must say it (R73): a walk-in is done now, on the route this person does
    now (« La route que je fais » of « Ma journée », Routes partagées), when it is one of theirs and one of the vehicles to
    choose from. The choice stays on screen and can be changed; null: nothing chosen for the person */
export function routeDefault(o: { walkIn: boolean; needed: boolean; stored: string | null; from: readonly string[]; mine: readonly string[] }): string | null {
  if (!o.walkIn || !o.needed || !o.stored || o.mine.length < 2) return null;
  return o.from.includes(o.stored) && o.mine.includes(o.stored) ? o.stored : null;
}

/** the first missing piece; null: « Réserver » may go */
export function missing(i: CheckInput): Missing {
  if (i.quoteDone) return 'quote';
  if (!i.customerId) {
    // only the fields on screen can make a customer: with the search open, somebody must be chosen
    if (!i.newCaller || i.searchKnown) return 'customer';
    if (!i.callerOk) return 'caller';
    if (i.callCars.some((c) => carBad(c, i.callCars.length))) return 'cars';
  }
  if (i.planned === 0) return 'work';
  if (i.truckNeeded && !i.truckId) return 'truck';
  if (!i.walkIn && !i.choice) return 'block';
  return null;
}
/** the button stays tappable when the tap can show what to fix (the new caller's name, number and cars); otherwise
    the line under it says what to do first */
export const showsFix = (m: Missing): boolean => m === 'caller' || m === 'cars';
