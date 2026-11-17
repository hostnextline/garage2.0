/* What « Aujourd'hui » reads from the phone's copy (jobs-b-21): my stops of a day and the route I do, the next day with
   work, my shifts, what each truck is doing, tomorrow's confirmations, the proposals waiting, today's payments.
   Real store rows; every time is given with Montréal's offset, so the machine's zone never matters. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import type { Access } from '../../data/types';
import { setMyRoute } from './prefs';
import { myJobsOn, currentRoute, nextWorkDay, shiftsOf, truckNow, trucksNow, unplacedOn, toConfirm, proposalsWaiting, paymentsOn, openBeforeFor } from './select';

const TODAY = '2026-11-17';
const saleh = { id: 'saleh', owner: false, roles: ['mechanic'], rights: {}, trucks: ['t1', 't2'] } as unknown as Access;
const job = (o: Record<string, unknown>) => ({ number: 1, customer_id: null, block: 'am', status: 'booked', stop_order: 1, duration_min: 60, deleted_at: null, ...o });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T09:00:00-05:00'));
  replaceLocal('trucks', [
    { id: 't1', name: 'Camion', active: true, sort: 1, driver_id: 'saleh', color: null },
    { id: 't2', name: 'Voiture', active: true, sort: 2, driver_id: null, color: null },
    { id: 't3', name: 'Vieux', active: false, sort: 3, driver_id: null, color: null }
  ] as never);
  access.value = saleh;
});
afterEach(() => { vi.useRealTimers(); setMyRoute(null); clearAll(); access.value = null; });

describe('my stops (jobs-b-21)', () => {
  it('are my trucks’ jobs of the day; « La route que je fais » keeps one route while it is still mine and in service', () => {
    replaceLocal('jobs', [
      job({ id: 'a', truck_id: 't1', day: TODAY }), job({ id: 'b', truck_id: 't2', day: TODAY, number: 2 }),
      job({ id: 'c', truck_id: 't3', day: TODAY, number: 3 }), job({ id: 'd', truck_id: null, day: TODAY, number: 4 })
    ] as never);
    expect(myJobsOn(TODAY).map((j) => j.id).sort()).toEqual(['a', 'b']);
    setMyRoute('t2');
    expect(currentRoute()).toBe('t2');
    expect(myJobsOn(TODAY).map((j) => j.id)).toEqual(['b']);
    // a route that is not mine any more (or switched off) counts for nothing: all of mine again
    setMyRoute('t3');
    expect(currentRoute()).toBeNull();
    expect(myJobsOn(TODAY).map((j) => j.id).sort()).toEqual(['a', 'b']);
  });
  it('the next day with work skips cancelled days, and gives up after two weeks', () => {
    replaceLocal('jobs', [
      job({ id: 'x', truck_id: 't1', day: '2026-11-18', status: 'cancelled' }),
      job({ id: 'y', truck_id: 't1', day: '2026-11-20', number: 2 }),
      job({ id: 'z', truck_id: 't1', day: '2026-12-10', number: 3 })
    ] as never);
    expect(nextWorkDay(TODAY)).toMatchObject({ day: '2026-11-20', first: { id: 'y' } });
    expect(nextWorkDay('2026-11-20')).toBeNull();
  });
  it('the jobs left open on a past day: my trucks’ ones (whatever route is chosen), or everyone’s', () => {
    replaceLocal('jobs', [
      job({ id: 'old1', truck_id: 't1', day: '2026-11-14', status: 'on_site' }),
      job({ id: 'old2', truck_id: 'other', day: '2026-11-15', status: 'booked', number: 2 }),
      job({ id: 'old3', truck_id: 't2', day: '2026-11-15', status: 'done', number: 3 })
    ] as never);
    setMyRoute('t2');
    expect(openBeforeFor(TODAY, true).map((j) => j.id)).toEqual(['old1']);
    expect(openBeforeFor(TODAY, false).map((j) => j.id)).toEqual(['old1', 'old2']);
  });
});

describe('shifts and payments of the day are read on Montréal’s day', () => {
  it('a shift started late last evening and ended is yesterday’s; one still open since yesterday stays', () => {
    replaceLocal('shifts', [
      { id: 's1', staff_id: 'saleh', started_at: '2026-11-16T23:30:00-05:00', ended_at: '2026-11-17T00:10:00-05:00', deleted_at: null },
      { id: 's2', staff_id: 'saleh', started_at: '2026-11-16T22:00:00-05:00', ended_at: null, deleted_at: null },
      { id: 's3', staff_id: 'saleh', started_at: '2026-11-17T07:55:00-05:00', ended_at: '2026-11-17T08:40:00-05:00', deleted_at: null },
      { id: 's4', staff_id: 'other', started_at: '2026-11-17T08:00:00-05:00', ended_at: null, deleted_at: null }
    ] as never);
    expect(shiftsOf('saleh', TODAY).map((s) => s.id)).toEqual(['s2', 's3']);
  });
  it('a payment at 20 h in Montréal (01 h the next day in UTC) is today’s, newest first, with whose it is', () => {
    replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Tremblay', company: null, deleted_at: null }] as never);
    replaceLocal('jobs', [job({ id: 'a', truck_id: 't1', day: TODAY, customer_id: 'c1' })] as never);
    replaceLocal('invoices', [{ id: 'i1', job_id: 'a', customer_id: 'c1', status: 'paid', total_cents: 5000, paid_cents: 5000, number: 1, deleted_at: null }] as never);
    replaceLocal('payments', [
      { id: 'p1', invoice_id: 'i1', job_id: null, amount_cents: 2000, method: 'cash', paid_at: '2026-11-17T08:30:00-05:00', deleted_at: null },
      { id: 'p2', invoice_id: 'i1', job_id: null, amount_cents: 3000, method: 'card', paid_at: '2026-11-17T20:00:00-05:00', deleted_at: null },
      { id: 'p3', invoice_id: 'i1', job_id: null, amount_cents: 1000, method: 'cash', paid_at: '2026-11-16T23:59:00-05:00', deleted_at: null }
    ] as never);
    const list = paymentsOn(TODAY);
    expect(list.map((x) => x.payment.id)).toEqual(['p2', 'p1']);
    expect(list[0]).toMatchObject({ jobId: 'a' });
    expect(list[0].name).toContain('Julie');
  });
});

describe('the team’s day', () => {
  it('each truck’s state: on the way, waiting between stops, not started, finished, nothing', () => {
    replaceLocal('shifts', [{ id: 's', staff_id: 'saleh', started_at: '2026-11-17T07:55:00-05:00', ended_at: null, deleted_at: null }] as never);
    replaceLocal('jobs', [
      job({ id: 'a', truck_id: 't1', day: TODAY, status: 'done' }), job({ id: 'b', truck_id: 't1', day: TODAY, status: 'booked', number: 2, stop_order: 2 }),
      job({ id: 'c', truck_id: 't2', day: TODAY, status: 'done', number: 3 }), job({ id: 'd', truck_id: null, day: TODAY, number: 4 }),
      job({ id: 'e', truck_id: 't2', day: TODAY, status: 'cancelled', number: 5 })
    ] as never);
    const [t1, t2] = trucksNow(TODAY);
    expect(t1).toMatchObject({ state: 'waiting', done: 1, total: 2, shiftOpen: true, next: { id: 'b' } });
    expect(t2).toMatchObject({ state: 'finished', done: 1, total: 1 });
    expect(trucksNow(TODAY).length).toBe(2);
    expect(unplacedOn(TODAY).map((j) => j.id)).toEqual(['d']);
    replaceLocal('jobs', [job({ id: 'b', truck_id: 't1', day: TODAY, status: 'en_route' })] as never);
    expect(truckNow(trucksNow(TODAY)[0].truck, TODAY)).toMatchObject({ state: 'en_route', current: { id: 'b' } });
    replaceLocal('shifts', []);
    replaceLocal('jobs', [job({ id: 'b', truck_id: 't1', day: TODAY })] as never);
    expect(trucksNow(TODAY)[0].state).toBe('not_started');
    expect(trucksNow(TODAY)[1].state).toBe('empty');
  });
  it('tomorrow’s appointments without their confirmation text; the proposals waiting on open jobs only', () => {
    replaceLocal('jobs', [
      job({ id: 'a', truck_id: 't1', day: '2026-11-18', confirm_sent_at: null }),
      job({ id: 'b', truck_id: 't1', day: '2026-11-18', confirm_sent_at: '2026-11-16T10:00:00-05:00', number: 2 }),
      job({ id: 'c', truck_id: 't1', day: '2026-11-18', status: 'cancelled', confirm_sent_at: null, number: 3 }),
      job({ id: 'd', truck_id: 't1', day: TODAY, status: 'on_site', number: 4 }),
      job({ id: 'e', truck_id: 't1', day: TODAY, status: 'done', number: 5 })
    ] as never);
    expect(toConfirm().map((j) => j.id)).toEqual(['a']);
    replaceLocal('job_items', [
      { id: 'i1', job_id: 'd', status: 'proposed', deleted_at: null },
      { id: 'i2', job_id: 'e', status: 'proposed', deleted_at: null },
      { id: 'i3', job_id: 'd', status: 'approved', deleted_at: null }
    ] as never);
    expect(proposalsWaiting().map((x) => x.item.id)).toEqual(['i1']);
  });
});
