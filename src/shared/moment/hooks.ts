/* The hooks the two moment pickers share: the server's best moments (`suggest_blocks`), the clock, and the map
   window that follows the mouse on a computer. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { today as todayOf, nowMinute, type Day } from '../../lib/dates';
import { suggestBlocks, type Suggestion } from '../../data/api';
import { isNetworkError } from '../../data/sync';
import { keptRows } from './moments';
import type { Kind } from './vehicles';

/* ---------- the server's best moments ---------- */
export type SuggStatus = 'loading' | 'ok' | 'offline' | 'error';
export interface SuggState { status: SuggStatus; list: Suggestion[];
  /** the question `list` answers ('' before any answer) */
  key: string }
export interface SuggQuery {
  lat: number | null; lng: number | null; duration: number; from: Day; days: number;
  exclude: string | null; need: boolean; kind: Kind | null;
  /** a vehicle chosen by hand: only its rows are kept */
  truckId?: string | null;
}
const IDLE: SuggState = { status: 'ok', list: [], key: '' };
const keyOf = (q: SuggQuery) => [baseKey(q), q.from, q.days].join('|');
/** the question without its days: the same place, work, vehicle and job left out */
const baseKey = (q: Omit<SuggQuery, 'from' | 'days'>) => [q.lat, q.lng, q.duration, q.exclude, q.need, q.kind, q.truckId ?? ''].join('|');

/** the moments of `days` days from `from`, the best first. Asked 350 ms after the last change (each service ticked
    changes the duration); an answer of an older question is dropped; while a new one is awaited the last list stays
    (dimmed by the picker). `again`: a new number asks again (« Réessayer », a refusal of the server). `q` null: nothing
    to ask (status ok, empty list). */
export function useSuggestions(q: SuggQuery | null, online: boolean, again: number): SuggState {
  const [s, setS] = useState<SuggState>(() => (q ? { status: 'loading', list: [], key: '' } : IDLE));
  const key = q ? keyOf(q) : '';
  const ask = useRef(q);
  ask.current = q;
  useEffect(() => {
    const x = ask.current;
    if (!x) { setS(IDLE); return; }
    if (!online) { setS({ status: 'offline', list: [], key }); return; }
    let alive = true;
    setS((old) => ({ ...old, status: 'loading' }));
    const tm = setTimeout(async () => {
      try {
        const got = await suggestBlocks(x.lat, x.lng, x.duration, x.from, x.days, x.exclude, x.need, x.need ? null : x.kind);
        if (alive) setS({ status: 'ok', list: keptRows(got, x.truckId), key });
      } catch (e) {
        if (alive) setS({ status: isNetworkError(e) ? 'offline' : 'error', list: [], key });
      }
    }, 350);
    return () => { alive = false; clearTimeout(tm); };
  }, [key, online, again]);
  return s;
}
/** the list is usable: an answer is there or being replaced (not offline, not failed) */
export const hasAnswer = (s: SuggState): boolean => s.status === 'ok' || s.status === 'loading';
/** the list is THE answer to `q` (not the last one kept while a new question waits): only such a list may warn about a
    far moment or tell the screen to ask before booking (booking-b-26: after an address change the old address's scores
    warned, or kept quiet, about the new place until the answer landed) */
export const answers = (s: SuggState, q: SuggQuery): boolean => s.status === 'ok' && s.key === keyOf(q);

/** the garde-route scores of the days after the first two weeks (the best moments only look that far): asked for the
    days shown (`from`, `days`; null: none needed) and kept for the same question while the person pages back and forth,
    so a far moment chosen on a later page is still warned about from another page. Offline, or when the server failed,
    there are none (as for the first two weeks: old scores would mark cells and warn from an answer that may be stale) */
export function useLaterScores(base: Omit<SuggQuery, 'from' | 'days'>, from: Day | null, days: number, online: boolean, again: number): Suggestion[] {
  const s = useSuggestions(from ? { ...base, from, days } : null, online, again);
  const bk = baseKey(base);
  const kept = useRef<{ base: string; byFrom: Map<string, Suggestion[]> }>({ base: bk, byFrom: new Map() });
  if (kept.current.base !== bk) kept.current = { base: bk, byFrom: new Map() };
  // only an answer to the question of now (the state can still hold the previous page's for one drawing)
  if (from && s.status === 'ok' && s.key === keyOf({ ...base, from, days })) kept.current.byFrom.set(from, s.list);
  const none = !online || s.status === 'offline' || s.status === 'error';
  return useMemo(() => (none ? [] : [...kept.current.byFrom.values()].flat()), [bk, s.key, s.status, none]);
}

