/* The rows of « Vue d'ensemble »: each appointment of the day with its stop number on the map and its truck's colour.
   Pure (tested in rows.test.ts). */
import type { Job } from '../../data/types';
import { UNPLACED_COLOR, type Assembled } from '../map/assemble';
import { t } from '../../lib/i18n';

export interface OverviewRow { job: Job; n: number | null; color: string; truckName: string }

const ORDER: Record<string, number> = { am: 0, pm: 1, eve: 2 };

/** in block order, then the arrival time; the number and colour are the ones of the map */
export function overviewRows(jobs: Job[], m: Assembled): OverviewRow[] {
  const byId = new Map<string, { n: number; color: string; name: string }>();
  for (const tr of m.trucks) for (const s of tr.stops) byId.set(s.id, { n: s.n, color: tr.color, name: tr.name });
  return jobs
    .slice()
    .sort((a, b) => ((ORDER[a.block] ?? 9) - (ORDER[b.block] ?? 9)) || ((a.eta_min ?? 9999) - (b.eta_min ?? 9999)) || ((a.number ?? 0) - (b.number ?? 0)))
    .map((job) => {
      const s = byId.get(job.id);
      return { job, n: s?.n ?? null, color: s?.color ?? UNPLACED_COLOR, truckName: s?.name ?? t('overview.unplaced') };
    });
}
