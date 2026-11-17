/* The way back card reads the « Terminer » still waiting on this phone (today-agenda-r2-1): a mechanic back at the
   Centrale who finishes one more job before it reaches the server is offered « Je pars » again, not « Arrivé à … ». */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { OutboxEntry } from '../../data/local';

const box = vi.hoisted(() => ({ entries: [] as OutboxEntry[] }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<typeof import('../../data/sync')>()), outboxList: () => Promise.resolve(box.entries) }));

import { net } from '../../data/sync';
import { upsertLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import type { Access, Job } from '../../data/types';
import { pendingJobs } from '../../shared/jobs/pending';
import { ReturnCard } from './ReturnCard';

const DAY = '2026-11-15';
const JOB = (o: Partial<Job>) => ({ id: 'j', number: 1, status: 'done', day: DAY, block: 'pm', truck_id: 't1', customer_id: 'c1', pay_later: false, coffre_id: null, finished_at: null, ...o } as unknown as Job);
/** the trip back of today, arrived at 15:00 in Montréal (20:00 UTC: the same day under any clock of the machine) */
const BACK = { id: 'r1', staff_id: 'saleh', kind: 'return', status: 'arrived', ended_at: '2026-11-15T20:00:00Z', expires_at: '2026-11-15T21:00:00Z', deleted_at: null };
const finishOf = (job: string, at: string): OutboxEntry => ({ seq: 1, op: 'op1', kind: 'rpc', rpc: 'job_step', args: { p_job: job, p_action: 'finish' }, at, tries: 1, state: 'pending' });

async function outboxNow(entries: OutboxEntry[]) {
  box.entries = entries;
  pendingJobs();
  net.value = { ...net.value, pending: entries.length };
  await new Promise((r) => setTimeout(r, 0));
}

const el = document.createElement('div');
document.body.appendChild(el);
const list = [JOB({ id: 'a', number: 1, finished_at: '2026-11-15T19:00:00Z' }), JOB({ id: 'b', number: 2 })];

beforeEach(async () => {
  clearAll();
  access.value = { id: 'saleh', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1'] } as unknown as Access;
  upsertLocal('trips', [BACK]);
  await outboxNow([]);
});
afterEach(() => { act(() => render(null, el)); access.value = null; });

describe('the way back card and the « Terminer » waiting on the phone', () => {
  it('back at the Centrale, nothing waiting: « Arrivé à … », no « Je pars »', () => {
    act(() => render(<ReturnCard day={DAY} list={list} />, el));
    expect(el.querySelector('[data-testid="today-return-home"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="today-return-leave"]')).toBeNull();
  });
  it('a job finished after the arrival, still in the outbox: « Je pars » again', async () => {
    await outboxNow([finishOf('b', '2026-11-15T22:10:00.000Z')]);
    act(() => render(<ReturnCard day={DAY} list={list} />, el));
    expect(el.querySelector('[data-testid="today-return-leave"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="today-return-home"]')).toBeNull();
  });
  it('follows the outbox while shown: the step queued after the card is drawn brings « Je pars » back', async () => {
    act(() => render(<ReturnCard day={DAY} list={list} />, el));
    expect(el.querySelector('[data-testid="today-return-home"]')).not.toBeNull();
    await act(async () => { await outboxNow([finishOf('b', '2026-11-15T22:10:00.000Z')]); });
    expect(el.querySelector('[data-testid="today-return-leave"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="today-return-home"]')).toBeNull();
  });
});
