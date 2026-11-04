/* Dates are local calendar days written 'YYYY-MM-DD' (the garage is in Montréal); times are minutes after midnight.
   The week goes from Sunday to Saturday, like the schedule Hassan asked for. */

export type Day = string;       // 'YYYY-MM-DD'
export type Minute = number;    // 0..1440

export const TZ = 'America/Toronto'; // same rules as Montréal

const pad = (n: number) => String(n).padStart(2, '0');

export function dayOf(d: Date): Day {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function today(now: Date = new Date()): Day { return dayOf(now); }
export function parseDay(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0); // noon: safe across DST changes
}
export function addDays(day: Day, n: number): Day {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dayOf(d);
}
export function dow(day: Day): number { return parseDay(day).getDay(); } // 0 = Sunday
export function weekStart(day: Day): Day { return addDays(day, -dow(day)); }
export function weekDays(day: Day): Day[] { const s = weekStart(day); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
export function daysBetween(a: Day, b: Day): number { return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000); }
export function isValidDay(s: unknown): s is Day {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return dayOf(parseDay(s)) === s;
}
export function nowMinute(now: Date = new Date()): Minute { return now.getHours() * 60 + now.getMinutes(); }

export function hm(min: Minute): string { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
export function parseHm(s: string): Minute | null {
  const m = /^(\d{1,2})(?::|h|\s*h\s*)?(\d{2})?$/i.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]), mi = m[2] ? Number(m[2]) : 0;
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}

/** "8 h", "13 h 30" (fr) / "8 a.m.", "1:30 p.m." (en) */
export function clock(min: Minute, lang = 'fr'): string {
  const h = Math.floor(min / 60) % 24, m = min % 60;
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
/** "1 h 30", "45 min" / "1 h 30 min" */
export function duration(min: number, lang = 'fr'): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return lang === 'en' ? `${h} h ${m} min` : `${h} h ${pad(m)}`;
}

const dtf = new Map<string, Intl.DateTimeFormat>();
function df(lang: string, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = lang + JSON.stringify(o);
  let f = dtf.get(k);
  if (!f) { f = new Intl.DateTimeFormat(lang === 'en' ? 'en-CA' : 'fr-CA', o); dtf.set(k, f); }
  return f;
}
/** "mercredi 4 novembre" / "Wednesday, November 4" (adds the year when not this year) */
export function longDay(day: Day, lang = 'fr', now: Date = new Date()): string {
  const d = parseDay(day);
  const o: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
  return df(lang, o).format(d);
}
/** "4 nov. 2026" / "Nov 4, 2026" */
export function shortDate(day: Day, lang = 'fr'): string {
  return df(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(parseDay(day));
}
/** "mer. 4" / "Wed 4" */
export function tinyDay(day: Day, lang = 'fr'): string {
  return df(lang, { weekday: 'short', day: 'numeric' }).format(parseDay(day));
}
export function monthName(day: Day, lang = 'fr'): string {
  return df(lang, { month: 'long', year: 'numeric' }).format(parseDay(day));
}
/** a timestamp shown in local time: "4 nov. 2026, 14 h 23" */
export function stamp(iso: string | null | undefined, lang = 'fr'): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${shortDate(dayOf(d), lang)}, ${clock(d.getHours() * 60 + d.getMinutes(), lang)}`;
}

/* ---------- blocks ---------- */
export type BlockKey = 'am' | 'pm' | 'eve';
export interface Block { key: BlockKey; start: Minute; end: Minute }
export const DEFAULT_BLOCKS: Block[] = [
  { key: 'am', start: 8 * 60, end: 12 * 60 },
  { key: 'pm', start: 12 * 60, end: 16 * 60 },
  { key: 'eve', start: 16 * 60, end: 20 * 60 }
];
export function blockOf(min: Minute, blocks: Block[] = DEFAULT_BLOCKS): Block | undefined {
  return blocks.find((b) => min >= b.start && min < b.end);
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
/** first minute of `rs` inside [a, b), or null */
export function firstMinuteIn(rs: Range[], a: Minute, b: Minute): Minute | null {
  for (const [x, y] of mergeRanges(rs)) { const s = Math.max(x, a); if (s < Math.min(y, b)) return s; }
  return null;
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
