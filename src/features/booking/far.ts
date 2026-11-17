/* « Garde-route » at the moment of « Réserver »: the picker warns about the moments it scored, but it does not know
   every case (a day after its first 14, an address or a work changed a moment ago, a vehicle chosen by hand, the
   arrival-windows calendar). So the moment chosen is asked again, alone, for exactly this address, work and vehicle,
   just before booking. Never in the way: no network, a slow answer or no score = nothing is asked. */
import { farInfo, type FarInfo, type FarLimits, type FarSeen, type Moment } from '../../domain/moment/logic';
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

/** how old the picker's answer may be for « Réserver » to believe it (other bookings change a day's road) */
export const SEEN_FRESH_MS = 2 * 60_000;
/** the picker scored exactly this moment, not far, in an answer recent enough: the server need not be asked again (m2).
    Anything else (no score said, another moment, an old answer, a far one): ask */
export function seenFine(seen: FarSeen | null | undefined, far: FarInfo | null | undefined, choice: Pick<BlockChoice, 'day' | 'block'>, now: number, maxAge = SEEN_FRESH_MS): boolean {
  if (!seen || seen.day !== choice.day || seen.block !== choice.block) return false;
  if (far && far.day === choice.day && far.block === choice.block) return false;
  return now - seen.at >= 0 && now - seen.at <= maxAge;
}

/** the answer, or nothing after `ms` (the booking does not wait for a slow server) */
export async function inTime<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  try { return await Promise.race([p.catch(() => fallback), late]); } finally { clearTimeout(timer); }
}
