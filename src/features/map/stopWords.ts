/* The words of a stop on the map (list, card, legend): when it is planned, whether it is outside the window told to the
   customer, and the road in km and time. Pure (the phone's copy of a job is passed in), tested in stopWords.test.ts. */
import { t, lang, type Lang } from '../../lib/i18n';
import { errorMessage, isNetworkError } from '../../lib/errors';
import { clock } from '../../lib/dates';
import { windowWords } from '../../domain/moment/words';
import type { Stop } from '../../shared/map/assemble';

/** what the phone's own copy of the job says about its window (the live team_map does not answer the windows yet) */
export interface JobWindow { win_start?: number | null; win_end?: number | null; win_flex?: boolean | null }

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** the window told to the customer of a stop booked by arrival window: the server's, else the phone's copy of the job */
export function winOf(s: Stop, row?: JobWindow | null): [number, number] | null {
  if (s.win) return s.win;
  return row && row.win_start != null && row.win_end != null ? [row.win_start, row.win_end] : null;
}
/** « Hors plage »: a coming stop whose planned arrival is outside its window, on EITHER side: before win_start (the truck
    waits at the door) as well as after win_end (late). Live did the same (acf46c3 MapScreen.tsx) and the help says « en
    dehors de la plage » (i18n jobs); this is not the server's « late » list, which holds only arrivals after win_end */
export function lateStop(s: Stop, row?: JobWindow | null): boolean {
  const w = s.block === 'day' ? winOf(s, row) : null;
  return !!w && s.status === 'booked' && s.etaMin != null && (s.etaMin < w[0] || s.etaMin > w[1]);
}
/** a job is shown by what it is: its block, or the window told to the customer. A window nobody here knows (a job of
    another truck, not on this phone) is « Dans la journée », never « plage confirmée la veille »: that would be a guess */
export function whenOf(s: Stop, row?: JobWindow | null, l: Lang = lang.value): string {
  let moment: string;
  if (s.block !== 'day') moment = t(`common.blocks.${s.block}`, undefined, l);
  else {
    const w = winOf(s, row);
    const flex = s.flex || (!!row && row.win_flex === true);
    moment = w || flex ? cap(windowWords(w, l)) : t('common.blocks.day', undefined, l);
  }
  if (s.etaMin == null && s.unsure && s.status === 'booked') return `${moment}, ${t('jobs.order.etaUnmeasured', undefined, l)}`;
  return s.etaMin != null ? t('map.stops.when', { block: moment, time: clock(s.etaMin, l) }, l) : moment;
}

export { kmText, durText, fmtKm } from '../../shared/map/distance';

/** a stop not done yet whose address has no position: said on the map */
export const lostStops = (stops: Stop[]) => stops.filter((s) => !s.hasPos && !s.done);
const COMING = new Set(['booked', 'en_route', 'on_site']);
/** the lost stops « Trouver » really looks for (the locator takes only the coming appointments this phone holds, today
    on): never « Adresse pas trouvée » for a search that was not made */
export function findable(lost: Stop[], day: string, now: string, onPhone: (id: string) => boolean): Stop[] {
  return day >= now ? lost.filter((s) => COMING.has(s.status) && onPhone(s.id)) : [];
}

/** « Trouver » failed: « pas de réseau » only when it is the network; a real failure says what it is (mh-8) */
export function findFailed(e: unknown): string {
  return isNetworkError(e) ? t('map.lost.offline') : errorMessage(e);
}
