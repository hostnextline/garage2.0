/* « Le NIV de l’auto » before the work starts: is it needed, which cars of the customer can be picked, and what a VIN
   given for a job does to the customer's file. Pure (tested in vin.test.ts). */
import type { Job, Vehicle } from '../../data/types';
import { vinYear } from '../../lib/text';

/** the job is on site and its car is not known by a VIN yet (no car on the job, or a car without VIN), and nobody said « illisible » */
export function vinNeeded(j: Pick<Job, 'id' | 'status' | 'vehicle_id'>, car: Pick<Vehicle, 'vin' | 'deleted_at'> | null | undefined, skips: string[]): boolean {
  if (j.status !== 'on_site' || skips.includes(j.id)) return false;
  return !car || !!car.deleted_at || !car.vin;
}
/** the customer's cars the mechanic may pick instead of scanning: they already have a VIN */
export function carsWithVin<T extends Pick<Vehicle, 'id' | 'vin' | 'deleted_at'>>(cars: T[], current: string | null | undefined): T[] {
  return cars.filter((v) => !v.deleted_at && !!v.vin && v.id !== current);
}

type Car = Pick<Vehicle, 'id' | 'vin' | 'deleted_at'> & Partial<Pick<Vehicle, 'year' | 'make' | 'model'>>;
export type VinPlan = { kind: 'link'; id: string } | { kind: 'set'; id: string } | { kind: 'adopt'; id: string } | { kind: 'new' } | { kind: 'none' };
const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** the customer's car without VIN that is this one: the only one that does not say otherwise (its year against the
    VIN's year, its make and model against what the VIN says when it was read); none when it cannot be told */
function carWithoutVin(vin: string, cars: Car[], said: Partial<Pick<Vehicle, 'year' | 'make' | 'model'>>): Car | null {
  const year = said.year ?? vinYear(vin);
  const fits = cars.filter((v) => !v.deleted_at && !v.vin
    && (!v.year || !year || Number(v.year) === Number(year))
    && (!v.make || !said.make || same(v.make, said.make))
    && (!v.model || !said.model || same(v.model, said.model)));
  return fits.length === 1 ? fits[0] : null;
}

/** what to do with a VIN given for a job: the customer's car that already has it becomes the job's car; else it goes on
    the job's car (which has none); a job with no car takes the customer's car without VIN that is this one (« adopt »:
    the VIN goes on it, before a second file of the same car was made), else a new car is made from the VIN. */
export function vinPlan(vin: string, car: Pick<Vehicle, 'id' | 'vin'> | null, customerCars: Car[], said: Partial<Pick<Vehicle, 'year' | 'make' | 'model'>> = {}): VinPlan {
  const known = customerCars.find((v) => !v.deleted_at && !!v.vin && v.vin.toUpperCase() === vin.toUpperCase());
  if (known) return known.id === car?.id ? { kind: 'none' } : { kind: 'link', id: known.id };
  if (car && !car.vin) return { kind: 'set', id: car.id };
  if (car) return { kind: 'none' };
  const mine = carWithoutVin(vin, customerCars, said);
  return mine ? { kind: 'adopt', id: mine.id } : { kind: 'new' };
}
