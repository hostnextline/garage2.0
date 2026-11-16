/* What people said about a car's oil, kept on the car (`vehicles.oil_followup`, one jsonb):
   - the last call: `at` (when it was noted), `by`, then `again_on` (call back that day) or `stop` (do not call for this car);
   - `not_oil`: the visits (job ids) a person said had NO oil change, though the app read one (a top-up, a line worded
     like one). It stays whatever is noted about the calls, and is not itself a call.
   The column is saved whole, so every change starts from the car as it is on the device at that moment (another phone's
   note that already arrived is kept). Pure, tested in followup.test.ts. */
import type { OilMark, Vehicle } from '../../data/types';

/** the stored shape; `at` is absent when only `not_oil` was said (the old app then ignores the whole value) */
export interface OilFollowup { at?: string; by?: string | null; again_on?: string | null; stop?: boolean; not_oil?: string[] }
/** a call noted: call back on a day, or stop calling */
export interface OilCall { at: string; by: string | null; again_on?: string | null; stop?: boolean }

/** the most visits kept in `not_oil` (the oldest are forgotten: they no longer change anything) */
const KEEP = 50;

export function followupOf(v: Pick<Vehicle, 'oil_followup'> | null | undefined): OilFollowup | null {
  const f = v?.oil_followup as OilFollowup | null | undefined;
  return f && typeof f === 'object' ? f : null;
}
/** the visits said to have had no oil change */
export function notOilOf(v: Pick<Vehicle, 'oil_followup'> | null | undefined): string[] {
  const list = followupOf(v)?.not_oil;
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
}
/** every visit said to have had no oil change, on any car */
export function deniedJobs(vehicles: Pick<Vehicle, 'oil_followup'>[]): Set<string> {
  const out = new Set<string>();
  for (const v of vehicles) for (const id of notOilOf(v)) out.add(id);
  return out;
}
/** the call part of what is stored, when there is one (a value with only `not_oil` has none) */
export function callOf(f: OilFollowup | null): OilCall | null {
  if (!f || !f.at || !(f.stop || f.again_on)) return null;
  return { at: f.at, by: f.by ?? null, ...(f.again_on ? { again_on: f.again_on } : {}), ...(f.stop ? { stop: true } : {}) };
}

function build(call: OilCall | null, notOil: string[]): OilFollowup | null {
  const list = [...new Set(notOil)].slice(-KEEP);
  if (!call && !list.length) return null;
  return { ...(call || {}), ...(list.length ? { not_oil: list } : {}) };
}
/** a call noted (or `null`: back in the list), keeping the visits said to have had no oil change */
export function withCall(v: Pick<Vehicle, 'oil_followup'> | null | undefined, call: OilCall | null): OilFollowup | null {
  return build(call, notOilOf(v));
}
/** « Pas de changement d’huile à cette visite » */
export function withNotOil(v: Pick<Vehicle, 'oil_followup'> | null | undefined, jobId: string): OilFollowup | null {
  return build(callOf(followupOf(v)), [...notOilOf(v).filter((id) => id !== jobId), jobId]);
}
/** takes back a « no oil change » said before for that visit */
export function withoutNotOil(v: Pick<Vehicle, 'oil_followup'> | null | undefined, jobId: string): OilFollowup | null {
  return build(callOf(followupOf(v)), notOilOf(v).filter((id) => id !== jobId));
}
/** the value given to the data layer: `OilMark` there still says `at` is always present (see the request to the data
    package); the database column takes any object */
export const stored = (f: OilFollowup | null): OilMark | null => f as OilMark | null;
