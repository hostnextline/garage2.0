/* « Vraies routes » (Part 27) in Réglages → Réservations, the rules without the screen (roadsModel.test.ts):
   - measureLoop: « Mesurer maintenant » and the first half of the switch ON: the function « drive » (sweep) asked again and
     again while it says `more`, until what was wanted is measured (everything, or only the usual hours), it fails, it stops
     moving (two rounds in a row with no progress), the person stops it, the person left the screen, or a ceiling of rounds
     is reached. Never throws.
   - failWords / serviceNote: every failure and every half-success in plain words (no key, TomTom refuses, no network, the
     function not installed, both route services down…).
   - switchOutcome / lateRows: what the switch did (blocks planned again, blocks kept as they were, the customers to call). */
import { t, type Lang } from '../../../lib/i18n';
import { clock, clockRange } from '../../../lib/dates';
import { blockOfKey } from '../../../data/select';
import { dayInSentence } from '../../../domain/jobs/when';
import type { DriveAnswer, DriveDone, DriveRefused, DriveSpend, RoadsStatusDone, RoadsSwitchAnswer, TomtomState, OsrmState } from '../../../data/roads';
import type { Customer, Job } from '../../../data/types';
import type { KeptBlock } from './backToBlocks';

/* ---------- the measure loop ---------- */
/** what is wanted: every trip of the coming days ('all', « Mesurer maintenant »), or only the usual-hours ones ('usual',
    what the switch waits for: the rush hours are measured later, little by little) */
export type MeasureGoal = 'all' | 'usual';
/** done: what was wanted is measured; usualOnly: every usual-hours trip is measured and the rush-hour ones never can be now
    (only TomTom measures them: no key on the server, TomTom refuses it, or the month's ceiling is 0 = never TomTom);
    rest: the function has nothing more it can do now but trips are left that come later (TomTom busy, the month's ceiling
    reached…); stuck: usual-hours trips that could not be measured (rounds that measure nothing, or both route services
    down); failed: refused or not reached; stopped: the person stopped it; away: the person left the screen (nobody sees it
    any more: the background sweep goes on later); limit: the ceiling of rounds */
export type LoopEnd = 'done' | 'usualOnly' | 'rest' | 'stuck' | 'failed' | 'stopped' | 'away' | 'limit';
export interface LoopResult {
  end: LoopEnd;
  /** what was wanted (the words count the usual-hours trips for 'usual': review R8); missing = 'all' */
  goal?: MeasureGoal;
  /** the last answer that went through (null: none did) */
  last: DriveDone | null;
  /** why it failed (end 'failed') */
  failure: DriveRefused | null;
  /** trips measured over the whole loop */
  stored: number;
  rounds: number;
  /** switch on: what the server planned again with the new times, over every round (blocks planned again, blocks kept as
      they were, the booked appointments now later than the moment told: each one once) */
  planned: number; kept: KeptBlock[]; late: string[];
}
/** what the screen shows while it measures; todo: what is left that this run can measure (the usual-hours trips for the
    switch, or when the rush hours cannot be measured now: review R3) */
export interface LoopProgress { round: number; stored: number; left: number; left0: number; todo: number }
export interface LoopOptions {
  goal: MeasureGoal;
  /** the most calls (each one is ~40 s at most on the server) */
  maxRounds?: number;
  /** two calls in a row that measure nothing and leave as much: stuck */
  idleRounds?: number;
  onRound?: (p: LoopProgress, a: DriveDone) => void;
  /** « Arrêter » was touched */
  stopped?: () => boolean;
  /** the screen is not shown any more (asked before each round: a round under way ends, no new one starts) */
  away?: () => boolean;
}
export const MAX_ROUNDS = 40;
const reached = (a: DriveDone, goal: MeasureGoal) => (goal === 'usual' ? a.left0 === 0 : a.left === 0);
/** why the rush-hour trips (listed by drive_wanted, measured by TomTom only) cannot be measured now: 'key' (no key on the
    server, or TomTom refuses it), 'cap' (the month's ceiling is 0: never TomTom); null: they can (now or later) */
