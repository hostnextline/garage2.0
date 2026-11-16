/* What this phone still has to send about money (the outbox: operations kept while there is no signal, or still on
   their way). Without it, a payment taken in a driveway with no signal is invisible: the invoice still says « À payer »
   and the same payment can be taken a second time. Everything that shows money owed reads it from here.
   - waitingEntries(): the operations not yet confirmed by the server (sent or not, retried or not), kept in a signal
     read once for the whole app each time the outbox changes; an older read that answers late is ignored.
   - The matchers are pure (tested in waiting.test.ts): they know the operations by their name and arguments.
   - The server's answer (the invoice paid, the payment row, by the answer itself or by realtime) reaches the phone a
     moment BEFORE the outbox lets the operation go (and, after a day without signal, a long catch-up later). In that
     moment a payment must not count twice (« Trop-perçu » after an ordinary « Encaisser », a payment listed twice):
     unsentPayments() leaves out a waiting payment once the phone holds its row (notOnServer). */
import { computed, effect, signal } from '@preact/signals';
import type { OutboxEntry } from '../../data/local';
import type { Payment } from '../../data/types';
import { net, outboxList, currentUid } from '../../data/sync';
import { rowsOf, tableSignal } from '../../data/store';

const entries = signal<OutboxEntry[]>([]);
/** for each waiting payment (by its op): the payment rows this phone already had when it first saw it. A row that came
    after it, and says the same thing, is the server's answer to it. */
const knownAtFirstSight = new Map<string, ReadonlyMap<string, unknown>>();
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
    // the rows held BEFORE the outbox is read (peek: a new payment row must not re-read the outbox, else the answer
    // would be taken for a row the phone already had while the operation is still listed)
    const known = tableSignal('payments').peek();
    outboxList().then(
      (all) => {
        if (mine !== reads) return;
        const pending = all.filter((e) => e.state === 'pending');
        const ops = new Set(pending.map((e) => e.op));
        for (const e of pending) if (rpc(e, 'payment_add') && !knownAtFirstSight.has(e.op)) knownAtFirstSight.set(e.op, known);
        for (const op of [...knownAtFirstSight.keys()]) if (!ops.has(op)) knownAtFirstSight.delete(op);
        entries.value = pending;
      },
      // the phone's storage could not be read: the frame already says so (storageBroken); keep the last list
      (e: unknown) => { console.warn('outbox', e); }
    );
  });
}
/** the operations still waiting on this phone, oldest first (reactive) */
export function waitingEntries(): OutboxEntry[] { start(); return entries.value; }

/** the payments taken on this phone for this invoice (or its job) that the server has not answered for yet
    (reactive: the outbox and the payment rows). What every screen that counts money shows as waiting. */
export function unsentPayments(o: { invoiceId?: string | null; jobId?: string | null }): WaitingPayment[] {
  const list = paymentsWaiting(waitingEntries(), o);
  if (!list.length) return list;
  return notOnServer(list, rowsOf<Payment>('payments'), { known: (op) => knownAtFirstSight.get(op), me: currentUid() });
}

/* ---------- pure: which waiting operation is about what ---------- */
const rpc = (e: OutboxEntry, name: string) => e.kind === 'rpc' && e.rpc === name && !!e.args;

export interface WaitingPayment {
  op: string; invoiceId: string | null; jobId: string | null; cents: number; method: string; tries: number;
  /** what the server will write: the reference (null when empty) and when it was taken on this phone */
  reference: string | null; at: string;
}
/** the payments taken on this phone for this invoice (or for its job, when taken without an invoice), not yet confirmed.
    A refund is a negative one. */
export function paymentsWaiting(list: OutboxEntry[], o: { invoiceId?: string | null; jobId?: string | null }): WaitingPayment[] {
  return list.filter((e) => {
    if (!rpc(e, 'payment_add')) return false;
    const inv = (e.args!.p_invoice as string | null) ?? null, job = (e.args!.p_job as string | null) ?? null;
    return (!!o.invoiceId && inv === o.invoiceId) || (!inv && !!o.jobId && job === o.jobId);
  }).map((e) => ({
    op: e.op, invoiceId: (e.args!.p_invoice as string | null) ?? null, jobId: (e.args!.p_job as string | null) ?? null,
    cents: Number(e.args!.p_amount_cents || 0), method: String(e.args!.p_method || ''), tries: e.tries,
    reference: e.args!.p_reference ? String(e.args!.p_reference) : null, at: e.at
  }));
}
export function waitingCents(list: WaitingPayment[]): number { return list.reduce((n, p) => n + p.cents, 0); }
/** the waiting payments apart from the waiting refunds: a payment waiting never makes money to give back, a refund
    waiting never makes money to collect */
export function waitingSplit(list: WaitingPayment[]): { in: number; out: number } {
  return list.reduce((s, p) => (p.cents > 0 ? { ...s, in: s.in + p.cents } : { ...s, out: s.out + p.cents }), { in: 0, out: 0 });
}

/** room for the phone's clock against the server's, when a payment row is compared with the moment it was taken */
export const CLOCK_ROOM_MS = 10 * 60000;
export type PaidRow = Pick<Payment, 'id' | 'invoice_id' | 'job_id' | 'amount_cents' | 'method' | 'reference'> & { created_at?: string | null; paid_at?: string | null; created_by?: string | null };
/** the waiting payments the server has not answered for yet. A payment row is the answer to a waiting payment when it
    is new for it (not on the phone when the phone first saw the payment waiting), says the same thing (the invoice,
    or the job when taken without one; amount, method, reference; the same person) and was made after it (with room
    for the clocks). Each row answers one payment, oldest first. */
export function notOnServer(list: WaitingPayment[], rows: Iterable<PaidRow>, o: { known: (op: string) => { has(id: string): boolean } | undefined; me?: string | null }): WaitingPayment[] {
  const used = new Set<string>();
  const all = [...rows];
  return list.filter((w) => {
    const known = o.known(w.op);
    const at = Date.parse(w.at);
    const answer = all.find((r) => {
      if (used.has(r.id) || known?.has(r.id)) return false;
      if (w.invoiceId ? r.invoice_id !== w.invoiceId : r.job_id !== w.jobId) return false;
      if (r.amount_cents !== w.cents || r.method !== w.method || (r.reference || null) !== w.reference) return false;
      if (o.me && r.created_by && r.created_by !== o.me) return false;
      const made = Date.parse(String(r.created_at || r.paid_at || ''));
      return !(Number.isFinite(made) && Number.isFinite(at) && made < at - CLOCK_ROOM_MS);
    });
    if (!answer) return true;
    used.add(answer.id);
    return false;
  });
}

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
