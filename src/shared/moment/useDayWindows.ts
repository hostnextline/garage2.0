/* The windows still possible on each day shown by the time calendar (`suggest_windows`, one request per day, in
   parallel). Answers are kept a short moment (by day, place, length of work, kind of vehicle, job left out, and what the
   phone holds of that day) so that going back a week, or choosing a time, does not ask again; a day whose appointments
   change on the phone (a colleague booked, the planner moved a stop) is asked again. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { suggestWindows } from '../../data/api';
import { isNetworkError } from '../../data/sync';
import { cacheKey } from '../../domain/moment/units';
import type { DayWins, WinStatus } from './windowDays';

export type { DayWins, WinStatus };
export interface WinQuery { lat: number | null; lng: number | null; duration: number; kind: 'car' | 'truck' | null; need: boolean; exclude: string | null }

const KEEP_MS = 45_000;
const kept = new Map<string, { at: number; rows: DayWins['rows'] }>();
/* each « forget » starts a new generation: an answer asked before it (slow, landing after the newer one) is not kept,
   so it cannot put back for 45 s a window the server just refused */
let generation = 0;
/** forget every answer (a window refused by the server, « Réessayer », the tests) */
export function forgetWindows() { kept.clear(); generation++; }
const fresh = (key: string) => { const k = kept.get(key); return k && Date.now() - k.at < KEEP_MS ? k.rows : null; };
const LOADING: DayWins = { status: 'loading', rows: [] };

/** day → what the server says of it. `bump`: a new number asks everything again. `stampOf`: what the phone holds of a
    day (its appointments); a new stamp asks that day again. */
export function useDayWindows(days: string[], q: WinQuery, online: boolean, bump: number, stampOf: (day: string) => string = () => ''): (day: string) => DayWins {
  const [got, setGot] = useState<Record<string, DayWins>>({});
  const keyOf = (day: string) => `${cacheKey({ day, ...q })}#${stampOf(day)}`;
  const keys = days.map(keyOf);
  const list = keys.join(',');
  const lastBump = useRef(bump);
  /* the day's question (place, work, vehicle, job left out: the key without its stamp) → the key of its LAST answer, so a
     day asked again shows that answer dimmed meanwhile (not an older one) */
  const last = useRef(new Map<string, string>());
  const note = (k: string) => { last.current.set(headOf(k), k); };
  useEffect(() => {
    if (lastBump.current !== bump) { lastBump.current = bump; forgetWindows(); }
    if (!days.length) return;
    if (!online) { setGot((g) => ({ ...g, ...Object.fromEntries(keys.map((k) => [k, { status: 'offline', rows: [] } as DayWins])) })); return; }
    let alive = true;
    const missing = days.filter((_d, i) => !fresh(keys[i]));
    // what is already known is shown at once; the rest waits (the last answer of that day stays on screen meanwhile).
    // An entry that does not change keeps its identity: the days drawn from it are not drawn again.
    setGot((g) => {
      /* nothing piles up: only the answers of the days shown and the LAST answer of each day of the same question (shown
         dimmed while that day is asked again, or when the person pages back) are kept; another address, duration or
         vehicle, and the older stamps of a day, are dropped */
      const question = askOf(keys[0]);
      for (const h of [...last.current.keys()]) if (askOf(h) !== question) last.current.delete(h);
      const keep = new Set([...keys, ...last.current.values()]);
      const next: Record<string, DayWins> = {};
      for (const k in g) if (keep.has(k)) next[k] = g[k];
      days.forEach((_d, i) => {
        const k = keys[i];
        const rows = fresh(k);
        const was = g[k];
        if (rows) { note(k); if (!was || was.status !== 'ok' || was.rows !== rows) next[k] = { status: 'ok', rows }; }
        else if (!was || was.status !== 'loading') next[k] = { status: 'loading', rows: was?.rows || prevRows(g, last.current.get(headOf(k)), k) };
      });
      return next;
    });
    if (!missing.length) return;
    const gen = generation;
    const tm = setTimeout(() => {
      days.forEach((d, i) => {
        if (!missing.includes(d)) return;
        const k = keys[i];
        suggestWindows(q.lat, q.lng, q.duration, d, q.exclude, q.need, q.need ? null : q.kind).then((rows) => {
          if (gen === generation) kept.set(k, { at: Date.now(), rows });
          if (alive) { note(k); setGot((g) => ({ ...g, [k]: { status: 'ok', rows } })); }
        }, (e: unknown) => {
          if (alive) setGot((g) => ({ ...g, [k]: { status: isNetworkError(e) ? 'offline' : 'error', rows: [] } }));
        });
      });
    }, 300);
    return () => { alive = false; clearTimeout(tm); };
  }, [list, online, bump]);
  return (day) => got[keyOf(day)] || LOADING;
}

/** the key without what the phone holds of the day (its stamp) */
const headOf = (key: string) => key.slice(0, key.lastIndexOf('#') + 1);
/** the key without its day nor its stamp: the question itself (cacheKey starts with the day) */
const askOf = (key: string) => { const h = headOf(key); return h.slice(h.indexOf('|') + 1); };
/** a day asked again because its appointments changed: its LAST answer (`lastKey`) stays on screen (dimmed) meanwhile.
    Before, the first entry of that day in the order they were made was taken: an older answer. */
function prevRows(g: Record<string, DayWins>, lastKey: string | undefined, key: string): DayWins['rows'] {
  return lastKey && lastKey !== key ? g[lastKey]?.rows ?? [] : [];
}
