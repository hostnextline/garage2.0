/* The team map of a day, from the server: team_map(p_day) now and every 30 s (paused while the app is hidden, asked again
   when it comes back). Before the first answer, and with no signal and no earlier answer: the phone's copy (device.ts),
   drawn again as the phone's copy changes. The last answer of each day is kept while the app is open (per person, the
   last few days only), so coming back to the map shows it at once.
   A refresh never resets anything on the screen: the new answer simply replaces the old one. An answer that comes back
   after a newer question was asked (or after the day changed) is dropped. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { rpcNow, errorMessage } from '../../data/api';
import { isNetworkError } from '../../data/sync';
import { access } from '../../data/auth';
import { job as jobRow, customer as customerRow } from '../../data/select';
import { rowsOf } from '../../data/store';
import type { Position } from '../../data/types';
import type { Day } from '../../lib/dates';
import { normalize, type TeamMapAnswer } from './assemble';
import { fromDevice } from './device';
import { withPositions, freshen, type Pos } from './teamMapData';

export const REFRESH_MS = 30000;
const KEEP_DAYS = 12;
export type MapStatus = 'loading' | 'ok' | 'offline' | 'refused';
interface Answer { data: TeamMapAnswer; at: number }

/* the last answer of each day, for this person (kept while the app is open; never written to the phone) */
const memory = new Map<string, Answer>();
const memKey = (day: string) => `${access.value?.id || ''}|${day}`;
function keep(day: string, a: Answer) {
  const k = memKey(day);
  memory.delete(k);
  memory.set(k, a);
  while (memory.size > KEEP_DAYS) memory.delete(memory.keys().next().value as string);
}
/** forgets the kept answers (tests) */
export function forgetTeamMaps() { memory.clear(); }

export interface TeamMap {
  data: TeamMapAnswer;
  /** when the answer shown was received (ms); for the phone's copy: when the day was opened */
  at: number;
  source: 'server' | 'device';
  status: MapStatus;
  error: string | null;
  /** a question to the server is on its way */
  busy: boolean;
  /** asks the server now (« Mettre à jour maintenant », after « Trouver »); resolves when it answered */
  refresh: () => Promise<void>;
  /** positions found on this phone a moment ago: on the map now, before the server has them */
  place: (placed: Record<string, Pos>) => void;
}

interface DayState { day: Day; since: number; answer: Answer | null; status: MapStatus; error: string | null; placed: Record<string, Pos> }
const fresh = (day: Day): DayState => ({ day, since: Date.now(), answer: memory.get(memKey(day)) || null, status: 'loading', error: null, placed: {} });

/** where the phone knows a job is: its own position, else its customer's */
function knownPos(id: string): Pos | null {
  const row = jobRow(id);
  if (row?.lat != null && row?.lng != null) return { lat: row.lat, lng: row.lng };
  const c = row?.customer_id ? customerRow(row.customer_id) : undefined;
  return c?.lat != null && c?.lng != null ? { lat: c.lat, lng: c.lng } : null;
}
function deviceJob(id: string) {
  const row = jobRow(id);
  const u = row?.updated_at ? Date.parse(row.updated_at) : NaN;
  return row && Number.isFinite(u) ? { status: row.status, updatedAt: u } : null;
}

export function useTeamMap(day: Day): TeamMap {
  const [st, setSt] = useState<DayState>(() => fresh(day));
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const load = useRef<() => Promise<void>>(async () => undefined);
  // the first drawing of a new day already shows that day (never the day before under the new title)
  const cur = st.day === day ? st : fresh(day);

  useEffect(() => {
    let alive = true;
    setSt(fresh(day));
    const ask = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const n = ++seq.current;
      setBusy(true);
      try {
        const data = normalize(await rpcNow<unknown>('team_map', { p_day: day }));
        if (!alive || n !== seq.current) return;
        const answer = { data, at: Date.now() };
        keep(day, answer);
        setSt((s) => ({ ...s, answer, status: 'ok', error: null }));
      } catch (e) {
        if (!alive || n !== seq.current) return;
        if (isNetworkError(e)) setSt((s) => ({ ...s, status: 'offline' }));
        else setSt((s) => ({ ...s, status: 'refused', error: errorMessage(e) }));
      } finally {
        if (alive && n === seq.current) setBusy(false);
      }
    };
    load.current = ask;
    void ask();
    const timer = setInterval(() => { void ask(); }, REFRESH_MS);
    const onShow = () => { if (!document.hidden) void ask(); };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      alive = false;
      seq.current++;   // an answer on its way is for a screen that is gone
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [day]);

  // read while drawing, so the phone's copy is drawn again when it changes (offline, before the first answer)
  const base = cur.answer
    ? (cur.status === 'offline' ? freshen(cur.answer.data, cur.answer.at, { job: deviceJob, positions: rowsOf<Position>('positions').filter((p) => !p.deleted_at) }) : cur.answer.data)
    : fromDevice(day);
  return {
    data: withPositions(base, knownPos, cur.placed),
    at: cur.answer ? cur.answer.at : cur.since,
    source: cur.answer ? 'server' : 'device',
    status: cur.status,
    error: cur.error,
    busy,
    refresh: () => load.current(),
    place: (placed) => setSt((s) => (s.day === day ? { ...s, placed: { ...s.placed, ...placed } } : s))
  };
}
