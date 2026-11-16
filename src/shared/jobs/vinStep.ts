/* « NIV illisible » (worn plate, trailer): the job goes on without the VIN; the skip is remembered on this device only, for
   that job (localStorage his-vin-skip, the last 200). The rules of the VIN step are in domain/jobs/vin.ts. */
import { signal } from '@preact/signals';

export { vinNeeded, carsWithVin } from '../../domain/jobs/vin';

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
