/* A truck's sheet: the coming appointments a change of the truck touches (taken out of service; its tire machine taken
   away, for the work that needs it). Pure (trucks.test.ts). */
import type { Job, Truck } from '../../data/types';

export function comingTouched(jobs: Job[], before: Pick<Truck, 'id' | 'active' | 'tire_machine'>, after: { active: boolean; tire_machine: boolean }, today: string): { why: 'off' | 'machine'; jobs: Job[] } | null {
  const coming = jobs.filter((j) => j.truck_id === before.id && j.status === 'booked' && !j.deleted_at && j.day >= today);
  if (before.active && !after.active) return coming.length ? { why: 'off', jobs: coming } : null;
  if (before.tire_machine !== false && !after.tire_machine) {
    const need = coming.filter((j) => j.needs_machine);
    return need.length ? { why: 'machine', jobs: need } : null;
  }
  return null;
}
