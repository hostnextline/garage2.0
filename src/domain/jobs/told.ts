/* « Envoyer les heures aux clients » (Part 28): THE rule of what a customer must be told now, and who is due on a day.
   The phone's twin of the server's day_rewin_on / told_hours / tell_now / tell_state (supabase/migrations/
   20261122000100_reorganiser.sql; REARRANGE.md §1.3, §3.1-§3.2): the server decides what is sent, the phone counts and
   shows the same thing offline from its own copy of `jobs` (the told_* columns come with every row). Both twins are
   tested on ONE table of cases, tests/fixtures/told-cases.json (told.test.ts here, tests/db/textos-journee.test.mjs T1
   on the database): change one rule, change the other and the table.

   « Told » = jobs.told_day / told_start / told_end / told_at: the day and the hours (minutes of the day) the customer's
   last text said, or what a person confirmed telling him (start / end null with told_at set: « dans la journée »).
   Hours, never block keys; the minute (eta_min, arrive_at) is never part of it.

   Pure functions of a job and a context; only tellCtx() reads the device's copy (the settings and the clock). */
import type { Job } from '../../data/types';
import type { TellRow } from '../../data/tell';
import { settings } from '../../data/select';
import { tsMicros } from '../../data/clock';
import { DEFAULT_BLOCKS, today as garageToday, nowMinute, clockRange, type Block, type Range } from '../../lib/dates';
import { t, lang, type Lang } from '../../lib/i18n';
import { dayInSentence } from './when';

/** 'new': never told, or told « dans la journée » and now a window that day; 'changed': his day or hours changed since
    his last text; 'drift': TODAY, his sure arrival only slipped out of the window he was told (= the planned one): listed
    apart, never texted by the button (the « en route » text gives the time); 'ok': nothing new to tell him. */
export type TellState = 'new' | 'changed' | 'drift' | 'ok';
/** the text a due customer gets: the full confirmation, the window's text, or « a changé » */
export type TellKind = 'booking' | 'window' | 'moved';
/** what he must be told now (tell_now): the day and hours (null, null = « dans la journée »); `rewin` = the window of his
    sure arrival, written when he is told; `drift` = today, only his arrival slipped */
export interface TellNow { day: string; start: number | null; end: number | null; rewin: boolean; drift: boolean }
/** what the rule reads besides the job (tellCtx() for the device, tellCtxOf() for a test or a given settings) */
export interface TellCtx {
  /** the garage's today (Montréal) and minute of the day now (local_today(), now_min()) */
  today: string; nowMin: number;
  /** « Plages d'arrivée » and « Vraies routes » switches */
  windowsOn: boolean; roadsOn: boolean;
  /** « les plages ne bougent jamais » is NOT set: settings.booking.rewin is not a « no » (absent = true; day_rewin_on()) */
  rewin: boolean;
  /** the blocks written in the settings (blocks_set(): the defaults when none is written) */
  blocks: readonly Block[];
  /** the window of an arrival with the garage's settings (win_for) */
  windowOf: (eta: number) => Range;
}
/** what the rule reads of a job (a Job, or a row of the cases' table) */
export type TellJob = Pick<Job, 'day' | 'block' | 'status' | 'eta_min'>
  & Partial<Pick<Job, 'deleted_at' | 'win_start' | 'win_end' | 'eta_measured' | 'arrive_at' | 'told_day' | 'told_start' | 'told_end' | 'told_at' | 'hand_at'>>;
/** what the lists also need: who (N counts customers) and the order (number) */
export type TellListJob = TellJob & Pick<Job, 'id' | 'number' | 'customer_id'>;
/** what he was told last, null: never told anything */
export interface Told { day: string; start: number | null; end: number | null; at: string; how: Job['told_how'] }

/* ---------- the settings, read as the server reads them ---------- */

/** a yes / no setting said « no »: false, the number 0, or a text « false » / « 0 » (spaces around, any case): the twin of
    roads_no (vraies_routes.sql:104-108). Anything else (absent, null, true, « oui », « non », 1) is not a « no ». */
