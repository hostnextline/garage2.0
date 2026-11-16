/* The operations of the job section still waiting on this phone, read from the outbox (IndexedDB) and kept in a signal
   so the screens follow them: the red button, the tickets, the work lines. Read again whenever the outbox may have
   changed (something queued, sent or refused; the rows of an answer arriving). The rules are in domain/jobs/pending.ts. */
import { signal, computed, effect } from '@preact/signals';
import { net, outboxList, onRemoteChange } from '../../data/sync';
import type { OutboxEntry } from '../../data/local';
import type { TableName } from '../../data/schema';
import { pendingOf, type PendingView } from '../../domain/jobs/pending';

const entries = signal<readonly OutboxEntry[]>([]);
const view = computed<PendingView>(() => pendingOf(entries.value));
/** what waits on this phone, sorted for the job screens (a screen that reads it redraws when it changes) */
export function pendingJobs(): PendingView { watch(); return view.value; }

let started = false;
let asked = 0;
const same = (a: readonly OutboxEntry[], b: readonly OutboxEntry[]) => a.length === b.length && a.every((e, i) => e.op === b[i].op && e.state === b[i].state);
function refresh() {
  const n = ++asked;
  outboxList().then((all) => {
    // an older reading that comes back after a newer one is not shown
    if (n !== asked) return;
    const list = all.filter((e) => e.state === 'pending');
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
