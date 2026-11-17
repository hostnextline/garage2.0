/* What the changes still waiting on this device show on screen, on top of the server's rows (pure, no IO).
   - a new row or a changed row: at once, like before;
   - a job step (« Je pars », « Je suis arrivé », the signature…): once the screen stopped waiting for the server's
     answer (the change is « kept » on the phone), so the red button never changes under a finger that taps twice.
     This is what the job section did by hand (keepAhead / seen); it now survives a restart without signal.
   - an inventory item deleted (« Supprimer cet article ») while it is kept on the phone: hidden at once, as the
     previous version did; refused, it comes back by itself (inventory-delete-visible).
   Operations whose effect the server computes (stock counts, prices of discounts) show nothing ahead here.
   A refused change shows nothing: the row is the server's again. */
import { isSynced, type TableName } from './schema';
import type { OutboxEntry } from './local';
import type { Fx, Waiting } from './store';

const STEP_STATUS: Record<string, string> = { leave: 'en_route', arrive: 'on_site', finish: 'done', cancel: 'cancelled', no_show: 'no_show' };

/** the effects of one waiting entry; `kept`: nobody waits for its answer any more */
function effectsOf(e: OutboxEntry, kept: boolean): { t: TableName; id: string; fx: Fx }[] {
  if (e.state !== 'pending') return [];
  if ((e.kind === 'insert' || e.kind === 'update') && isSynced(e.table) && e.id && e.values) {
    return [{ t: e.table, id: e.id, fx: e.kind === 'insert' ? { put: e.values } : { patch: e.values } }];
  }
  if (e.kind !== 'rpc' || !kept || !e.args) return [];
  const a = e.args;
  if (e.rpc === 'job_step' && typeof a.p_job === 'string') {
    const action = String(a.p_action || '');
    if (STEP_STATUS[action]) return [{ t: 'jobs', id: a.p_job, fx: { patch: { status: STEP_STATUS[action] } } }];
    if (action === 'waiver') return [{ t: 'jobs', id: a.p_job, fx: { patch: { waiver_signed_at: e.at } } }];
  }
  if (e.rpc === 'inventory_delete' && typeof a.p_item === 'string') return [{ t: 'inventory_items', id: a.p_item, fx: { patch: { deleted_at: e.at } } }];
  return [];
}

/** every waiting entry, in order, folded into per-row effects */
export function waitingOf(entries: { e: OutboxEntry; kept: boolean }[]): Waiting {
  const out: Waiting = {};
  for (const { e, kept } of entries) {
    for (const { t, id, fx } of effectsOf(e, kept)) {
      const m = (out[t] ||= new Map());
      const list = m.get(id);
      if (list) list.push(fx); else m.set(id, [fx]);
    }
  }
  return out;
}
