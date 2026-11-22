/* « Vraies routes » on: what the server says of a moment offered (CONTRACT §2.4: the rows of suggest_blocks /
   suggest_windows carry `truck`, `rank`, `route`, `unmeasured`, `add_min`, `add_km`, `day_min`, `day_km`). The phone
   decides nothing by straight line then: where the new stop goes, its number, the order of the day and the vehicle come
   from here, or are not said. Blocks mode: rank and route are null (the app then says nothing of the order, lead's
   decision 2026-11-20); window mode: exact. The app reads rank and route ONLY from a window-mode row (block 'day'),
   whatever the server sends (review-moments M5: a blocks-mode rank is not what the booking then does). The numbers of a
   row are said only under the map of the row's own vehicle (L1). Pure (serverPlace.test.ts). */
import { duration } from '../../lib/dates';
import { t, type Lang } from '../../lib/i18n';
import { unmeasured } from './logic';

/** the new stop in a route answered by the server (`route`: job ids in driving order, this one = 'new') */
export const NEW_IN_ROUTE = 'new';

/** the fields of a server row these screens read (every one optional: an older server, the switch off) */
export interface ServerPlace {
  /** the row's block: 'day' in window mode (the only mode whose rank and route are exact) */
  block?: string | null;
  truck?: string | null; rank?: number | null; route?: string[] | null; stops?: number | null;
  add_min?: number | null; add_km?: number | null; day_min?: number | null; day_km?: number | null; unmeasured?: number | null;
}

/** the row says the order of the day (rank, route): window mode only (block 'day'); blocks mode says nothing of it */
export const saysOrder = (row: ServerPlace | null | undefined): boolean => !!row && row.block === 'day';

/** « Arrêt n sur N » from the server: only when the row says the place (rank, window mode) AND it is about the vehicle
    whose day is drawn (`truckId`: the vehicle chosen by hand, else the row's own); N = the route's length, else its other
    stops + 1. null: nothing to say (no row, blocks mode, another vehicle's row, a rank out of the route). */
export function serverRank(row: ServerPlace | null | undefined, truckId: string | null | undefined): { n: number; total: number } | null {
  if (!row || !saysOrder(row) || row.rank == null || !Number.isFinite(row.rank) || !row.truck) return null;
  if (truckId && row.truck !== truckId) return null;
  const route = Array.isArray(row.route) ? row.route : null;
  const total = route ? route.length : typeof row.stops === 'number' && Number.isFinite(row.stops) ? row.stops + 1 : null;
  const n = Math.round(row.rank);
  if (total == null || n < 1 || n > total) return null;
  if (route && route.indexOf(NEW_IN_ROUTE) >= 0 && route.indexOf(NEW_IN_ROUTE) + 1 !== n) return null;
  return { n, total };
}

/** the row when it speaks of the vehicle drawn (`truckId`; null: no vehicle drawn, any row speaks of its own), else
    null: another vehicle's numbers are never said under this one's map (review-moments L1) */
export function rowOfTruck<R extends ServerPlace>(row: R | null | undefined, truckId: string | null | undefined): R | null {
  if (!row) return null;
  if (truckId && row.truck !== truckId) return null;
  return row;
}

/** the km in the person's language (« 4,2 »), one decimal at most */
const km = (n: number, l: Lang): string => new Intl.NumberFormat(l === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 1 }).format(n);

/** what the new appointment adds to the vehicle's day, from the server's row (real roads): « Ce rendez-vous ajoute
    13 min de route (4,2 km). »; a trip not measured: « Route ajoutée : pas encore mesurée »; no row or no number:
    « Route ajoutée : pas encore calculée ». Never a straight-line estimate. */
export function addsFromRow(row: ServerPlace | null | undefined, l: Lang): string {
  if (row && unmeasured(row)) return t('booking.preview.addsUnmeasured', undefined, l);
  if (!row || row.add_min == null || !Number.isFinite(row.add_min)) return t('booking.preview.addsUnknown', undefined, l);
  const d = duration(Math.max(0, Math.round(row.add_min)), l);
  return row.add_km != null && Number.isFinite(row.add_km)
    ? t('booking.preview.addsServer', { d, km: km(Math.max(0, row.add_km), l) }, l)
    : t('booking.preview.addsServerMin', { d }, l);
}

/** the vehicle's whole day WITH the new appointment, from the server's row: « Route de la journée avec ce rendez-vous :
    38 km, 1 h 10 »; a trip not measured: « … pas encore mesurée »; '' when the row does not say it */
export function dayFromRow(row: ServerPlace | null | undefined, l: Lang): string {
  if (!row) return '';
  if (unmeasured(row)) return t('booking.preview.dayUnmeasured', undefined, l);
  if (row.day_min == null || !Number.isFinite(row.day_min)) return '';
  const d = duration(Math.max(0, Math.round(row.day_min)), l);
  return row.day_km != null && Number.isFinite(row.day_km)
    ? t('booking.preview.dayServer', { d, km: km(Math.max(0, row.day_km), l) }, l)
    : t('booking.preview.dayServerMin', { d }, l);
}

/** « +13 min de route (4,2 km) » under a block of « Choisir sur la carte », from its row; « route pas encore mesurée »
    while a trip is not measured; '' without a number */
export function blockAdds(row: ServerPlace | null | undefined, l: Lang): string {
  if (!row) return '';
  if (unmeasured(row)) return t('booking.picker.unmeasured', undefined, l);
  if (row.add_min == null || !Number.isFinite(row.add_min)) return '';
  const d = duration(Math.max(0, Math.round(row.add_min)), l);
  return row.add_km != null && Number.isFinite(row.add_km) ? t('booking.mm.addsKm', { d, km: km(Math.max(0, row.add_km), l) }, l) : t('booking.mm.adds', { d }, l);
}
