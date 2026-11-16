/* In-memory tables shown on screen: one signal per table (a Map by id). Screens read them through selectors.
   Three layers make what a screen shows, row by row:
   - base: the server's rows (from the device copy, pulls, realtime, operation answers);
   - waiting: the changes of the outbox not confirmed yet, replayed in order on top of base (set by the engine), so a
     newer server copy of a row never wipes a change that still waits to be sent, and a refused change disappears
     by itself (the row falls back to the server's);
   - screen patches (`patchLocal`): a value shown ahead by a feature, until the server sends that row again.
   A table's signal is written only when a row really changed, and an unchanged row keeps its object, so a pull or a
   realtime echo that brings nothing new redraws nothing. */
import { signal, batch, type Signal } from '@preact/signals';
import { SYNCED, type TableName } from './schema';
import { cmpTs, tsMicros } from './clock';
import { sameValue } from './merge';

export type Row = { id: string; updated_at?: string | null; deleted_at?: string | null; [k: string]: unknown };

/** what one waiting change does to a row: a new row (put over whatever is there) or some fields changed */
export interface Fx { put?: Record<string, unknown>; patch?: Record<string, unknown> }
export type Waiting = Partial<Record<TableName, Map<string, Fx[]>>>;

const views = {} as Record<TableName, Signal<Map<string, Row>>>;
const base = {} as Record<TableName, Map<string, Row>>;
const screen = {} as Record<TableName, Map<string, Record<string, unknown>>>;
let waiting: Waiting = {};
for (const t of SYNCED) { views[t] = signal(new Map()); base[t] = new Map(); screen[t] = new Map(); }

export function tableSignal<T extends Row = Row>(t: TableName): Signal<Map<string, T>> {
  return views[t] as unknown as Signal<Map<string, T>>;
}
export function rowsOf<T extends Row = Row>(t: TableName): T[] {
  return Array.from(tableSignal<T>(t).value.values());
}
export function getRow<T extends Row = Row>(t: TableName, id: string | null | undefined): T | undefined {
  return id ? tableSignal<T>(t).value.get(id) : undefined;
}
/** the server's last version of a row (without this device's waiting changes) */
export function baseRow<T extends Row = Row>(t: TableName, id: string): T | undefined {
  return base[t].get(id) as T | undefined;
}
/** the ids of the server's rows held for a table */
export function baseIds(t: TableName): string[] { return [...base[t].keys()]; }
export function baseRows<T extends Row = Row>(t: TableName): T[] { return [...base[t].values()] as T[]; }

/* ---------- folding ---------- */
function fold(t: TableName, id: string): Row | undefined {
  let r: Row | undefined = base[t].get(id);
  for (const fx of waiting[t]?.get(id) || []) {
    if (fx.put) r = { ...(r || {}), ...fx.put, id } as Row;
    else if (fx.patch && r) r = { ...r, ...fx.patch, id };
  }
  const s = screen[t].get(id);
  if (s && r) r = { ...r, ...s, id };
  return r && !r.deleted_at ? r : undefined;
}
/** recomputes the view of these rows; writes the table's signal once, only when something changed */
function refold(t: TableName, ids: Iterable<string>) {
  const s = views[t];
  let next: Map<string, Row> | null = null;
  for (const id of ids) {
    const v = fold(t, id);
    const cur = (next || s.value).get(id);
    if (!v) {
      if (cur) { next ||= new Map(s.value); next.delete(id); }
    } else if (!cur || (cur !== v && !sameValue(cur, v))) {
      next ||= new Map(s.value);
      next.set(id, v);
    }
  }
  if (next) s.value = next;
}

/* ---------- server rows ---------- */
/** newer server rows replace older ones; a row with deleted_at set leaves; the same row again changes nothing.
    `force`: apply even when older (a repair after the server's rows went back in time). */