export function saysNo(v: unknown): boolean {
  if (typeof v === 'boolean') return v === false;
  if (typeof v === 'number') return v === 0;
  if (typeof v === 'string') return ['false', '0'].includes(v.replace(/^ +| +$/g, '').toLowerCase());
  return false;
}
/** Postgres' numeric → int: half away from zero */
const pgInt = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));
/** bset(key, default): the setting when it is a number (or a text that is one), else the default */
function bset(v: unknown, d: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
}
/** what of settings.booking the rule reads (a full Settings['booking'] fits) */
export interface TellBooking {
  windows_on?: unknown; roads_on?: unknown; rewin?: unknown; blocks?: unknown;
  win_before_min?: unknown; win_after_min?: unknown; win_round_min?: unknown;
}
/** the blocks written in the settings, else the three of the garage (blocks_set) */
function blocksSet(v: unknown): Block[] {
  if (!Array.isArray(v)) return DEFAULT_BLOCKS.map((b) => ({ ...b }));
  return v.map((b: { key?: unknown; start?: unknown; end?: unknown }) => ({ key: b.key as Block['key'], start: pgInt(Number(b.start)), end: pgInt(Number(b.end)) }));
}
/** win_for(eta) with these settings (fenetres.sql:62-71): start = round(eta / r) × r − before, kept inside the day's hours
    (the first block's start to the last one's end, 8 h to 20 h without blocks); length max(30, before + after); r ≥ 5.
    For every value Réglages allows (« avant » 0–180, « après » 30–360, rounding 15 / 30 / 60) it is exactly select.ts'
    windowOf (lib/dates windowFor); the two clamps only matter for a value written by a script. */
function winForOf(b: TellBooking, blocks: readonly Block[]): (eta: number) => Range {
  const before = pgInt(bset(b.win_before_min, 60));
  const len = Math.max(30, pgInt(bset(b.win_before_min, 60) + bset(b.win_after_min, 180)));
  const r = Math.max(pgInt(bset(b.win_round_min, 60)), 5);
  const d0 = blocks.length ? Math.min(...blocks.map((x) => x.start)) : 480;
  const d1 = blocks.length ? Math.max(...blocks.map((x) => x.end)) : 1200;
  return (eta: number): Range => {
    const s = Math.max(d0, Math.min(pgInt(eta / r) * r - before, Math.max(d0, d1 - len)));
    return [s, s + len];
  };
}
/** the context from given settings and clock (the tests, the cases' table) */
export function tellCtxOf(b: TellBooking, today: string, nowMin: number): TellCtx {
  const blocks = blocksSet(b.blocks);
  return { today, nowMin, windowsOn: b.windows_on === true, roadsOn: b.roads_on === true, rewin: !saysNo(b.rewin), blocks, windowOf: winForOf(b, blocks) };
}
/** the context of this device now: its copy of the settings, the garage's today and minute (a screen that calls it redraws
    when the settings change) */
export function tellCtx(now: Date = new Date()): TellCtx {
  return tellCtxOf(settings.value.booking, garageToday(now), nowMinute(now));
}

/* ---------- the one rule ---------- */

/** the hours a job HAS (told_hours): a window job ('day') its window (null, null = flexible), a block job its block's hours
    now (null, null for a block the settings no longer have) */
function hoursOf(j: TellJob, ctx: TellCtx): [number | null, number | null] {
  if (j.block === 'day') return [j.win_start ?? null, j.win_end ?? null];
  const b = ctx.blocks.find((x) => x.key === j.block);
  return b ? [b.start, b.end] : [null, null];
}
/** a < b as instants, to the microsecond (two stamps of one millisecond: data/clock.ts); false when one cannot be read */
function earlier(a: string, b: string): boolean {
  const x = tsMicros(a), y = tsMicros(b);
  return !Number.isNaN(x) && !Number.isNaN(y) && x < y;
}
/** what the customer must be told now (tell_now). Window mode, booked, a SURE arrival (switch « Vraies routes » off:
    always; on: eta_measured true — NOT plannedTime, which takes a missing flag as sure): inside the window he was told
    that day → those hours (days F1), when the planned window does not hold that arrival (a window an earlier save cut
    and nobody sent) or the arrival is a minute pointed (the exact move inside what he was told); a planned window that
    holds the arrival and was not cut from a minute pointed is the one chosen by hand (« Déplacer » to the next window:
    review R0) and is what he must hear. Else, rewin on and outside the PLANNED window → the window of that arrival; else
    the hours the job has. */
