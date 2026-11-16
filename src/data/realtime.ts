/* Live changes from the server (one channel, every synced table). An event is a hint, not the truth:
   - a new or changed row is applied when it carries every column this device holds for it; an update that left out
     a large column it did not change (the texts of the settings, the waiver) is read again by id instead, so those
     columns never vanish from the phones (x-contract-04);
   - a row deleted for good leaves at once (it used to stay on every other phone: core-data-14);
   - every (re)connection is followed by a pull, since the channel does not replay what it missed. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Row } from './store';
import type { TableName } from './schema';

export type Change = { t: TableName; type: string; row: Row | null; oldId: string | null };

export function subscribeChanges(client: SupabaseClient, uid: string, tables: readonly TableName[], on: (c: Change) => void, status: (live: boolean) => void): () => void {
  let ch = client.channel(`db-${uid.slice(0, 8)}`);
  for (const t of tables) {
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, (p) => {
      const row = (p.new && Object.keys(p.new).length ? p.new : null) as Row | null;
      const old = p.old as { id?: unknown } | null;
      on({ t, type: String(p.eventType), row, oldId: old?.id != null ? String(old.id) : null });
    });
  }
  ch.subscribe((s) => status(s === 'SUBSCRIBED'));
  return () => { void client.removeChannel(ch); };
}

/** what to do with one event, given the row this device holds */
export function readChange(c: Change, held: Row | undefined): { apply?: Row; remove?: string; refetch?: string } {
  if (c.type === 'DELETE') return c.oldId ? { remove: c.oldId } : {};
  if (!c.row || c.row.id == null) return {};
  if (held && Object.keys(held).some((k) => !(k in c.row!))) return { refetch: String(c.row.id) };
  return { apply: c.row };
}
