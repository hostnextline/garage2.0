/* The rows of « Vue d'ensemble »: each appointment of the day with its stop number on the map and its truck's colour.
   Pure (tested in rows.test.ts). */
import type { Job } from '../../data/types';
import { UNPLACED_COLOR, type Assembled } from '../../shared/map/assemble';
import { t } from '../../lib/i18n';

export interface OverviewRow { job: Job; n: number | null; color: string; truckName: string }

// the jobs booked by arrival window ('day') come after the blocks (their own list on the screen), by arrival time
const ORDER: Record<string, number> = { am: 0, pm: 1, eve: 2, day: 3 };

/** in block order, then the arrival time; the number and colour are the ones of the map. A job on a truck the map does
    not show (yet) keeps its own truck and stop number (`truckOf`: the name and colour of a truck), never « À placer ». */
export function overviewRows(jobs: Job[], m: Assembled, truckOf: (id: string) => { name: string; color: string } | null = () => null): OverviewRow[] {
  const byId = new Map<string, { n: number; color: string; name: string }>();
  for (const tr of m.trucks) for (const s of tr.stops) byId.set(s.id, { n: s.n, color: tr.color, name: tr.name });
  return jobs
    .slice()
    .sort((a, b) => ((ORDER[a.block] ?? 9) - (ORDER[b.block] ?? 9)) || ((a.eta_min ?? 9999) - (b.eta_min ?? 9999)) || ((a.number ?? 0) - (b.number ?? 0)))
    .map((job) => {
      const s = byId.get(job.id);
      if (s) return { job, n: s.n, color: s.color, truckName: s.name };
      const own = job.truck_id ? truckOf(job.truck_id) : null;
      return own ? { job, n: job.stop_order ?? null, color: own.color, truckName: own.name } : { job, n: null, color: UNPLACED_COLOR, truckName: t('overview.unplaced') };
    });
}