export function rushBlocked(a: { tomtom?: TomtomState | null; spent?: DriveSpend | null }): 'key' | 'cap' | null {
  if (a.tomtom === 'no_key' || a.tomtom === 'refused') return 'key';
  if (a.tomtom === 'over_budget' && a.spent != null && a.spent.cap === 0) return 'cap';
  return null;
}
/** the same, read from the status: no key on the server, or a ceiling of 0 (TomTom refusing the key shows only in a measure) */
export function rushBlockedNow(s: Pick<RoadsStatusDone, 'key' | 'month'>): 'key' | 'cap' | null {
  if (!s.key) return 'key';
  if (s.month != null && s.month.cap === 0) return 'cap';
  return null;
}
/** what is left that this run can measure */
const todoOf = (a: DriveDone, goal: MeasureGoal) => (goal === 'usual' || rushBlocked(a) ? a.left0 : a.left);
/** the reason of a call that threw (no signal, the app's own limit, « Voir l'app comme… ») as a refusal */
export function refusalOf(e: unknown): DriveRefused {
  const x = (e && typeof e === 'object' ? e : {}) as { code?: unknown; hint?: unknown; message?: unknown; kind?: unknown; sub?: unknown };
  if (x.code === 'timeout' || x.sub === 'timeout') return { ok: false, code: 'timeout', at: 'drive' };
  if (x.hint === 'preview' || x.code === 'preview') return { ok: false, code: 'preview', at: 'drive' };
  return { ok: false, code: 'network', at: 'drive' };
}

export async function measureLoop(measure: () => Promise<DriveAnswer>, o: LoopOptions): Promise<LoopResult> {
  const max = Math.max(1, o.maxRounds ?? MAX_ROUNDS), idleMax = Math.max(1, o.idleRounds ?? 2);
  let last: DriveDone | null = null, stored = 0, idle = 0, rounds = 0, planned = 0;
  const kept: KeptBlock[] = [], late: string[] = [];
  const end = (e: LoopEnd, failure: DriveRefused | null = null): LoopResult => ({ end: e, goal: o.goal, last, failure, stored, rounds, planned, kept, late });
  while (rounds < max) {
    if (o.stopped?.()) return end('stopped');
    if (o.away?.()) return end('away');
    let a: DriveAnswer;
    try { a = await measure(); } catch (e) { a = refusalOf(e); }
    rounds++;
    if (!a.ok) return end('failed', a);
    const before = last;
    last = a;
    stored += a.stored;
    planned += a.planned;
    for (const k of a.kept) if (!kept.some((x) => x.day === k.day && x.block === k.block)) kept.push(k as KeptBlock);
    for (const id of a.late) if (!late.includes(id)) late.push(id);
    o.onRound?.({ round: rounds, stored, left: a.left, left0: a.left0, todo: todoOf(a, o.goal) }, a);
    if (reached(a, o.goal)) return end('done');
    if (!a.more) {
      // the rush hours can never come now: say it, never « later » (review R3)
      if (a.left0 === 0 && rushBlocked(a)) return end('usualOnly');
      // usual-hours trips left that nothing measured (both services down, or the switch waiting for them): never « done » (R4)
      if (a.left0 > 0 && (o.goal === 'usual' || stored === 0)) return end('stuck');
      return end('rest');
    }
    const moved = a.stored > 0 || !before || a.left < before.left || a.left0 < before.left0;
    idle = moved ? 0 : idle + 1;
    if (idle >= idleMax) return end('stuck');
  }
  return end('limit');
}

/* ---------- words ---------- */
/** the function « drive » is not on the server: Supabase answers 404 « NOT_FOUND », the local test copy « no function drive » */
export function fnMissing(r: Pick<DriveRefused, 'code' | 'error'>): boolean {
  return r.code === 'NOT_FOUND' || /no function|function was not found|not found/i.test(String(r.error || ''));
}
const W = (k: string, vars?: Record<string, string | number>, l?: Lang) => t(`settings.booking.roads.fail.${k}`, vars, l);
/** a refusal of « drive » (or a call that never got an answer) in plain words; `other`: the words of anything else */
export function failWords(r: DriveRefused, other: (r: DriveRefused) => string, l?: Lang): string {
  if (fnMissing(r)) return W('missing', undefined, l);
  switch (r.code) {
    case 'network': return W('network', undefined, l);
    case 'timeout': return W('timeout', undefined, l);
    case 'busy': return W('limit', undefined, l);
    case 'demo': return W('demo', undefined, l);
    default: return other(r);
  }
}
/** what an answer that went through says of the two route services (null: nothing to say, TomTom measured); `cap`: the
    month's ceiling (0 = never TomTom: the rush hours do not « wait for next month », review R3) */
