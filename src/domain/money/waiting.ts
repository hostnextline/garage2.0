/* What this phone still has to send about money (the outbox: operations kept while there is no signal, or still on
   their way). Without it, a payment taken in a driveway with no signal is invisible: the invoice still says « À payer »
   and the same payment can be taken a second time. Everything that shows money owed reads it from here.
   - waitingEntries(): the operations not yet confirmed by the server (sent or not, retried or not), kept in a signal
     read once for the whole app each time the outbox changes; an older read that answers late is ignored.
   - The matchers are pure (tested in waiting.test.ts): they know the operations by their name and arguments. */
import { computed, effect, signal } from '@preact/signals';
import type { OutboxEntry } from '../../data/local';
import { net, outboxList } from '../../data/sync';

const entries = signal<OutboxEntry[]>([]);
let started = false;
let reads = 0;
// the outbox changes only when one of these does: no read of the phone's storage for anything else
const outboxKey = computed(() => { const n = net.value; return `${n.pending}|${n.failed.length}|${n.online}|${n.sending}`; });
function start() {
  if (started) return;
  started = true;
  effect(() => {
    void outboxKey.value;
    const mine = ++reads;
    outboxList().then(
      (all) => { if (mine === reads) entries.value = all.filter((e) => e.state === 'pending'); },
      // the phone's storage could not be read: the frame already says so (storageBroken); keep the last list
      (e: unknown) => { console.warn('outbox', e); }
    );
  });
}
/** the operations still waiting on this phone, oldest first (reactive) */
export function waitingEntries(): OutboxEntry[] { start(); return entries.value; }

/* ---------- pure: which waiting operation is about what ---------- */
const rpc = (e: OutboxEntry, name: string) => e.kind === 'rpc' && e.rpc === name && !!e.args;

export interface WaitingPayment { op: string; invoiceId: string | null; jobId: string | null; cents: number; method: string; tries: number }
/** the payments taken on this phone for this invoice (or for its job, when taken without an invoice), not yet confirmed.
    A refund is a negative one. */
export function paymentsWaiting(list: OutboxEntry[], o: { invoiceId?: string | null; jobId?: string | null }): WaitingPayment[] {
  return list.filter((e) => {
    if (!rpc(e, 'payment_add')) return false;
    const inv = (e.args!.p_invoice as string | null) ?? null, job = (e.args!.p_job as string | null) ?? null;
    return (!!o.invoiceId && inv === o.invoiceId) || (!inv && !!o.jobId && job === o.jobId);
  }).map((e) => ({
    op: e.op, invoiceId: (e.args!.p_invoice as string | null) ?? null, jobId: (e.args!.p_job as string | null) ?? null,
    cents: Number(e.args!.p_amount_cents || 0), method: String(e.args!.p_method || ''), tries: e.tries
  }));
}
export function waitingCents(list: WaitingPayment[]): number { return list.reduce((n, p) => n + p.cents, 0); }

/** « Terminer la facture » tapped on this phone and not yet answered */
export function finishEntries(list: OutboxEntry[], invoiceId: string): OutboxEntry[] {
  return list.filter((e) => rpc(e, 'invoice_finish') && e.args!.p_invoice === invoiceId);
}
export function finishWaiting(list: OutboxEntry[], invoiceId: string): boolean { return finishEntries(list, invoiceId).length > 0; }
/** « Faire la facture » (invoice_for_job) not yet answered */
export function makeWaiting(list: OutboxEntry[], jobId: string): OutboxEntry[] {
  return list.filter((e) => rpc(e, 'invoice_for_job') && e.args!.p_job === jobId);
}
/** « Payé par le Coffre » for this job, not yet answered */
export function coffreWaiting(list: OutboxEntry[], jobId: string): boolean {
  return list.some((e) => rpc(e, 'coffre_add') && Array.isArray(e.args!.p_jobs) && (e.args!.p_jobs as unknown[]).includes(jobId));
}
/** a change of this row typed on this phone and not yet confirmed by the server (an autosave on its way) */
export function rowWaiting(list: OutboxEntry[], table: string, id: string): boolean {
  return list.some((e) => (e.kind === 'update' || e.kind === 'insert') && e.table === table && e.id === id);
}
/** what to tell the person: online, an operation that was never retried is simply on its way (a moment), so the
    « pas de réseau » words are kept for the ones really waiting for the network. Money counts them all. */
export function waitingForNetwork<T extends { tries: number }>(list: T[], online: boolean): T[] {
  return online ? list.filter((e) => e.tries > 0) : list;
}
