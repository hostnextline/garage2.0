/* Days, hours and the garage's clock.
   A day is a calendar day of the garage written 'YYYY-MM-DD'; a time of day is minutes after midnight. The week goes
   from Sunday to Saturday, like the schedule Hassan asked for.

   Two families that never mix:
   - an INSTANT (a Date, an ISO time from the server) becomes a garage day or minute through Intl in Montréal's zone
     (dayOf, today, nowMinute, minuteOf, stamp), so a phone set to Paris or Vancouver still sees Montréal's day, like
     the server (local_today(), now_min());
   - a DAY string is pure calendar maths done at noon UTC (addDays, dow, daysBetween, the formatters), so no device
     zone and no daylight-saving night can move it. */

export type Day = string;       // 'YYYY-MM-DD'
export type Minute = number;    // 0..1440

export const TZ = 'America/Toronto'; // same rules as Montréal

const pad = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86400000;

/* ---------- instants → the garage's day and minute ---------- */

// en-CA writes the date as YYYY-MM-DD; h23 so midnight is 00, never 24
const garageClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
// Intl is slow next to the old getters (screens call dayOf over every payment at each redraw, today() once per service).
// So Intl is asked only for Montréal's offset from UTC, once per hour of time: the clock changes at 2 h local, which is
// always a whole UTC hour (07:00 or 06:00 UTC), so one hour of time never holds two offsets. Day and minute are then
// plain arithmetic. 50,000 hours (more than five years of distinct hours) are kept; past that the oldest one is
// forgotten, never the whole memory at once (review fluidite-02: emptying it at 5,000 made a long scan 12 times slower).
type Parts = { day: Day; minute: Minute };
const HOUR_MS = 3600000;
const HOURS_KEPT = 50000;
const offsetByHour = new Map<number, number>();
function offsetAt(ms: number): number {
  const h = Math.floor(ms / HOUR_MS);
  let off = offsetByHour.get(h);
  if (off === undefined) {
    const p: Record<string, string> = {};
    for (const x of garageClock.formatToParts(new Date(h * HOUR_MS))) p[x.type] = x.value;
    off = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute)) - h * HOUR_MS;
    if (offsetByHour.size >= HOURS_KEPT) { const oldest = offsetByHour.keys().next().value; if (oldest !== undefined) offsetByHour.delete(oldest); }
    offsetByHour.set(h, off);
  }
  return off;
}
function garageParts(d: Date): Parts | null {
  if (!(d instanceof Date)) return null;
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  const local = new Date(ms + offsetAt(ms)); // Montréal's wall clock, read with the UTC getters
  return { day: dayOfUtc(local), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** the garage's day of an instant ('' when the date is not valid) */
export function dayOf(d: Date): Day { return garageParts(d)?.day ?? ''; }
/** the garage's minute of an instant (NaN when the date is not valid) */
export function minuteOf(d: Date): Minute { return garageParts(d)?.minute ?? NaN; }
export function today(now: Date = new Date()): Day { return dayOf(now); }
export function nowMinute(now: Date = new Date()): Minute { return minuteOf(now); }

/* ---------- day strings: calendar maths ---------- */

function utcNoon(day: Day): Date {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
const dayOfUtc = (d: Date): Day => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** the day at the device's local noon: for code that reads it with getDate() / getDay() or formats it without a zone */
export function parseDay(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0); // noon: safe across DST changes
}
export function addDays(day: Day, n: number): Day {
  return dayOfUtc(new Date(utcNoon(day).getTime() + n * DAY_MS));
}
/** the same day n months later (31 jan. + 1 month = 28 or 29 feb.) */
export function addMonths(day: Day, n: number): Day {
  const [y, m, d] = day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return dayOfUtc(first);
}
export function dow(day: Day): number { return utcNoon(day).getUTCDay(); } // 0 = Sunday
export function weekStart(day: Day): Day { return addDays(day, -dow(day)); }
export function weekDays(day: Day): Day[] { const s = weekStart(day); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
export function daysBetween(a: Day, b: Day): number { return Math.round((utcNoon(b).getTime() - utcNoon(a).getTime()) / DAY_MS); }
export function isValidDay(s: unknown): s is Day {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return dayOfUtc(utcNoon(s)) === s;
}

/* ---------- minutes ---------- */

// a time of day is shown in whole minutes: 612.5 (a computed arrival) is « 10 h 13 », never « 10 h 12.5 »
const whole = (min: number) => Math.round(min);

export function hm(min: Minute): string { const m = whole(min); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
export function parseHm(s: string): Minute | null {
  const m = /^(\d{1,2})(?::|h|\s*h\s*)?(\d{2})?$/i.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]), mi = m[2] ? Number(m[2]) : 0;
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}

/** "8 h", "13 h 30" (fr) / "8 a.m.", "1:30 p.m." (en); past midnight it goes round the dial (1440 = "0 h") */
export function clock(min: Minute, lang = 'fr'): string {
  const t = ((whole(min) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60), m = t % 60;
  if (lang === 'en') {
    const ap = h < 12 ? 'a.m.' : 'p.m.';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m ? `${h12}:${pad(m)} ${ap}` : `${h12} ${ap}`;
  }
  return m ? `${h} h ${pad(m)}` : `${h} h`;
}
/** "8 h à 12 h" / "8 a.m. to 12 p.m." */
export function clockRange(a: Minute, b: Minute, lang = 'fr'): string {
  return lang === 'en' ? `${clock(a, 'en')} to ${clock(b, 'en')}` : `${clock(a)} à ${clock(b)}`;
}
/** "1 h 30", "45 min" / "1 h 30 min". Rounded to the minute first (119.6 is « 2 h », not « 1 h 60 »); a negative
    amount (time missing) carries its sign once: « -30 min ». */
export function duration(min: number, lang = 'fr'): string {
  const all = whole(min);
  if (all < 0) return `-${duration(-all, lang)}`;
  const h = Math.floor(all / 60), m = all % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return lang === 'en' ? `${h} h ${m} min` : `${h} h ${pad(m)}`;
}

/* ---------- days in words ---------- */

const dtf = new Map<string, Intl.DateTimeFormat>();
// the formatters read the day at noon UTC in the UTC zone: the same words on every phone
function df(lang: string, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = lang + JSON.stringify(o);
  let f = dtf.get(k);
  if (!f) { f = new Intl.DateTimeFormat(lang === 'en' ? 'en-CA' : 'fr-CA', { ...o, timeZone: 'UTC' }); dtf.set(k, f); }
  return f;
}
// a hand-typed #/agenda/abc must show nothing, not throw on an invalid date
function write(day: Day, lang: string, o: Intl.DateTimeFormatOptions): string {
  const d = utcNoon(day);
  return Number.isNaN(d.getTime()) ? '' : df(lang, o).format(d);
}

/** "mercredi 4 novembre" / "Wednesday, November 4" (adds the year when not the garage's current year) */
export function longDay(day: Day, lang = 'fr', now: Date = new Date()): string {
  const o: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  if (String(day).slice(0, 4) !== today(now).slice(0, 4)) o.year = 'numeric';
  return write(day, lang, o);
}
/** "4 nov. 2026" / "Nov 4, 2026" */
export function shortDate(day: Day, lang = 'fr'): string {
  return write(day, lang, { day: 'numeric', month: 'short', year: 'numeric' });
}
/** "mer. 4" / "Wed 4" */
export function tinyDay(day: Day, lang = 'fr'): string {
  return write(day, lang, { weekday: 'short', day: 'numeric' });
}
export function monthName(day: Day, lang = 'fr'): string {
  return write(day, lang, { month: 'long', year: 'numeric' });
}
/** a timestamp shown on the garage's clock: "4 nov. 2026, 14 h 23" ('' when there is none or it is not a date) */
export function stamp(iso: string | null | undefined, lang = 'fr'): string {
  if (!iso) return '';
  const p = garageParts(new Date(iso));
  return p ? `${shortDate(p.day, lang)}, ${clock(p.minute, lang)}` : '';
}

/* ---------- blocks ---------- */
/** 'day': the whole day, when the garage books by 4-hour arrival windows (« plages d'arrivée », settings.booking.windows_on) */
export type BlockKey = 'am' | 'pm' | 'eve' | 'day';
export interface Block { key: BlockKey; start: Minute; end: Minute }
export const DEFAULT_BLOCKS: Block[] = [
  { key: 'am', start: 8 * 60, end: 12 * 60 },
  { key: 'pm', start: 12 * 60, end: 16 * 60 },
  { key: 'eve', start: 16 * 60, end: 20 * 60 }
];
/** the arrival window told to a customer for an estimated arrival: 1 h before, 3 h after, on the hour, 4 h long, inside the day
    (3 pm → 2 pm to 6 pm; 8 am with a day that starts at 8 → 8 to noon). The server does the same (public.win_for). */
export function windowFor(eta: Minute, o: { before?: number; after?: number; round?: number; dayStart?: number; dayEnd?: number } = {}): Range {
  const before = o.before ?? 60, after = o.after ?? 180, round = o.round ?? 60, d0 = o.dayStart ?? 8 * 60, d1 = o.dayEnd ?? 20 * 60;
  const len = before + after;
  let s = Math.round(eta / round) * round - before;
  s = Math.max(d0, Math.min(s, Math.max(d0, d1 - len)));
  return [s, s + len];
}

/* ---------- time ranges (truck hours) ---------- */
export type Range = [Minute, Minute];
/** merge overlapping/touching ranges, sorted */
export function mergeRanges(rs: Range[]): Range[] {
  const s = rs.filter(([a, b]) => b > a).map(([a, b]) => [a, b] as Range).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}
/** minutes of `rs` inside [a, b) */
export function overlapMinutes(rs: Range[], a: Minute, b: Minute): number {
  let n = 0;
  for (const [x, y] of mergeRanges(rs)) n += Math.max(0, Math.min(y, b) - Math.max(x, a));
  return n;
}
/** cells of `step` minutes → ranges (used by the drag-select schedule editor) */
export function cellsToRanges(cells: Minute[], step: number): Range[] {
  return mergeRanges(cells.map((c) => [c, c + step] as Range));
}
export function rangesToCells(rs: Range[], step: number, from = 0, to = 1440): Minute[] {
  const out: Minute[] = [];
  for (let c = from; c < to; c += step) if (overlapMinutes(rs, c, c + step) >= step) out.push(c);
  return out;
}
