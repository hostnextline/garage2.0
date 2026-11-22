/* « Réorganiser la journée » (Part 28, REARRANGE.md §1.4, §2.4-§2.7): what the app sends to rearrange a day, and how it
   reads the server's answers. Every name the server chose is HERE and only here (the rule of exact.ts):
   - the preview: day_order_preview(p_day, p_lists, p_moved, p_was, p_auto), nothing written (its rows are the trial's:
     never kept on the phone), called with { noOp: true, apply: false };
   - the save: day_order_save(p_op, p_day, p_lists, p_moved, p_was, p_auto, p_accept), never kept on the phone for later
     ({ queue: false }); one op per press, the SAME op for its one retry (a deadlock, a lost answer: op_begin gives the
     stored answer when it was saved);
   - the answer of both: { ok, day, basis_ok, mode, roads, rewin, auto, lists, stops, trucks, accept, due_after } (+ saved,
     rows on a save); basis_ok false: { gone, new, changed, by };
   - Part 29 (Hassan, 2026-11-22: « if i move an appointement down, i need it to change its hour, and accept the
     appointement where i put it without moving all the others arround »; drag-keeps-spec.md §4.2, §5): a stop dragged
     takes the hour of its new place and that minute is PINNED at the save: `pin_new` true, `pin` = that minute,
     `pin_was` = its pin before (or null), and `accept.at` = { id: minute } (sent back raw; never a warning on its own:
     needsConfirm does not read it). A stop NOT dragged whose pin was already late and is not made later is pinned again
     at its arrival (`pin_new` false, `pin_was` the old minute, `accept.at` too): that one IS a warning (the reviews' F6:
     his minute changes), and so is a stop NOT dragged that the drag pushes later (the reviews' S1, the lead's G2: « pushed
     later only when the dragged one truly takes their time: warn first, « Enregistrer quand même » accepts »). An older
     server sends none of these: everything reads as before (pinNew false, pinWas null, at {}).
   - the refusals: raise … hint = code, detail = JSON (truck_off, truck_ends, needs_truck, changed, day_changed,
     outcome_changed with the whole answer in detail, bad_list, past, bad_block, not_allowed).
   The draft kept on the phone while it is not saved (days F12): localStorage `his.dayOrder.<staff id>.<day>`, every read
   and write in a try (a private window, a full storage: the screen works without it).
   Tested in dayOrder.test.ts (the server pretended). */
import { callRpc } from './sync';
import { classify } from '../lib/errors';

/** how long after the LAST change of the draft its times are asked (the value of « Ordre des arrêts » before) */
export const DAY_ORDER_WAIT_MS = 600;
/** a preview that gave up on a job row another action held (its lock_timeout) is asked once more after this */
export const DAY_ORDER_LOCK_RETRY_MS = 600;
/** a save undone by a deadlock is sent once more after this, with the same op */
export const DAY_ORDER_DEADLOCK_RETRY_MS = 1000;

/* ---------- what is sent ---------- */
export interface DayOrderList { truck: string; block: string; jobs: string[] }
export interface DayOrderAsk {
  day: string;
  /** each truck (and block) with its booked stops in the order wanted; null only with `auto` in a preview */
  lists: DayOrderList[] | null;
  /** the stops picked up and put down, minus those back at their own place */
  moved: string[];
  /** what the draft was built from: { job id: [truck, block, stop_order, win_start, win_end, arrive_at, status] } */
  was: Record<string, readonly unknown[]> | null;
  /** « Laisser l'app choisir » was used in this draft */
  auto: boolean;
}
function argsOf(a: DayOrderAsk): Record<string, unknown> {
  return { p_day: a.day, p_lists: a.lists, p_moved: [...a.moved], p_was: a.was, p_auto: a.auto };
}

