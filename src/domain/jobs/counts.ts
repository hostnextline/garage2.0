/* Counting the jobs of a day (« Plus », « Aperçu »). */

export interface DayCounts { booked: number; live: number; done: number }
/** today's jobs: still to start, under way (on the road or on site), finished (cancelled and no-shows are not counted) */
export function dayCounts(jobs: { status: string }[]): DayCounts {
  const c: DayCounts = { booked: 0, live: 0, done: 0 };
  for (const j of jobs) {
    if (j.status === 'booked') c.booked++;
    else if (j.status === 'en_route' || j.status === 'on_site') c.live++;
    else if (j.status === 'done') c.done++;
  }
  return c;
}
