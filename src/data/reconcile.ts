/* « What do I still see? » — the rows whose presence changed without the row itself changing after our cursor:
   - a row deleted for good on the server (an inventory item), or that left my view (a job moved to another truck);
   - a row that entered my view (a job moved onto my truck with its old work lines, a right given, « Routes
     partagées » switched on) — before tonight they were never downloaded (core-data-03);
   - a row whose server version differs from mine (a restore, a commit that came late).
   The ids are listed in id order with keyset pages, so no page can skip or repeat a row (core-data-13), every synced
   table is covered (core-data-14), and a row is removed only when the listing was complete and the row was not
   received meanwhile (no clock involved). Missing or different rows are read by id. */
import type { Row } from './store';
import type { TableName } from './schema';
import { ask } from './client';
import { REQUEST_MS } from './send';
import { cmpTs } from './clock';
import type { TableIO } from './pull';

const SCAN_PAGE = 1000;
const BY_IDS = 100;

export interface ScanIO extends TableIO {
  baseIds(t: TableName): string[];
  baseStamp(t: TableName, id: string): string | null | undefined;
  /** ids received for `t` from now on, until `unwatch` */
  watch(t: TableName): Set<string>;
  unwatch(t: TableName, s: Set<string>): void;
  /** rows seen older on the server than here once: forced back the second time (a restore, not a race) */
  older: Set<string>;
}

/** reads rows by a column (`id`, or `job_id` for a job's lines), 100 values a request */
export async function fetchBy(io: TableIO, t: TableName, values: string[], column = 'id', force = false): Promise<void> {
  for (let i = 0; i < values.length; i += BY_IDS) {
    const chunk = values.slice(i, i + BY_IDS);
    const rows = (await ask<Row[] | null>((s) => io.client.from(t).select('*').in(column, chunk).retry(false).abortSignal(s), REQUEST_MS, io.signal)) || [];
    if (io.closed()) return;
    const { put, removed } = io.apply(t, rows, force);
    await io.save({ rows: [{ table: t, put, del: removed }] });
  }
}

export async function scanTable(io: ScanIO, t: TableName): Promise<void> {
  const seen = io.watch(t);
  try {
    const listed = new Map<string, string | null>();
    let after = '';
    for (;;) {
      const page = (await ask<{ id: string; updated_at: string | null }[] | null>((s) => {
        let q = io.client.from(t).select('id,updated_at').is('deleted_at', null).order('id', { ascending: true }).limit(SCAN_PAGE);
        if (after) q = q.gt('id', after);
        return q.retry(false).abortSignal(s);
      }, REQUEST_MS, io.signal)) || [];
      if (io.closed()) return;
      for (const r of page) listed.set(String(r.id), r.updated_at);
      if (page.length < SCAN_PAGE) break;
      // the greatest id, not the last one: a server that does not sort by id still moves on
      after = page.reduce((m, r) => (String(r.id) > m ? String(r.id) : m), after);
    }
    const gone: string[] = [], missing: string[] = [], back: string[] = [];
    for (const id of io.baseIds(t)) if (!listed.has(id) && !seen.has(id)) gone.push(id);
    for (const [id, at] of listed) {
      if (seen.has(id)) continue;
      const mine = io.baseStamp(t, id);
      if (mine === undefined) { missing.push(id); continue; }
      const c = cmpTs(at, mine);
      const key = `${t}:${id}`;
      if (c > 0) missing.push(id);
      else if (c < 0) { if (io.older.has(key)) { io.older.delete(key); back.push(id); } else io.older.add(key); }
    }
    if (gone.length) { io.remove(t, gone); await io.save({ rows: [{ table: t, put: [], del: gone }] }); }
    await fetchBy(io, t, missing);
    await fetchBy(io, t, back, 'id', true);
  } finally {
    io.unwatch(t, seen);
  }
}

/** of these jobs, the ones this person no longer sees (moved to another truck, put back « à placer »…) */
export async function jobsGone(io: TableIO, ids: string[]): Promise<string[]> {
  const visible = new Set<string>();
  for (let i = 0; i < ids.length; i += BY_IDS) {
    const chunk = ids.slice(i, i + BY_IDS);
    const rows = (await ask<{ id: string }[] | null>((s) => io.client.from('jobs').select('id').in('id', chunk).retry(false).abortSignal(s), REQUEST_MS, io.signal)) || [];
    if (io.closed()) return [];
    for (const r of rows) visible.add(String(r.id));
  }
  return ids.filter((id) => !visible.has(id));
}