/* ---------- what comes back ---------- */
export type Win = [number, number];
export interface DayStop {
  id: string; truckId: string | null; truckBefore: string | null; block: string | null;
  order: number | null; orderBefore: number | null; eta: number | null; etaBefore: number | null;
  /** « Vraies routes » on: every trip up to it measured (false: no time, never late); null: switch off (always sure) */
  measured: boolean | null;
  /** its window now (null: flexible, or a block job) and the one the save writes (a new one, or back to what he was told) */
  win: Win | null; newWin: Win | null; winBack: boolean;
  flexFixed: boolean; flexLater: boolean;
  lateMin: number; earlyMin: number;
  /** its pinned minute (after the save), and the pin that does not hold (pinMoved: the person dragged it, older server) */
  pin: number | null; pinLost: number | null; pinMoved: boolean;
  /** Part 29: the person dragged it here, and the save pins it at `pin` (its new hour); `pinWas`: its pin before, or null */
  pinNew: boolean; pinWas: number | null;
  /** « Laisser l'app choisir »: the planner found no room for it (left at the end of its truck, late) — an optional flag */
  over: boolean;
}
export interface DayTruck { id: string; block: string | null; hoursEnd: number | null; finish: number | null; overMin: number; driveMin: number | null; unmeasured: number }
export interface DayAccept {
  windows: Record<string, number>; flex: Record<string, number>; late: Record<string, number>; early: Record<string, number>; pins: Record<string, number>; over: Record<string, number>;
  /** Part 29: the minutes the save pins (the stops dragged, a late pin pinned again at its arrival): not a warning */
  at: Record<string, number>;
}
export interface DayAnswer {
  kind: 'answer';
  day: string | null; mode: 'windows' | 'blocks'; roads: boolean; rewin: boolean; auto: boolean;
  lists: DayOrderList[]; stops: DayStop[]; byId: Map<string, DayStop>; trucks: DayTruck[];
  accept: DayAccept;
  /** exactly the accept object the server gave (sent back as p_accept, untouched) */
  acceptRaw: Record<string, unknown>;
  /** distinct customers due on that day after this (null: not said) */
  dueAfter: number | null;
  saved: boolean;
}
/** the draft's basis no longer is the day (preview): who saved it meanwhile, when someone did */
export interface DayBasis { kind: 'basis'; gone: string[]; added: string[]; changed: string[]; by: string | null }

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const pos = (x: unknown): number => Math.max(0, num(x) ?? 0);
const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null);
const win = (x: unknown): Win | null => (Array.isArray(x) && x.length === 2 && num(x[0]) != null && num(x[1]) != null ? [x[0] as number, x[1] as number] : null);
function minutes(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(x) || {})) { const n = num(v); if (n != null) out[k] = n; }
  return out;
}
function listOf(raw: unknown): DayOrderList | null {
  const l = obj(raw);
  if (!l || typeof l.truck !== 'string') return null;
  return { truck: l.truck, block: str(l.block) ?? 'day', jobs: ids(l.jobs) };
}
function stopOf(raw: unknown): DayStop | null {
  const s = obj(raw);
  if (!s || typeof s.id !== 'string') return null;
  return {
    id: s.id, truckId: str(s.truck_id), truckBefore: str(s.truck_before), block: str(s.block),
    order: num(s.order), orderBefore: num(s.order_before), eta: num(s.eta), etaBefore: num(s.eta_before),
    measured: typeof s.measured === 'boolean' ? s.measured : null,
    win: win(s.win), newWin: win(s.new_win), winBack: s.win_back === true,
    flexFixed: s.flex_fixed === true, flexLater: s.flex_later === true,
    lateMin: pos(s.late_min), earlyMin: pos(s.early_min),
    pin: num(s.pin), pinLost: num(s.pin_lost), pinMoved: s.pin_moved === true,
    pinNew: s.pin_new === true, pinWas: num(s.pin_was),
    over: s.over === true
  };
}
function truckOf(raw: unknown): DayTruck | null {
  const t = obj(raw);
  if (!t || typeof t.id !== 'string') return null;
  return { id: t.id, block: str(t.block), hoursEnd: num(t.hours_end), finish: num(t.finish), overMin: pos(t.over_min), driveMin: num(t.drive_min), unmeasured: pos(t.unmeasured) };
}

