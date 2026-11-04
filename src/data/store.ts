/* In-memory tables shown on screen: one signal per table (a Map by id). Screens read them through selectors;
   every change (from this phone, the server or realtime) goes through upsert/remove so the screen updates once. */
import { signal, batch, type Signal } from '@preact/signals';
import { SYNCED, type TableName } from './schema';

export type Row = { id: string; updated_at?: string | null; deleted_at?: string | null; [k: string]: unknown };

const maps = {} as Record<TableName, Signal<Map<string, Row>>>;
for (const t of SYNCED) maps[t] = signal(new Map());

export function tableSignal<T extends Row = Row>(t: TableName): Signal<Map<string, T>> {
  return maps[t] as unknown as Signal<Map<string, T>>;
}
export function rowsOf<T extends Row = Row>(t: TableName): T[] {
  return Array.from(tableSignal<T>(t).value.values());
}
export function getRow<T extends Row = Row>(t: TableName, id: string | null | undefined): T | undefined {
  return id ? tableSignal<T>(t).value.get(id) : undefined;
}

/** newer server rows replace older ones; a row with deleted_at set leaves the screen */
export function upsertLocal(t: TableName, rows: Row[], opts: { force?: boolean } = {}): { put: Row[]; removed: string[] } {
  const put: Row[] = [], removed: string[] = [];
  if (!rows.length) return { put, removed };
  const s = maps[t];
  const next = new Map(s.value);
  for (const r of rows) {
    if (!r || !r.id) continue;
    if (r.deleted_at) { next.delete(r.id); removed.push(r.id); continue; }
    const cur = next.get(r.id);
    if (!opts.force && cur && cur.updated_at && r.updated_at && Date.parse(String(r.updated_at)) < Date.parse(String(cur.updated_at))) continue;
    next.set(r.id, r);
    put.push(r);
  }
  s.value = next;
  return { put, removed };
}
/** apply a local change at once (the outbox sends it); keeps fields not mentioned */
export function patchLocal(t: TableName, id: string, patch: Record<string, unknown>): Row | undefined {
  const s = maps[t];
  const cur = s.value.get(id);
  if (!cur) return undefined;
  const row = { ...cur, ...patch, id } as Row;
  const next = new Map(s.value);
  if (row.deleted_at) next.delete(id); else next.set(id, row);
  s.value = next;
  return row;
}
export function removeLocal(t: TableName, ids: string[]) {
  if (!ids.length) return;
  const s = maps[t];
  const next = new Map(s.value);
  for (const id of ids) next.delete(id);
  s.value = next;
}
export function replaceLocal(t: TableName, rows: Row[]) {
  maps[t].value = new Map(rows.filter((r) => r && r.id && !r.deleted_at).map((r) => [r.id, r]));
}
export function clearAll() {
  batch(() => { for (const t of SYNCED) maps[t].value = new Map(); });
}