export function tellNow(j: TellJob, ctx: TellCtx): TellNow {
  // the plan's arrival (NaN when none: then nothing is sure and no comparison holds)
  const eta = j.eta_min ?? NaN;
  const sure = ctx.windowsOn && j.block === 'day' && j.status === 'booked' && j.eta_min != null && (!ctx.roadsOn || j.eta_measured === true);
  const ws = j.win_start ?? null, we = j.win_end ?? null;
  const inPlanned = ws != null && we != null && eta >= ws && eta <= we;
  const toldIn = sure && j.told_day === j.day && j.told_start != null && j.told_end != null && eta >= j.told_start && eta <= j.told_end
    && (j.arrive_at != null || !inPlanned);
  const go = !toldIn && sure && ctx.rewin && ws != null && (eta < ws || (we != null && eta > we));
  const h = hoursOf(j, ctx);
  const w = go ? ctx.windowOf(eta) : null;
  const start = toldIn ? j.told_start! : w ? w[0] : h[0];
  const end = toldIn ? j.told_end! : w ? w[1] : h[1];
  // today, due ONLY because the arrival slipped: told = planned, and no save by hand pushed him out since he was told
  const drift = go && j.day === ctx.today
    && (j.told_day ?? null) === j.day && (j.told_start ?? null) === ws && (j.told_end ?? null) === we
    && (j.hand_at == null || (j.told_at != null && earlier(j.hand_at, j.told_at)));
  return { day: j.day, start, end, rewin: go, drift };
}
/** the state with tell_now already worked out */
function stateWith(j: TellJob, n: TellNow, ctx: TellCtx): TellState | null {
  if (j.deleted_at != null || j.status !== 'booked' || j.day < ctx.today) return null;
  if (j.day === ctx.today && (n.end ?? 1440) <= ctx.nowMin) return null;
  if (j.told_at == null) return 'new';
  if (n.drift) return 'drift';
  if (j.told_start == null && n.start != null && j.told_day === n.day) return 'new';
  const same = (j.told_day ?? null) === n.day && (j.told_start ?? null) === n.start && (j.told_end ?? null) === n.end;
  return same ? 'ok' : 'changed';
}
/** 'new' | 'changed' | 'drift' | 'ok', or null: not a coming booked appointment, or today's hours already over (tell_state) */
export function tellState(j: TellJob, ctx: TellCtx): TellState | null {
  return stateWith(j, tellNow(j, ctx), ctx);
}
/** due = the day's button texts him: 'new' or 'changed' ('drift' never) */
export const isDue = (s: TellState | null | undefined): boolean => s === 'new' || s === 'changed';
/** the kind with tell_now and the state already worked out */
function kindWith(j: TellJob, n: TellNow, s: TellState | null): TellKind | null {
  if (!isDue(s)) return null;
  if (j.told_at == null) return 'booking';
  if (j.told_start == null && n.start != null && j.told_day === n.day) return 'window';
  return 'moved';
}
/** the text a due customer gets (null: not due): never told → the full confirmation; told « dans la journée » and now a
    window on that day → the window's text; any other change → « a changé » */
export function tellKind(j: TellJob, ctx: TellCtx): TellKind | null {
  const n = tellNow(j, ctx);
  return kindWith(j, n, stateWith(j, n, ctx));
}

/* ---------- what he was told ---------- */

/** what he was told last (null: never told anything) */
export function toldOf(j: TellJob & Partial<Pick<Job, 'told_how'>>): Told | null {
  if (j.told_at == null || j.told_day == null) return null;
  return { day: j.told_day, start: j.told_start ?? null, end: j.told_end ?? null, at: j.told_at, how: j.told_how ?? null };
}
/** the window the customer HAS, for the team's « Dit au client » (R5a): what he was told when he was told (null: told
    « dans la journée »), else the planned window (null: none) */
export function toldWindow(j: Pick<TellJob, 'told_at' | 'told_start' | 'told_end' | 'win_start' | 'win_end'>): Range | null {
  if (j.told_at != null) return j.told_start != null && j.told_end != null ? [j.told_start, j.told_end] : null;
  return j.win_start != null && j.win_end != null ? [j.win_start, j.win_end] : null;
}

/* ---------- who is due on a day ---------- */

/** a due appointment with what it is due for */
interface Judged<J> { j: J; n: TellNow; s: TellState | null }
function judged<J extends TellListJob>(jobs: readonly J[], ctx: TellCtx): Judged<J>[] {
  return jobs.map((j) => { const n = tellNow(j, ctx); return { j, n, s: stateWith(j, n, ctx) }; });
}
/** tell_list's order: the new day, the new start (« dans la journée » first), the number */
function byNow<J extends TellListJob>(a: Judged<J>, b: Judged<J>): number {
  return a.n.day.localeCompare(b.n.day)
    || (a.n.start == null ? (b.n.start == null ? 0 : -1) : b.n.start == null ? 1 : a.n.start - b.n.start)
    || a.j.number - b.j.number;
}
const onDay = (j: TellJob, day: string) => j.day === day || j.told_day === day;
/** the customer a due appointment counts for (an appointment with no customer counts as one) */
const clientOf = (j: TellListJob): string => j.customer_id ?? `job:${j.id}`;
/** the appointments due on a day: the day they HAVE or the day they were TOLD (moved from Thursday to Monday: on both),
    in tell_list's order */
