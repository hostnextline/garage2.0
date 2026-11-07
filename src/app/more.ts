/* « Plus »: the pure parts — which tiles a person sees, the filters worth showing, today's counts, what is still owed.
   The screen is MoreScreen.tsx; tested in more.test.ts. */

export type Group = 'day' | 'office' | 'garage';
export type MoreFilter = 'all' | Group;
export const FILTERS: MoreFilter[] = ['all', 'day', 'office', 'garage'];

/** each part of the app has its own colour on the launcher (the icon's glass square), the same in light and dark */
export const TILE_HUE: Record<string, string> = {
  today: '#E5141F', overview: '#C77A0B', agenda: '#2F6FD0', map: '#0E9F8E',
  customers: '#7347D1', quotes: '#D98A00', invoices: '#D2335F', treasury: '#1F8A53', dashboard: '#4F5BD5',
  hours: '#5B6B7C', inventory: '#C8641E', team: '#0E8FB5', settings: '#6B7380', guide: '#B8892B'
};

export interface Tileable { key: string; group: Group }

/** « Tout » and each group that has at least one tile; nothing at all when every tile is in the same group */
export function filtersFor(items: Tileable[]): MoreFilter[] {
  const groups = FILTERS.filter((f) => f !== 'all' && items.some((i) => i.group === f));
  return groups.length > 1 ? ['all', ...groups] : [];
}
/** the tiles of a filter (a filter that no longer exists for this person shows everything) */
export function tilesFor<T extends Tileable>(items: T[], f: MoreFilter): T[] {
  if (f === 'all') return items;
  const some = items.filter((i) => i.group === f);
  return some.length ? some : items;
}

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

type Billed = { status: string; total_cents: number; paid_cents: number; deleted_at?: string | null };
const open = (v: Billed) => v.status === 'issued' && !v.deleted_at && Number(v.total_cents) - Number(v.paid_cents) > 0;
/** what customers still owe on finished invoices (drafts are not owed yet, cancelled ones never), in cents */
export function dueCents(invoices: Billed[]): number {
  return invoices.filter(open).reduce((s, v) => s + Number(v.total_cents) - Number(v.paid_cents), 0);
}
/** how many finished invoices are still to be paid */
export function unpaidCount(invoices: Billed[]): number { return invoices.filter(open).length; }

/** the getting-started ring: the part done, 0 to 1 */
export function ratio(done: number, total: number): number { return total > 0 ? Math.min(1, Math.max(0, done / total)) : 0; }
