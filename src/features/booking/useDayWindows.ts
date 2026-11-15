/* The windows still possible on each day shown by the time calendar (`suggest_windows`, one request per day, in
   parallel). Answers are kept a short moment (by day, place, length of work, kind of vehicle, job left out) so that
   going back a week, or choosing a time, does not ask again. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { suggestWindows, type Suggestion } from '../../data/api';
import { isNetworkError } from '../../data/sync';
import { cacheKey } from './units';

export type WinStatus = 'loading' | 'ok' | 'offline' | 'error';
export interface DayWins { status: WinStatus; rows: Suggestion[] }
export interface WinQuery { lat: number | null; lng: number | null; duration: number; kind: 'car' | 'truck' | null; need: boolean; exclude: string | null }

const KEEP_MS = 45_000;
const kept = new Map<string, { at: number; rows: Suggestion[] }>();
/** forget every answer (a window refused by the server, « Réessayer », the tests) */
export function forgetWindows() { kept.clear(); }
const fresh = (key: string) => { const k = kept.get(key); return k && Date.now() - k.at < KEEP_MS ? k.rows : null; };
const LOADING: DayWins = { status: 'loading', rows: [] };

/** day → what the server says of it. `bump`: a new number asks everything again. */
export function useDayWindows(days: string[], q: WinQuery, online: boolean, bump: number): (day: string) => DayWins {
  const [got, setGot] = useState<Record<string, DayWins>>({});
  const keyOf = (day: string) => cacheKey({ day, ...q });
  const list = days.join(',');
  const lastBump = useRef(bump);
  useEffect(() => {
    if (lastBump.current !== bump) { lastBump.current = bump; forgetWindows(); }
    if (!days.length) return;
    if (!online) { setGot((g) => ({ ...g, ...Object.fromEntries(days.map((d) => [keyOf(d), { status: 'offline', rows: [] } as DayWins])) })); return; }
    let alive = true;
    const missing = days.filter((d) => !fresh(keyOf(d)));
    // what is already known is shown at once; the rest waits (the last answer of that day stays on screen meanwhile)
    setGot((g) => {
      const next = { ...g };
      for (const d of days) { const k = keyOf(d); const rows = fresh(k); next[k] = rows ? { status: 'ok', rows } : { status: 'loading', rows: g[k]?.rows || [] }; }
      return next;
    });
    if (!missing.length) return;
    const tm = setTimeout(() => {
      for (const d of missing) {
        const k = keyOf(d);
        suggestWindows(q.lat, q.lng, q.duration, d, q.exclude, q.need, q.need ? null : q.kind).then((rows) => {
          kept.set(k, { at: Date.now(), rows });
          if (alive) setGot((g) => ({ ...g, [k]: { status: 'ok', rows } }));
        }).catch((e) => {
          if (alive) setGot((g) => ({ ...g, [k]: { status: isNetworkError(e) ? 'offline' : 'error', rows: [] } }));
        });
      }
    }, 300);
    return () => { alive = false; clearTimeout(tm); };
  }, [list, q.lat, q.lng, q.duration, q.kind, q.need, q.exclude, online, bump]);
  return (day) => got[keyOf(day)] || LOADING;
}
