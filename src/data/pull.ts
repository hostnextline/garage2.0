/* Bringing what changed on the server since the last time, one table at a time.
   - Pages are walked by (updated_at, id): after a full page the rest of its last instant is read by id, then what
     comes after it. 3 500 rows written in the same instant (a backfill, a big re-plan) no longer make the phone ask
     the same 1 000 rows for ever (core-data-12). A page shorter than asked is the end (the server gives up to 1 000
     rows per request on Supabase, 2 000 on the test copy: PAGE never asks more).
   - Each pull starts 15 s before the previous pull began (server time): a row stamped before our cursor but committed
     after we read (a long operation) is still received; an idle table costs one request.
   - The rows of a page and the cursor that says « received » are kept in ONE transaction (core-data-22).
   - A read that fails is not tried again inside supabase-js (it would wait up to 7 s per table without signal): the
     engine pulls again at its next cycle, when the signal comes back or the app returns to the screen. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Commit } from './local';
import type { Row } from './store';
import type { TableName } from './schema';
import { ask } from './client';
import { REQUEST_MS } from './send';
import { cmpTs, tsMicros, serverNow } from './clock';

export const PAGE = 1000;
export const LAG_MS = 15000;
/** the rewind for a cursor written by the previous version (its overlap was 2 s) */
export const LEGACY_LAG_MS = 17000;

export interface Cursor { at: string; id: string }

/** what the pull and the visibility check need from the engine */
export interface TableIO {
  client: SupabaseClient;
  signal: AbortSignal;
  closed(): boolean;
  meta: Record<string, unknown>;
  /** rows received from the server: into the store (not-older rule), returns what changed */
  apply(t: TableName, rows: Row[], force?: boolean): { put: Row[]; removed: string[] };
  remove(t: TableName, ids: string[]): void;
  /** into IndexedDB; never throws (a failure is the engine's to note) */
  save(c: Commit): Promise<void>;
}

const iso = (ms: number) => new Date(ms).toISOString();
const later = (a: Cursor | null, b: Cursor): Cursor => (!a || cmpTs(b.at, a.at) > 0 || (cmpTs(b.at, a.at) === 0 && b.id > a.id) ? b : a);

/** where this pull starts: '' = everything (a first download) */
export function startOf(meta: Record<string, unknown>, t: string): string {
  const c2 = meta[`cur2:${t}`] as Cursor | undefined;
  const legacy = meta[`cursor:${t}`] as string | undefined;
  const lastStart = meta[`pullAt:${t}`] as number | undefined;
  if (c2?.at) {
    const at = tsMicros(c2.at) / 1000;
    if (Number.isNaN(at)) return '';
    const back = typeof lastStart === 'number' ? Math.min(at, lastStart - LAG_MS) : at - LAG_MS;
    return iso(back);
  }
  if (legacy) {
    const at = tsMicros(legacy) / 1000;
    return Number.isNaN(at) ? '' : iso(at - LEGACY_LAG_MS);
  }
  return '';
}

export async function pullTable(io: TableIO, t: TableName, page = PAGE): Promise<void> {
  const startedAt = serverNow();
  let best: Cursor | null = (io.meta[`cur2:${t}`] as Cursor | undefined) ?? (io.meta[`cursor:${t}`] ? { at: String(io.meta[`cursor:${t}`]), id: '' } : null);
  const keep = async (rows: Row[]) => {
    if (!rows.length) return;
    const last = rows[rows.length - 1];
    if (last.updated_at) best = later(best, { at: String(last.updated_at), id: String(last.id) });
    const { put, removed } = io.apply(t, rows);
    const meta: Record<string, unknown> = best ? { [`cur2:${t}`]: best, [`cursor:${t}`]: best.at } : {};
    Object.assign(io.meta, meta);
    await io.save({ rows: [{ table: t, put, del: removed }], meta });
  };
  let from = startOf(io.meta, t);
  for (;;) {
    const rows = (await ask<Row[] | null>((s) => {
      let q = io.client.from(t).select('*').order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(page);
      if (from) q = q.gt('updated_at', from);
      return q.retry(false).abortSignal(s);
    }, REQUEST_MS, io.signal)) || [];
    if (io.closed()) return;
    await keep(rows);
    if (rows.length < page) break;
    // a full page: the rows of its last instant that did not fit are read by id
    let last = rows[rows.length - 1];
    for (;;) {
      const at = String(last.updated_at), after = String(last.id);
      const more = (await ask<Row[] | null>((s) => io.client.from(t).select('*').eq('updated_at', at).gt('id', after).order('id', { ascending: true }).limit(page).retry(false).abortSignal(s), REQUEST_MS, io.signal)) || [];
      if (io.closed()) return;
      await keep(more);
      if (more.length < page) break;
      last = more[more.length - 1];
    }
    from = String(last.updated_at);
  }
  io.meta[`pullAt:${t}`] = startedAt;
  await io.save({ meta: { [`pullAt:${t}`]: startedAt } });
}