/** the answer of a preview or a save, every key with its type; null: not an answer of the rearranging (an older server) */
export function dayAnswer(raw: unknown): DayAnswer | DayBasis | null {
  const r = obj(raw);
  if (!r) return null;
  if (r.basis_ok === false) {
    const by = obj(r.by);
    return { kind: 'basis', gone: ids(r.gone), added: ids(r.new), changed: ids(r.changed), by: by ? str(by.name) : str(r.by) };
  }
  if (!Array.isArray(r.stops)) return null;
  const stops = (r.stops as unknown[]).map(stopOf).filter((x): x is DayStop => !!x);
  const a = obj(r.accept) || {};
  return {
    kind: 'answer',
    day: str(r.day), mode: r.mode === 'blocks' ? 'blocks' : 'windows', roads: r.roads === true, rewin: r.rewin !== false, auto: r.auto === true,
    lists: (Array.isArray(r.lists) ? r.lists : []).map(listOf).filter((x): x is DayOrderList => !!x),
    stops, byId: new Map(stops.map((s) => [s.id, s])),
    trucks: (Array.isArray(r.trucks) ? r.trucks : []).map(truckOf).filter((x): x is DayTruck => !!x),
    accept: { windows: minutes(a.windows), flex: minutes(a.flex), late: minutes(a.late), early: minutes(a.early), pins: minutes(a.pins), over: minutes(a.over), at: minutes(a.at) },
    acceptRaw: a,
    dueAfter: num(r.due_after),
    saved: r.saved === true
  };
}
/** the window a stop gets at the save when it is truly another one: a « new window » equal to the window it has is no
    change (spec F4: an arrival past the day's end, win_for clamps it to the same 16 h – 20 h) */
export function newWinOf(s: Pick<DayStop, 'win' | 'newWin'>): Win | null {
  const n = s.newWin;
  return n && !(s.win && s.win[0] === n[0] && s.win[1] === n[1]) ? n : null;
}
/** the stops the save gives a NEW window (accept.windows, minus a « new » one equal to the window it has: F4) */
export function newWindows(a: DayAnswer): string[] {
  return Object.keys(a.accept.windows).filter((id) => { const s = a.byId.get(id); return !s || !!newWinOf(s); });
}
/** an hour that moves by more than this is « another hour » on the screen (« avant : vers … », a push) */
export const SHIFT_MIN = 4;
/** what the draft is (the stops dragged; « Laisser l'app choisir »): needed to tell a stop pushed from one dragged */
export interface DraftOf { moved?: Iterable<string>; auto?: boolean }
/** Part 29 (the reviews' S1; G2): the stops he did NOT drag that this draft pushes later (by more than SHIFT_MIN, from a
    sure arrival). None in « Laisser l'app choisir » (the app's order: every hour is the planner's) */
export function pushedOf(a: DayAnswer, o: DraftOf = {}): DayStop[] {
  if (o.auto) return [];
  const moved = new Set(o.moved ?? []);
  return a.stops.filter((s) => !s.pinNew && !moved.has(s.id) && s.measured !== false && s.eta != null && s.etaBefore != null && s.eta - s.etaBefore > SHIFT_MIN);
}
/** Part 29 (the reviews' F6, D2): a stop he did NOT drag whose minute pointed moves to its arrival (it was already past it) */
export function repinnedOf(a: DayAnswer): DayStop[] {
  return a.stops.filter((s) => !s.pinNew && s.pinWas != null && s.pin != null && s.pin !== s.pinWas);
}
/** the verdict must be SHOWN before the save (« Enregistrer quand même »): a new window, someone late or early, a pin
    that goes, a truck past its hours; Part 29: a stop not dragged pushed later, a minute pointed moved to its arrival. A
    flexible stop given its window is not a warning, nor the minute of the stop he dragged (`accept.at`: the hour of the
    place he put it). */
export function needsConfirm(a: DayAnswer, o: DraftOf = {}): boolean {
  const any = (m: Record<string, number>) => Object.keys(m).length > 0;
  return newWindows(a).length > 0 || any(a.accept.late) || any(a.accept.early) || any(a.accept.pins) || any(a.accept.over)
    || pushedOf(a, o).length > 0 || repinnedOf(a).length > 0;
}

/* ---------- the calls ---------- */
/** what this order of the day would give, nothing written. null: no such preview on the server (an older one). Throws
    the refusal (dayRefusal reads it), or no signal */
export async function dayOrderPreview(a: DayOrderAsk): Promise<DayAnswer | DayBasis | null> {
  const d = (await callRpc<unknown>('day_order_preview', argsOf(a), { noOp: true, apply: false })).data;
  return dayAnswer(d);
}
/** saves that order of the day (`accept`: exactly the accept object of the last preview the person saw, or {}). The
    answer's rows are applied to the phone (every block of the day). Never kept on the phone for later. */
