/* « Garde-route » at the moment of « Réserver »: the picker warns about the moments it scored, but it does not know
   every case (a day after its first 14, an address or a work changed a moment ago, a vehicle chosen by hand, the
   arrival-windows calendar). So the moment chosen is asked again, alone, for exactly this address, work and vehicle,
   just before booking. Never in the way: no network, a slow answer or no score = nothing is asked. */
import { farInfo, type FarInfo, type FarLimits, type Moment } from '../../domain/moment/logic';
import type { BlockChoice } from '../../domain/moment/choice';
import type { Lang } from '../../lib/i18n';

type Scored = Moment & { truck?: string | null };

/** the score of the moment chosen among the server's answer for its day; null when it is not there (a full block is
    not offered), or when it is another vehicle's (a vehicle chosen by hand: the planner scored the one it prefers) */
export function farOfAnswer(rows: Scored[], choice: Pick<BlockChoice, 'day' | 'block'>, truckId: string | null, lim: FarLimits, l: Lang): FarInfo | null {
  const row = rows.find((r) => r.day === choice.day && r.block === choice.block);
  if (!row || (truckId && row.truck && row.truck !== truckId)) return null;
  return farInfo(row, lim, l);
}

/** the answer, or nothing after `ms` (the booking does not wait for a slow server) */
export async function inTime<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  try { return await Promise.race([p.catch(() => fallback), late]); } finally { clearTimeout(timer); }
}
