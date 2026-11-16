/* The team map's answer, made the best it can be on this phone. Pure (what the phone knows is passed in), tested in
   teamMapData.test.ts:
   - a job the server has no position for takes the one the phone knows (found by the locator a moment ago, its
     customer's), since the server's answer may be a few seconds behind the phone;
   - with no signal, the last answer of the server stays, but what the phone did after it wins: a job finished, a
     position sent from this phone later than the answer;
   - another day than today has no people and no trips, only the trucks that have stops. */
import type { TeamMapAnswer, Assembled } from './assemble';

export type Pos = { lat: number; lng: number };

/** jobs without a position on the server: the one the phone knows (`placed` first: found just now, not yet synced) */
export function withPositions(d: TeamMapAnswer, known: (jobId: string) => Pos | null, placed: Record<string, Pos> = {}): TeamMapAnswer {
  let changed = false;
  const jobs = d.jobs.map((j) => {
    if (j.lat != null && j.lng != null) return j;
    const p = placed[j.id] || known(j.id);
    if (!p) return j;
    changed = true;
    return { ...j, lat: p.lat, lng: p.lng };
  });
  return changed ? { ...d, jobs } : d;
}

/** what the phone did after the server's answer (`at`, ms): a job row changed later gives its status; a position written
    later moves the person */
export interface DeviceNews {
  job: (id: string) => { status: string; updatedAt: number } | null;
  positions: { id: string; lat: number; lng: number; at: string; job_id: string | null }[];
}
export function freshen(d: TeamMapAnswer, at: number, news: DeviceNews): TeamMapAnswer {
  let changed = false;
  const jobs = d.jobs.map((j) => {
    const row = news.job(j.id);
    if (!row || row.updatedAt <= at || row.status === j.status) return j;
    changed = true;
    return { ...j, status: row.status };
  });
  const people = d.people.map((p) => {
    const mine = news.positions.find((x) => x.id === p.id);
    if (!mine || Date.parse(mine.at) <= Math.max(at, Date.parse(p.at || '') || 0)) return p;
    changed = true;
    return { ...p, lat: mine.lat, lng: mine.lng, at: mine.at, job_id: mine.job_id };
  });
  return changed ? { ...d, jobs, people } : d;
}

/** the map of another day than today: nobody on the road, no trip; a truck shows only when it has stops */
export function forDay(a: Assembled, live: boolean): Assembled {
  if (live) return a;
  return {
    ...a, people: [], trips: [],
    trucks: a.trucks.filter((tr) => tr.total > 0).map((tr) => ({ ...tr, trip: null, legs: tr.legs.map((l) => (l.kind === 'trip' ? { ...l, kind: 'todo' as const } : l)) }))
  };
}
