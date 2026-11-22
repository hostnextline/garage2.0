/* When a job is, in words: the day (« Aujourd’hui », « jeudi 6 novembre »), its block or the arrival window told to the
   customer (« Plages d'arrivée », block 'day'), the planned arrival, the clock of a moment. Tested in when.test.ts.
   A job is shown by what it is (a block or a window), whatever the garage's mode today. */
import type { Job } from '../../data/types';
import { blockOfKey } from '../../data/select';
import { windowWords } from '../moment/words';
import { today, addDays, longDay, shortDate, clock, clockRange, minuteOf as garageMinute } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';

/** « Aujourd’hui », « Demain », « Hier », else « jeudi 6 novembre » */
export function dayWord(day: string, l = lang.value): string {
  const d = today();
  if (day === d) return t('jobs.day.today', undefined, l);
  if (day === addDays(d, 1)) return t('jobs.day.tomorrow', undefined, l);
  if (day === addDays(d, -1)) return t('jobs.day.yesterday', undefined, l);
  return capFirst(longDay(day, l));
}
/** the day inside a sentence: « Prévue demain », « Prévue jeudi 6 novembre » / “Planned tomorrow”, “Planned Thursday, November 6” */
export function dayInSentence(day: string, l = lang.value): string {
  const w = dayWord(day, l);
  const d = today();
  const near = day === d || day === addDays(d, 1) || day === addDays(d, -1);
  return l === 'fr' || near ? w.charAt(0).toLowerCase() + w.slice(1) : w;
}
/** a short day for lists: « Aujourd’hui », « Demain », else « 6 nov. 2026 » */
export function shortDayWord(day: string, l = lang.value): string {
  const d = today();
  if (day === d || day === addDays(d, 1) || day === addDays(d, -1)) return dayWord(day, l);
  return shortDate(day, l);
}
export const capFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** what the job needs to say its moment: a block, or (« Plages d'arrivée », block 'day') the window told to the customer */
export type Moment = Pick<Job, 'block'> & Partial<Pick<Job, 'win_start' | 'win_end' | 'win_flex'>>;
/** booked by arrival window */
export const isWindowJob = (j: Pick<Job, 'block'>): boolean => j.block === 'day';
/** the window promised to the customer; null: none yet (« flexible », or a 'day' job the server has not given one) */
export function promisedWindow(j: Moment): [number, number] | null {
  return isWindowJob(j) && j.win_start != null && j.win_end != null ? [j.win_start, j.win_end] : null;
}
/** the hours told to the customer: « 12 h à 16 h » for a block, « entre 14 h et 18 h » for a window,
    « dans la journée (plage confirmée la veille) » while a window job has none */
export function blockRange(j: Moment, l = lang.value): string {
  if (isWindowJob(j)) return windowWords(promisedWindow(j), l);
  const b = blockOfKey(j.block);
  return clockRange(b.start, b.end, l);
}
/** the moment in a word or two, for a sentence: « matin », « après-midi », « soir »; a window job: « entre 14 h et 18 h » */
export function momentWord(j: Moment, l = lang.value): string {
  return isWindowJob(j) ? windowWords(promisedWindow(j), l) : t(`common.blocks.${j.block}`, undefined, l).toLowerCase();
}
/** the moment, very short, for a ticket's stub: « Matin »; a window: « 14 h–18 h » / “2–6 p.m.”; none yet: « Flexible » */
export function momentShort(j: Moment, l = lang.value): string {
  if (!isWindowJob(j)) return t(`common.blocks.${j.block}`, undefined, l);
  const w = promisedWindow(j);
  if (!w) return t('jobs.win.flexShort', undefined, l);
  const a = clock(w[0], l), b = clock(w[1], l);
  // English: the half of the day said once when both ends share it (“2–6 p.m.”)
  const m = l === 'en' ? /^(.*) ([ap]\.m\.)$/.exec(a) : null;
  return m && b.endsWith(m[2]) ? `${m[1]}–${b}` : `${a}–${b}`;
}
/** the last argument of `moveJob` that keeps what the customer was told when only the vehicle changes: the same window,
    or still « flexible » (null for a block job: the old call). On the same day the 5-argument call (null) keeps the window
    exactly as it is (its end and « flexible » too): « Changer de camion » sends null. */
export function keepWindow(j: Moment): { start: number | null; flex: boolean } | null {
  if (!isWindowJob(j)) return null;
  const w = promisedWindow(j);
  return { start: w ? w[0] : null, flex: !w && !!j.win_flex };
}
/** a text of the job section that says « bloc »: its twin under jobs.win for a job booked by window (the base text when a
    twin is missing, never the raw key) */
export function wt(j: Pick<Job, 'block'>, key: string, vars?: Record<string, string | number>, l = lang.value): string {
  if (!isWindowJob(j)) return t(key, vars, l);
  const twin = key.replace(/^jobs\./, 'jobs.win.');
  const s = t(twin, vars, l);
  return s === twin ? t(key, vars, l) : s;
}
/** « Hors plage »: the planned arrival of a coming stop falls outside the window promised (ordered by hand, booked « quand même »).
    Stops on the way or there are not judged: the planner no longer moves them. */
export function outsideWindow(j: Moment & Pick<Job, 'status' | 'eta_min' | 'eta_measured'>): boolean {
  const w = promisedWindow(j);
  const eta = plannedTime(j);
  return !!w && j.status === 'booked' && eta != null && (eta < w[0] || eta > w[1]);
}
/** the plan's arrival that may be SAID as a time (or judged « Hors plage »): null while the server says a trip before
    that stop counts the fixed « Trajet inconnu » time (`jobs.eta_measured` false, « Vraies routes » on; final-guess G1).
    No flag (switch off, or a server without the column): the plan's time, as before. */
export function plannedTime(j: Pick<Job, 'eta_min' | 'eta_measured'>): number | null {
  return j.eta_measured === false ? null : j.eta_min ?? null;
}
/** the plan has a time for that stop but it is not sure (a trip before it not measured yet): the screens then say
    « heure : trajets pas encore mesurés » (jobs.order.etaUnmeasured) instead of a time */
export function etaUnsure(j: Pick<Job, 'eta_min' | 'eta_measured'>): boolean {
  return j.eta_measured === false && j.eta_min != null;
}
/** « Aujourd’hui, 12 h à 16 h, arrêt 2 » / « Aujourd’hui, entre 14 h et 18 h, arrêt 2 » */
export function whenLine(j: Job, l = lang.value): string {
  const parts = [dayWord(j.day, l), blockRange(j, l)];
  if (j.stop_order != null && j.status !== 'cancelled' && j.status !== 'no_show') parts.push(t('jobs.stopN', { n: j.stop_order }, l));
  return parts.join(', ');
}
/** « vers 12 h 15 » */
export function etaWord(min: number | null | undefined, l = lang.value): string {
  return min == null ? '' : t('jobs.eta', { time: clock(min, l) }, l);
}
/** minutes after midnight of a timestamp, on the garage's clock (Montréal, like the server and every other time of the
    app: a phone set to another zone still says the hour the customer lives) */
export function minuteOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = garageMinute(new Date(iso));
  return Number.isNaN(m) ? null : m;
}
export function clockOf(iso: string | null | undefined, l = lang.value): string {
  const m = minuteOf(iso);
  return m == null ? '' : clock(m, l);
}

/** the job as a ticket says its time (« vers 10 h 40 »): a stop on the way (`status` as this phone sees it, « Je pars »
    still waiting on it included) says the trip's real arrival (`tripEtaAt`, the server's TomTom / OSRM time) or no time,
    never the plan's time said as an arrival (the same rule as the map legend and TruckCard). A plan's time that is not sure
    (`eta_measured` false: a trip before it counts the fixed unknown time) is not said either (eta_min null, the flag
    kept so the screen can say why; final-guess G1). Anything else: the job as it is (the same object). Used by « Ma
    journée », « Pas terminé » and the job screen's « Ensuite » (fix-sheets L4). */
export function enRouteTicket<J extends Pick<Job, 'eta_min'> & { eta_measured?: boolean | null }>(j: J, status: string, tripEtaAt: string | null | undefined): J {
  // on the way the time said is the trip's (real), so the plan's flag no longer applies to it
  if (status === 'en_route') return { ...j, eta_min: minuteOf(tripEtaAt), ...(j.eta_measured === false ? { eta_measured: null } : {}) };
  return j.eta_measured === false && j.eta_min != null ? { ...j, eta_min: null } : j;
}
