/* The operations of the job section still waiting on this phone, read from the outbox (IndexedDB) and kept in a signal
   so the screens follow them: the red button, the tickets, the work lines. Read again whenever the outbox may have
   changed (something queued, sent or refused; the rows of an answer arriving). The rules are in domain/jobs/pending.ts. */
import { signal, computed, effect } from '@preact/signals';
import { net, outboxList, onRemoteChange } from '../../data/sync';
import type { OutboxEntry } from '../../data/local';
import type { TableName } from '../../data/schema';
import type { Invoice } from '../../data/types';
import { getRow } from '../../data/store';
import { invoiceOf } from '../../data/select';
import { pendingOf, type PendingView, type PendingPayment } from '../../domain/jobs/pending';

const entries = signal<readonly OutboxEntry[]>([]);
const view = computed<PendingView>(() => pendingOf(entries.value));
/** what waits on this phone, sorted for the job screens (a screen that reads it redraws when it changes) */
export function pendingJobs(): PendingView { watch(); return view.value; }

/* what the invoice had received when each waiting payment was first seen (by payment and invoice): what it receives
   since is that payment reaching the server, not a second payment to count (domain/jobs/pending.ts paidWaiting) */
const bases = new Map<string, number>();
type Paid = Pick<Invoice, 'id' | 'paid_cents'>;
export function paymentBase(p: PendingPayment, inv: Paid): number {
  const k = `${p.op}|${inv.id}`;
  let b = bases.get(k);
  if (b === undefined) { b = inv.paid_cents; bases.set(k, b); }
  return b;
}
/** taken as soon as the payment is read from the outbox (before its answer can land); forgotten once it left */
function keepBases(list: readonly OutboxEntry[]) {
  const pays = pendingOf(list).payments;
  for (const p of pays) {
    const inv = p.invoice ? getRow<Invoice>('invoices', p.invoice) : p.job ? invoiceOf(p.job) : undefined;
    if (inv && inv.status !== 'void' && !inv.deleted_at) paymentBase(p, inv);
  }
  const ops = new Set(pays.map((p) => p.op));
  for (const k of [...bases.keys()]) if (!ops.has(k.slice(0, k.indexOf('|')))) bases.delete(k);
}

let started = false;
let asked = 0;
const same = (a: readonly OutboxEntry[], b: readonly OutboxEntry[]) => a.length === b.length && a.every((e, i) => e.op === b[i].op && e.state === b[i].state);
function refresh() {
  const n = ++asked;
  outboxList().then((all) => {
    // an older reading that comes back after a newer one is not shown
    if (n !== asked) return;
    const list = all.filter((e) => e.state === 'pending');
    keepBases(list);
    if (!same(list, entries.value)) entries.value = list;
  }, () => undefined);
}
const ANSWERED: TableName[] = ['jobs', 'job_items', 'invoices', 'payments'];
/** starts following the outbox the first time a screen asks (once for the app's life, like the sync it reads) */
function watch() {
  if (started) return;
  started = true;
  let last = '';
  effect(() => {
    const { pending, sending, failed } = net.value;
    const key = `${pending}|${sending}|${failed.length}`;
    if (key === last) return;
    last = key;
    refresh();
  });
  // the server's answer lands just before its entry leaves the outbox: read again right after it
  onRemoteChange((t) => { if (ANSWERED.includes(t)) setTimeout(refresh, 40); });
}
