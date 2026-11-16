/* Sending one waiting change to the server, by kind. Throws a classified AppError (errors.ts); the engine decides
   what a failure means for the queue.
   - insert: « add if not there yet » (a repeat after a lost answer adds nothing). When the row was already there, the
     server's copy is the answer, except for what this device still has to say about it: an entry of the previous
     version that merged an edit after a lost answer, or a save of a row this device did not hold, sends the fields
     that differ as a change (core-data-04, core-data-49).
   - update: the fields changed; a settings part is merged with the server's part of now (merge3, core-data-19).
   - rpc: the operation with its op id (the server answers a repeat with what it did the first time). */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../lib/errors';
import { SYNCED, type TableName } from './schema';
import type { OutboxEntry } from './local';
import type { Row } from './store';
import { ask } from './client';
import { merge3, sameValue } from './merge';

export const REQUEST_MS = 15000;
export const RPC_MS = 40000;
export const isSynced = (t: string | undefined): t is TableName => !!t && (SYNCED as readonly string[]).includes(t);

/** a picture of hundreds of kB needs longer than a few fields on a weak uplink (and the request really stops after) */
export function limitFor(e: OutboxEntry): number {
  if (e.kind === 'rpc') return RPC_MS;
  const size = JSON.stringify(e.values || {}).length;
  return Math.min(120000, REQUEST_MS + Math.floor(size / 20000) * 1000);
}

/** the fields of `values` that the server's row does not have (its own stamps aside) */
export function differing(values: Record<string, unknown>, row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (k === 'id' || k === 'created_at' || k === 'updated_at' || k === 'created_by') continue;
    if (!sameValue(v, row[k])) out[k] = v;
  }
  return out;
}

export interface Sent { data: unknown; row?: Row }

async function updateById(client: SupabaseClient, t: string, id: string, values: Record<string, unknown>, ms: number, signal: AbortSignal): Promise<Row> {
  const rows = await ask<Row[] | null>((s) => client.from(t).update(values).eq('id', id).select('*').abortSignal(s), ms, signal);
  const row = rows?.[0];
  if (!row) throw new AppError('refusal', 'gone', 'Changement refusé : tu n’as pas (ou plus) accès à cette fiche', { code: '42501' });
  return row;
}

export async function sendEntry(client: SupabaseClient, e: OutboxEntry, signal: AbortSignal): Promise<Sent> {
  const ms = limitFor(e);
  if (e.kind === 'insert') {
    const t = e.table!, id = e.id!;
    const synced = isSynced(t);
    const cols = synced ? '*' : 'id';
    const rows = await ask<Row[] | null>((s) => client.from(t).upsert(e.values!, { onConflict: 'id', ignoreDuplicates: true }).select(cols).abortSignal(s), ms, signal);
    let row = rows?.[0];
    if (!row) {
      // it was already there: an answer got lost, or the row existed before
      row = (await ask<Row | null>((s) => client.from(t).select(cols).eq('id', id).abortSignal(s).maybeSingle(), REQUEST_MS, signal)) ?? undefined;
      if (!row) throw new AppError('refusal', 'rights', 'Ligne refusée par le serveur', { code: '42501' });
      if (synced) {
        const say = !e.v ? differing(e.values || {}, row) : e.patch ? differing(e.patch, row) : {};
        if (Object.keys(say).length) row = await updateById(client, t, id, say, ms, signal);
      }
    }
    return { data: row, row: synced ? row : undefined };
  }
  if (e.kind === 'update') {
    const t = e.table!, id = e.id!;
    let values = e.values || {};
    if (e.prev && Object.keys(e.prev).length) {
      const now = await ask<Row | null>((s) => client.from(t).select('*').eq('id', id).abortSignal(s).maybeSingle(), REQUEST_MS, signal);
      if (now) {
        values = { ...values };
        for (const part of Object.keys(e.prev)) if (part in values) values[part] = merge3(e.prev[part], values[part], now[part]);
      }
    }
    const row = await updateById(client, t, id, values, ms, signal);
    return { data: row, row };
  }
  const data = await ask<unknown>((s) => client.rpc(e.rpc!, e.args || {}).abortSignal(s), ms, signal);
  return { data };
}