/* ---------- the clock ---------- */
/** today and the minute of now, drawn again at each new minute while the picker is open: a block that starts, a time
    that passes, midnight (a screen left open during a call would otherwise keep « ce matin » pickable after 8 h) */
export function useClock(): { today: Day; now: number } {
  const [, tick] = useState(0);
  useEffect(() => {
    let tm: ReturnType<typeof setTimeout>;
    const next = () => { tm = setTimeout(() => { tick((n) => n + 1); next(); }, 60_000 - (Date.now() % 60_000) + 50); };
    next();
    return () => clearTimeout(tm);
  }, []);
  return { today: todayOf(), now: nowMinute() };
}

/* ---------- the map window of the moment under the mouse ---------- */
/** a mouse that hovers (a computer): the touch screens get the long press instead. `unknown`: the answer where the
    browser cannot tell (no matchMedia: the tests' page) */
export function useFinePointer(unknown = false): boolean {
  return useMemo(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(hover: hover) and (pointer: fine)').matches : unknown), [unknown]);
}

/** the mouse rests that long on a moment: the map window opens */
export const HOVER_MS = 250;
/** the window is open: it follows the mouse to another moment after that long (the eye compares the moments; a route is
    not asked for every moment the mouse only crosses) */
export const SWITCH_MS = 110;
/** the mouse left the moments (between two rows, over a booked stop): the window waits that long before closing */
export const GRACE_MS = 220;
/** the box on screen of the whole picker a moment belongs to (the map window goes beside it); null: not marked */
export const groupBox = (el: Element | null): DOMRect | null => el?.closest?.('[data-pop-group]')?.getBoundingClientRect() ?? null;

/** the moment the mouse rests on, after `delay` ms. Armed by any move of the mouse over the moment (not only when it
    comes in): after a scroll closed the window, or when the page scrolled under a mouse that did not move, the next small
    move opens it again. Once open, the window stays while the mouse goes from a moment to the next (it shows the new
    moment after SWITCH_MS) and closes GRACE_MS after the mouse left them all; at once at any scroll, with `off`, and
    when the picker goes away. `at`: the moment's box on screen, `group`: its picker's. `on` false (a touch screen, no
    address): no handlers at all. */
export function useHover<T>(delay: number, on: boolean) {
  const [hover, setHover] = useState<{ item: T; key: string; at: DOMRect; group: DOMRect | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef<string | null>(null);
  const shown = useRef<string | null>(null);
  shown.current = hover?.key ?? null;
  const stop = (t: { current: ReturnType<typeof setTimeout> | null }) => { if (t.current) clearTimeout(t.current); t.current = null; };
  const off = () => { stop(timer); stop(closer); waiting.current = null; setHover(null); };
  useEffect(() => {
    if (!hover) return;
    window.addEventListener('scroll', off, true);
    return () => window.removeEventListener('scroll', off, true);
  }, [hover]);
  useEffect(() => () => { stop(timer); stop(closer); }, []);
  const props = (key: string, item: T) => (!on ? {} : {
    onMouseMove: (e: MouseEvent) => {
      // back on a moment: the window stays
      stop(closer);
      if (waiting.current === key) return;
      // back on the moment shown, before the window went to the one the mouse only crossed
      if (shown.current === key) { stop(timer); waiting.current = null; return; }
      const el = e.currentTarget as HTMLElement;
      stop(timer);
      waiting.current = key;
      timer.current = setTimeout(() => {
        timer.current = null; waiting.current = null;
        setHover({ item, key, at: el.getBoundingClientRect(), group: groupBox(el) });
      }, shown.current ? SWITCH_MS : delay);
    },
    onMouseLeave: () => {
      stop(timer);
      waiting.current = null;
      if (!shown.current || closer.current) return;
      closer.current = setTimeout(() => { closer.current = null; setHover(null); }, GRACE_MS);
    }
  });
  return { hover, props, off };
}
