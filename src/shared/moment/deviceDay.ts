/* A day of the team from the phone's copy (the shape of team_map), as every map of the moment pickers draws it. */
import { activeTrucks } from '../../data/select';
import { fromDevice } from '../map/device';
import type { TeamMapAnswer } from '../map/assemble';

/** the day as it is, without the appointment being moved (it is not in its old place any more), and without the
    vehicles switched off that hold nothing that day (a new stop must never be put on one: « Arrêt 1 sur 1 » of a
    vehicle nobody drives) */
export function dayOf(day: string, exclude?: string | null): TeamMapAnswer {
  const d = fromDevice(day);
  const jobs = exclude ? d.jobs.filter((j) => j.id !== exclude) : d.jobs;
  const on = new Set(activeTrucks.value.map((x) => x.id));
  return { ...d, jobs, trucks: d.trucks.filter((tr) => on.has(tr.id) || jobs.some((j) => j.truck_id === tr.id)) };
}
