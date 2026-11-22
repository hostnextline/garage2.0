/* What this phone has done on a job that the server has not confirmed yet, read from the outbox itself (it is kept on
   the phone, so this survives the app being closed and reopened). Pure (tested in pending.test.ts).
   - The steps waiting (Je pars, Je suis arrivé, the signature, Terminer…) are played over the server's row, in order, each
     only when it is possible from the status reached so far: a step the server already applied (its row came back before
     the outbox forgot the entry) is not played twice, and a step another phone already did is not shown again.
     « Revenir en arrière » undoes only a step that is itself still waiting; one that undoes a step already on the server
     is shown by the screen's own memory (keepAhead in shared/jobs/select.ts).
   - A payment waiting counts against what is left to collect, so « Encaisser » is not offered a second time for it; once
     the invoice shows it (its row can come back before the outbox forgets the entry), it is not counted a second time.
   - A customer's answer waiting (accepted, refused) is shown as given. */
import type { Job, JobStatus, ItemStatus } from '../../data/types';
import type { OutboxEntry } from '../../data/local';

type Action = 'leave' | 'arrive' | 'finish' | 'cancel' | 'no_show' | 'reopen' | 'back' | 'waiver';
export interface PendingStep { action: Action; at: string }
/** a payment_add waiting: on an invoice, or on the job when sent without one */
export interface PendingPayment { op: string; invoice: string | null; job: string | null; cents: number }
export interface PendingView {
  /** job_step entries waiting, per job, oldest first */
  steps: Map<string, PendingStep[]>;
  /** payment_add entries waiting, oldest first */
  payments: PendingPayment[];
  /** extra_answer entries waiting: the line's id → accepted */
  answers: Map<string, boolean>;
  /** invoice_for_job entries waiting, by job id */
  invoicing: Set<string>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** sorts the waiting operations of the outbox (refused ones are not waiting: they are in the « refusé » banner) */
export function pendingOf(entries: readonly OutboxEntry[]): PendingView {
  const v: PendingView = { steps: new Map(), payments: [], answers: new Map(), invoicing: new Set() };
  for (const e of entries) {
    if (e.state !== 'pending' || e.kind !== 'rpc' || !e.args) continue;
    const a = e.args;
    if (e.rpc === 'job_step') {
      const job = str(a.p_job), action = str(a.p_action) as Action | null;
      if (!job || !action) continue;
      const list = v.steps.get(job) || [];
      list.push({ action, at: e.at });
      v.steps.set(job, list);
    } else if (e.rpc === 'payment_add') {
      const cents = Number(a.p_amount_cents);
      if (!Number.isFinite(cents) || cents <= 0) continue;
      const invoice = str(a.p_invoice), job = str(a.p_job);
      if (invoice || job) v.payments.push({ op: e.op, invoice, job, cents });
    } else if (e.rpc === 'extra_answer') {
      const item = str(a.p_item);
      if (item) v.answers.set(item, a.p_accept === true);
    } else if (e.rpc === 'invoice_for_job') {
      const job = str(a.p_job);
      if (job) v.invoicing.add(job);
    }
  }
  return v;
}

/** where each step leads, and from where it is possible (as the server's job_step) */
const NEXT: Record<Exclude<Action, 'back' | 'waiver'>, (s: JobStatus) => JobStatus | null> = {
  leave: (s) => (s === 'booked' ? 'en_route' : null),
  arrive: (s) => (s === 'en_route' ? 'on_site' : null),
  finish: (s) => (s === 'on_site' || s === 'en_route' ? 'done' : null),
  cancel: (s) => (s === 'booked' || s === 'en_route' ? 'cancelled' : null),
  no_show: (s) => (s === 'booked' || s === 'en_route' || s === 'on_site' ? 'no_show' : null),
  reopen: (s) => (s === 'cancelled' || s === 'no_show' ? 'booked' : null)
};

/** the job as it will be once its waiting steps reach the server */
export function withSteps<T extends Pick<Job, 'status' | 'waiver_signed_at'>>(job: T, steps: readonly PendingStep[] | undefined): T {
  if (!steps?.length) return job;
  let status = job.status;
  let waiver = job.waiver_signed_at;
  // the statuses left by the steps played here: « Revenir en arrière » goes back to the one before
  const before: JobStatus[] = [];
  for (const s of steps) {
    if (s.action === 'waiver') { waiver = waiver || s.at; continue; }
    if (s.action === 'back') { const prev = before.pop(); if (prev) status = prev; continue; }
    const to = NEXT[s.action]?.(status);
    if (!to) continue;
    before.push(status);
    status = to;
  }
  return status === job.status && waiver === job.waiver_signed_at ? job : { ...job, status, waiver_signed_at: waiver };
}

/** a line of work with its customer's answer still waiting on this phone */
export function withAnswer<T extends { id: string; status: ItemStatus }>(item: T, answers: ReadonlyMap<string, boolean>): T {
  const a = answers.get(item.id);
  if (a === undefined || item.status !== 'proposed') return item;
  return { ...item, status: a ? 'approved' : 'declined' };
}

/** the cents of payments waiting on this phone for this job (on its invoice, or on the job when sent without one) that
    its invoice does not show yet. The server answers with the invoice before the entry leaves the outbox, and another
    phone's copy can bring it even sooner: what the invoice's paid_cents grew since the first of them was waiting
    (`baseOf`: paid_cents when that payment was first seen waiting) is theirs. Without an invoice, all of them. */
export function paidWaiting(v: PendingView, jobId: string, inv: { id: string; paid_cents: number } | null | undefined, baseOf?: (p: PendingPayment) => number): number {
  const mine = v.payments.filter((p) => (inv && p.invoice === inv.id) || (!p.invoice && p.job === jobId));
  const sum = mine.reduce((n, p) => n + p.cents, 0);
  if (!sum || !inv || !baseOf) return sum;
  const grown = Math.max(0, inv.paid_cents - Math.min(...mine.map(baseOf)));
  return Math.max(0, sum - grown);
}