export async function dayOrderSave(a: DayOrderAsk, accept: Record<string, unknown>, op: string): Promise<DayAnswer | DayBasis | null> {
  const d = (await callRpc<unknown>('day_order_save', { p_op: op, ...argsOf(a), p_accept: accept }, { queue: false })).data;
  return dayAnswer(d);
}

/* ---------- the refusals ---------- */
export interface DayRefusal {
  code: string;
  /** the refusal's detail (JSON), {} when none */
  detail: Record<string, unknown>;
  /** the stops it names (detail.jobs, .missing, .extra, .gone, .new, .changed) */
  jobs: string[];
  /** the truck it names, and the end of its day (truck_ends) */
  truck: string | null; ends: number | null;
  /** day_changed: who saved meanwhile */
  by: string | null;
}
/** a refusal of the preview or the save: its code and what its detail names. Not a refusal (no signal, a deadlock, a
    lock given up, a session to renew): null */
export function dayRefusal(e: unknown): DayRefusal | null {
  const c = classify(e);
  if (c.kind === 'network' || c.kind === 'auth') return null;
  const err = (e || {}) as { hint?: unknown; code?: unknown; details?: unknown };
  const code = [err.hint, err.code].map((x) => (typeof x === 'string' && /^[a-z][a-z0-9_]{1,39}$/.test(x) ? x : null)).find(Boolean) ?? null;
  if (!code) return null;
  let detail: Record<string, unknown> = {};
  const raw = err.details;
  if (obj(raw)) detail = raw as Record<string, unknown>;
  else if (typeof raw === 'string' && raw.trim().startsWith('{')) { try { detail = obj(JSON.parse(raw)) || {}; } catch { detail = {}; } }
  const by = obj(detail.by);
  return {
    code, detail,
    jobs: [...new Set([...ids(detail.jobs), ...ids(detail.missing), ...ids(detail.extra), ...ids(detail.gone), ...ids(detail.new), ...ids(detail.changed)])],
    truck: str(detail.truck), ends: num(detail.ends),
    by: by ? str(by.name) : str(detail.by)
  };
}
const sqlstate = (e: unknown): string => String(classify(e).code ?? '');
/** the save was undone by a deadlock (40P01): sent once more after 1 s with the same op */
export const isDeadlock = (e: unknown): boolean => sqlstate(e) === '40P01';
/** the preview gave up on a job row another action held (55P03, its lock_timeout): asked once more */
export const isLockBusy = (e: unknown): boolean => sqlstate(e) === '55P03';
/** no answer came (no signal, the time ran out, the server unwell): the save may have gone through */
export const isNoAnswer = (e: unknown): boolean => classify(e).kind === 'network' && !isDeadlock(e) && !isLockBusy(e);

/* ---------- the draft kept on the phone (days F12) ---------- */
export interface KeptDraft {
  was: Record<string, readonly unknown[]>;
  lists: DayOrderList[];
  moved: string[];
  auto: boolean;
  /** when it was kept (ISO) */
  at: string;
}
const keyOf = (staff: string, day: string) => `his.dayOrder.${staff}.${day}`;
/** keeps this account's unsaved order of that day on the phone; false when the phone could not keep it */
export function keepDraft(staff: string, day: string, d: KeptDraft): boolean {
  if (!staff || !day) return false;
  try { localStorage.setItem(keyOf(staff, day), JSON.stringify(d)); return true; } catch { return false; }
}
/** this account's unsaved order of that day, or null (none, unreadable, or not one of ours) */
export function keptDraft(staff: string, day: string): KeptDraft | null {
  if (!staff || !day) return null;
  try {
    const raw = localStorage.getItem(keyOf(staff, day));
    if (!raw) return null;
    const v = obj(JSON.parse(raw));
    if (!v || !Array.isArray(v.lists) || typeof v.at !== 'string') return null;
    return {
      was: (obj(v.was) || {}) as Record<string, readonly unknown[]>,
      lists: (v.lists as unknown[]).map(listOf).filter((x): x is DayOrderList => !!x),
      moved: ids(v.moved), auto: v.auto === true, at: v.at
    };
  } catch { return null; }
}
/** forgets it (saved, « Quitter », « Oublier ce brouillon ») */
export function dropDraft(staff: string, day: string): void {
  if (!staff || !day) return;
  try { localStorage.removeItem(keyOf(staff, day)); } catch { /* nothing kept: nothing to forget */ }
}