export function dueOn<J extends TellListJob>(day: string, jobs: readonly J[], ctx: TellCtx): J[] {
  return judged(jobs, ctx).filter((x) => isDue(x.s) && onDay(x.j, day)).sort(byNow).map((x) => x.j);
}
/** today's appointments whose sure arrival only slipped ('drift'): listed apart, never texted by the button */
export function driftOn<J extends TellListJob>(day: string, jobs: readonly J[], ctx: TellCtx): J[] {
  return judged(jobs, ctx).filter((x) => x.s === 'drift' && onDay(x.j, day)).sort(byNow).map((x) => x.j);
}
/** N of « N clients n'ont pas leur nouvelle heure » for a day: distinct customers of dueOn ('drift' never counts) */
export function clientsDue(day: string, jobs: readonly TellListJob[], ctx: TellCtx): number {
  return new Set(dueOn(day, jobs, ctx).map(clientOf)).size;
}
/** every day from today with customers due, in date order, and the distinct customers over all of them (a customer due on
    two days, or with two cars, counts once in the total and is on each of his days) */
export function dueDays(jobs: readonly TellListJob[], ctx: TellCtx): { days: { day: string; n: number }[]; total: number } {
  const per = new Map<string, Set<string>>();
  const all = new Set<string>();
  for (const x of judged(jobs, ctx)) {
    if (!isDue(x.s)) continue;
    const who = clientOf(x.j);
    all.add(who);
    for (const d of new Set([x.j.day, x.j.told_day])) {
      if (d == null || d < ctx.today) continue;
      const s = per.get(d);
      if (s) s.add(who); else per.set(d, new Set([who]));
    }
  }
  const days = [...per.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, s]) => ({ day, n: s.size }));
  return { days, total: all.size };
}

/* ---------- in words, and the list of a day as the phone sees it ---------- */

/** the hours in words: « 9 h à 13 h »; null, null: « dans la journée (plage confirmée la veille) » */
export function hoursWords(start: number | null, end: number | null, l: Lang = lang.value): string {
  return start != null && end != null ? clockRange(start, end, l) : t('common.window.flex', undefined, l);
}
/** a day and its hours: « lundi 24 novembre, 9 h à 13 h », « aujourd’hui, dans la journée (…) » */
export function whenWords(day: string, start: number | null, end: number | null, l: Lang = lang.value): string {
  return `${dayInSentence(day, l)}, ${hoursWords(start, end, l)}`;
}
/** what he was told last, in words (« lundi 24 novembre, 9 h à 13 h »); '' when never told anything */
export function toldWords(j: TellJob, l: Lang = lang.value): string {
  const o = toldOf(j);
  return o ? whenWords(o.day, o.start, o.end, l) : '';
}
/** a number a text can reach, as the server reads it (e164 of _shared/ghl.ts): 10 digits, or 11 starting with 1 */
export function phoneOk(phone: string | null | undefined): boolean {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length === 10 || (d.length === 11 && d.startsWith('1'));
}

/** what the list needs to know of a customer and of Réglages → Textos */
export interface TellWho { phone: string | null; sms_ok: boolean | null | undefined }
/** the day's send list from the phone's own copy, in the shape and order of tell_list's rows (§1.5): the due ones and
    today's 'drift' ones. What the sheet shows at once, before the server's list comes. */
export function tellRows(day: string, jobs: readonly TellListJob[], ctx: TellCtx, who: (customerId: string | null) => TellWho | null | undefined,
  kindOn: (kind: TellKind) => boolean): TellRow[] {
  return judged(jobs, ctx)
    .filter((x) => (isDue(x.s) || x.s === 'drift') && onDay(x.j, day))
    .sort(byNow)
    .map(({ j, n, s }) => {
      const kind = kindWith(j, n, s);
      const c = who(j.customer_id ?? null);
      return {
        id: j.id, number: j.number, customer_id: j.customer_id ?? null,
        state: s as TellRow['state'], kind,
        told: toldOf(j),
        now: { day: n.day, start: n.start, end: n.end, rewin: n.rewin },
        phone_ok: phoneOk(c?.phone), sms_ok: c?.sms_ok !== false, kind_on: kind ? kindOn(kind) : true
      };
    });
}