export function serviceNote(tomtom: TomtomState | null | undefined, osrm: OsrmState | null | undefined, l?: Lang, cap?: number | null): string | null {
  const tt = tomtom ?? 'unused', os = osrm ?? 'unused';
  if (tt !== 'ok' && tt !== 'unused' && os === 'down') return W('down', undefined, l);
  switch (tt) {
    case 'no_key': return W('noKey', undefined, l);
    case 'refused': return W('refused', undefined, l);
    case 'busy': return W('busy', undefined, l);
    case 'over_budget': return W(cap === 0 ? 'never' : 'overBudget', undefined, l);
    default: return os === 'down' && tt === 'unused' ? W('down', undefined, l) : null;
  }
}
/** the usual hours are measured, the rush hours cannot be now: why, and what to do */
function usualOnlyWords(why: 'key' | 'cap', l?: Lang): string {
  return `${t('settings.booking.roads.measuredUsualOnly', undefined, l)} ${t(why === 'cap' ? 'settings.booking.roads.rushNeedsCap' : 'settings.booking.roads.rushNeedsKey', undefined, l)}`;
}
/** how the loop ended, in words (null: nothing to say beyond the progress). The counts are those of what was wanted: the
    usual-hours trips for the switch (review R8) */
export function loopWords(r: LoopResult, l?: Lang): string | null {
  const left = r.last?.left ?? 0, left0 = r.last?.left0 ?? 0;
  const n = r.goal === 'usual' ? left0 : left;
  const why = r.last ? rushBlocked(r.last) : null;
  switch (r.end) {
    case 'done':
      if (!r.last || r.last.left === 0) return t('settings.booking.roads.measuredAll', undefined, l);
      return why ? usualOnlyWords(why, l) : t('settings.booking.roads.measuredUsual', undefined, l);
    case 'usualOnly': return usualOnlyWords(why ?? 'key', l);
    // nothing stored by this run: never « Mesure faite » (review R4)
    case 'rest': return t(r.stored > 0 ? 'settings.booking.roads.measuredSome' : 'settings.booking.roads.restLater', { n: left }, l);
    case 'stuck': return t('settings.booking.roads.stuck', { n: left0 || left }, l);
    case 'stopped': return t('settings.booking.roads.stopped', { n }, l);
    case 'away': return t('settings.booking.roads.away', { n }, l);
    case 'limit': return t('settings.booking.roads.limit', { n }, l);
    default: return null;
  }
}

/* ---------- what the switch did ---------- */
export interface LateRow { id: string; name: string; phone: string | null; first: string | null; lang: Lang; day: string | null; told: string; eta: number | null; when: string }
/** on: the switch after it (the kept blocks' arrival times follow the real roads, or the estimate) */
export interface RoadsOutcome { on: boolean; planned: number; kept: KeptBlock[]; late: string[] }
/** the switch's answer as the screen keeps it (anything missing: nothing to show) */
export function switchOutcome(a: RoadsSwitchAnswer): RoadsOutcome {
  return { on: a.on, planned: a.planned, kept: a.kept as KeptBlock[], late: a.late };
}
/** « demain matin (8 h à 12 h) » or « demain, entre 10 h et 14 h »: what the customer was told */
function toldOf(j: Pick<Job, 'day' | 'block' | 'win_start' | 'win_end'>, l: Lang): string {
  if (j.win_start != null && j.win_end != null) return t('settings.booking.roads.toldWin', { day: dayInSentence(j.day, l), from: clock(j.win_start, l), to: clock(j.win_end, l) }, l);
  const b = blockOfKey(j.block);
  return t('settings.booking.win.backWhen', { day: dayInSentence(j.day, l), block: t(`common.blocks.${j.block}`, undefined, l).toLowerCase(), hours: clockRange(b.start, b.end, l) }, l);
}
/** the customers now late, as the device has them after the pull (a job it does not have: its number only) */
export function lateRows(ids: string[], jobOf: (id: string) => Job | undefined, customerOf: (id: string | null | undefined) => Customer | undefined,
  nameOf: (c: Customer | undefined) => string, l: Lang): LateRow[] {
  return ids.map((id) => {
    const j = jobOf(id);
    const c = customerOf(j?.customer_id);
    return {
      id, name: nameOf(c) || (j?.number != null ? `#${j.number}` : t('settings.booking.roads.unknownJob', undefined, l)),
      phone: c?.phone || null, first: c?.first_name ?? null, lang: c?.lang === 'en' ? 'en' : 'fr',
      day: j?.day ?? null, told: j ? toldOf(j, l) : '', eta: typeof j?.eta_min === 'number' ? j.eta_min : null,
      when: j ? dayInSentence(j.day, c?.lang === 'en' ? 'en' : 'fr') : ''
    };
  });
}
/** the text ready to send, in the customer's language */
export function lateText(r: LateRow): string {
  const vars = { name: r.first ? ` ${r.first}` : '', when: r.when, eta: r.eta != null ? clock(r.eta, r.lang) : '' };
  return t(r.eta != null ? 'settings.booking.roads.lateSms' : 'settings.booking.roads.lateSmsNoEta', vars, r.lang);
}
