/* « Le NIV de l’auto »: before the work starts (once on site), the job's car must be known by its VIN: scanned, typed, or one
   of the customer's cars that already has one. A VIN that cannot be read (worn plate, trailer) is skipped by hand; the skip
   is remembered on this device only, for that job. */
import { signal } from '@preact/signals';
import type { Job, Vehicle } from '../../data/types';

const KEY = 'his-vin-skip';
function read(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
export const vinSkips = signal<string[]>(read());
export function skipVin(jobId: string) {
  if (vinSkips.value.includes(jobId)) return;
  vinSkips.value = [...vinSkips.value, jobId].slice(-200);
  try { localStorage.setItem(KEY, JSON.stringify(vinSkips.value)); } catch { /* private mode: kept until the app closes */ }
}

/** the job is on site and its car is not known by a VIN yet (no car on the job, or a car without VIN), and nobody said « illisible » */
export function vinNeeded(j: Pick<Job, 'id' | 'status' | 'vehicle_id'>, car: Pick<Vehicle, 'vin' | 'deleted_at'> | null | undefined, skips: string[]): boolean {
  if (j.status !== 'on_site' || skips.includes(j.id)) return false;
  return !car || !!car.deleted_at || !car.vin;
}
/** the customer's cars the mechanic may pick instead of scanning: they already have a VIN */
export function carsWithVin<T extends Pick<Vehicle, 'id' | 'vin' | 'deleted_at'>>(cars: T[], current: string | null | undefined): T[] {
  return cars.filter((v) => !v.deleted_at && !!v.vin && v.id !== current);
}
