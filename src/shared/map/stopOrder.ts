/* The one order of a vehicle's stops inside a day, for every list that shows them in route order (the map, the
   « La voiture ferme » list). Pure.
   1. the moment: matin, après-midi, soir; a day of arrival windows (block 'day') comes after the blocks (after the
      switch, blocks and 'day' never share a day; if they did, the windows would follow);
   2. what already happened first: done, then under way (on the way or there), then booked; the planner keeps the
      stops under way in front of the others, and a stop done out of order is drawn where it really was;
   3. the stop number the planner (or the person, « Ordre des arrêts ») gave;
   4. the planned arrival, then the job number, so two lists of the same day never differ. */

/** the fields the order needs, under the names of the server's answer and of the phone's rows */
export interface Orderable {
  block: string;
  status: string;
  order: number | null;
  etaMin: number | null;
  number: number | null;
}

const BLOCK_RANK: Record<string, number> = { am: 0, pm: 1, eve: 2, day: 3 };
const STATUS_RANK: Record<string, number> = { done: 0, en_route: 1, on_site: 1, booked: 2 };

export function compareStops(a: Orderable, b: Orderable): number {
  return ((BLOCK_RANK[a.block] ?? 9) - (BLOCK_RANK[b.block] ?? 9))
    || ((STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3))
    || ((a.order ?? 999) - (b.order ?? 999))
    || ((a.etaMin ?? 9999) - (b.etaMin ?? 9999))
    || ((a.number ?? 0) - (b.number ?? 0));
}

/** a copy of the list in stop order */
export function sortStops<T extends Orderable>(list: T[]): T[] {
  return list.slice().sort(compareStops);
}