function apply(t: TableName, rows: Row[], force: boolean): { put: Row[]; removed: string[] } {
  const put: Row[] = [], removed: string[] = [];
  const b = base[t];
  for (const r of rows) {
    if (!r || r.id == null) continue;
    const id = String(r.id);
    const cur = b.get(id);
    const stamped = cur && !Number.isNaN(tsMicros(r.updated_at)) && !Number.isNaN(tsMicros(cur.updated_at));
    const c = stamped ? cmpTs(r.updated_at, cur!.updated_at) : 0;
    if (r.deleted_at) {
      if (cur && !force && stamped && c < 0) continue;
      if (cur) b.delete(id);
      screen[t].delete(id);
      removed.push(id);
      continue;
    }
    if (cur && !force && stamped && c < 0) continue;
    const row = { ...r, id } as Row;
    if (cur && sameValue(cur, row)) continue;
    b.set(id, row);
    screen[t].delete(id);
    put.push(row);
  }
  if (put.length || removed.length) refold(t, [...put.map((r) => r.id), ...removed]);
  return { put, removed };
}
function remove(t: TableName, ids: string[]) {
  if (!ids.length) return;
  for (const id of ids) { base[t].delete(id); screen[t].delete(id); }
  refold(t, ids);
}
function load(t: TableName, rows: Row[]) {
  const old = [...views[t].value.keys(), ...base[t].keys()];
  base[t] = new Map(rows.filter((r) => r && r.id != null && !r.deleted_at).map((r) => [String(r.id), { ...r, id: String(r.id) } as Row]));
  screen[t] = new Map();
  refold(t, new Set([...old, ...base[t].keys(), ...(waiting[t]?.keys() || [])]));
}
function setWaiting(next: Waiting) {
  const before = waiting;
  waiting = next;
  batch(() => {
    for (const t of SYNCED) {
      const a = before[t], z = next[t];
      if (!a?.size && !z?.size) continue;
      refold(t, new Set([...(a?.keys() || []), ...(z?.keys() || [])]));
    }
  });
}
function clear() {
  batch(() => {
    waiting = {};
    for (const t of SYNCED) { base[t] = new Map(); screen[t] = new Map(); if (views[t].value.size) views[t].value = new Map(); }
  });
}

/* ---------- the engine's door: only the engine of the account on screen may write ---------- */
let owner: object | null = null;
export interface StoreWriter {
  apply(t: TableName, rows: Row[], o?: { force?: boolean }): { put: Row[]; removed: string[] };
  remove(t: TableName, ids: string[]): void;
  loadAll(rows: Partial<Record<TableName, Row[]>>, w: Waiting): void;
  setWaiting(w: Waiting): void;
  /** still the engine on screen (a late answer of a signed-out account is dropped) */
  readonly live: boolean;
}
/** the engine that owns the screen from now on; every earlier writer is ignored */
export function bindStore(token: object): StoreWriter {
  owner = token;
  const live = () => owner === token;
  return {
    apply: (t, rows, o = {}) => (live() ? batch(() => apply(t, rows, !!o.force)) : { put: [], removed: [] }),
    remove: (t, ids) => { if (live()) batch(() => remove(t, ids)); },
    loadAll: (rows, w) => {
      if (!live()) return;
      batch(() => { waiting = w; for (const t of SYNCED) load(t, rows[t] || []); });
    },
    setWaiting: (w) => { if (live()) setWaiting(w); },
    get live() { return live(); }
  };
}
/** nobody owns the screen any more (sign-out) */
export function unbindStore(token: object) { if (owner === token) owner = null; }

/* ---------- direct doors (test seeding, and features that show a value ahead) ---------- */
/** newer server rows replace older ones; a row with deleted_at set leaves the screen */
export function upsertLocal(t: TableName, rows: Row[], opts: { force?: boolean } = {}): { put: Row[]; removed: string[] } {
  if (!rows.length) return { put: [], removed: [] };
  return batch(() => apply(t, rows, !!opts.force));
}
/** shows a value ahead (the stock count after a move…): it lasts until the server sends that row again */
export function patchLocal(t: TableName, id: string, patch: Record<string, unknown>): Row | undefined {
  if (!views[t].value.has(id) && !base[t].has(id)) return undefined;
  screen[t].set(id, { ...(screen[t].get(id) || {}), ...patch });
  refold(t, [id]);
  return views[t].value.get(id) ?? (fold(t, id) || ({ ...(base[t].get(id) || {}), ...patch, id } as Row));
}
export function removeLocal(t: TableName, ids: string[]) { batch(() => remove(t, ids)); }
export function replaceLocal(t: TableName, rows: Row[]) { batch(() => load(t, rows)); }
export function clearAll() { clear(); }
