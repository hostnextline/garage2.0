import { describe, it, expect } from 'vitest';
import type { Job, Invoice, Trip } from '../../data/types';
import { nextStopOf, summaryOf, workedMinutes, routeInUse, openBefore, returnState, collectList, invoicesByJob, lastFinished } from './rules';

const job = (o: Partial<Job>): Job => ({ id: 'j', number: 1, day: '2026-11-14', block: 'am', status: 'booked', truck_id: 't1', duration_min: 60, travel_min: 10, pay_later: false, coffre_id: null, ...o } as Job);
const inv = (o: Partial<Invoice>): Invoice => ({ id: 'i', job_id: 'j', status: 'issued', total_cents: 10000, paid_cents: 0, number: 1, deleted_at: null, ...o } as Invoice);

describe('« Ma journée »: the stop to look at and the day in numbers', () => {
  it('looks at the stop on site, then on the way, then the first booked', () => {
    expect(nextStopOf([job({ id: 'a' }), job({ id: 'b', status: 'en_route' }), job({ id: 'c', status: 'on_site' })])?.id).toBe('c');
    expect(nextStopOf([job({ id: 'a', status: 'done' }), job({ id: 'b' })])?.id).toBe('b');
    expect(nextStopOf([job({ status: 'done' })])).toBeUndefined();
  });
  it('counts the stops, the driving and the work, never a cancelled one', () => {
    expect(summaryOf([job({}), job({ status: 'cancelled' }), job({ travel_min: null, duration_min: 30 })])).toEqual({ stops: 2, drive: 10, work: 90 });
  });
  it('counts the minutes worked, the open shift until now', () => {
    const now = Date.parse('2026-11-14T15:00:00Z');
    expect(workedMinutes([{ started_at: '2026-11-14T08:00:00Z', ended_at: '2026-11-14T12:00:00Z' }, { started_at: '2026-11-14T13:00:00Z', ended_at: null }], now)).toBe(360);
  });
});

describe('« La route que je fais » (jobs-b-11)', () => {
  const mine = ['car', 'truck'];
  it('keeps the route remembered while it is mine and in service', () => {
    expect(routeInUse('car', mine, new Set(['car', 'truck']))).toBe('car');
  });
  it('ignores a route on a vehicle switched off (the day would be empty with nothing to change it)', () => {
    expect(routeInUse('car', mine, new Set(['truck']))).toBe(null);
  });
  it('ignores a route that is no longer mine, or when only one route is left', () => {
    expect(routeInUse('other', mine, new Set(['car', 'truck', 'other']))).toBe(null);
    expect(routeInUse('truck', ['truck'], new Set(['truck']))).toBe(null);
    expect(routeInUse(null, mine, new Set(mine))).toBe(null);
  });
});

describe('« Pas terminé »: the jobs of a past day still open (jobs-b-03, x-time-05)', () => {
  const today = '2026-11-15';
  const jobs = [
    job({ id: 'site', day: '2026-11-14', status: 'on_site', number: 5 }),
    job({ id: 'route', day: '2026-11-14', status: 'en_route', number: 4 }),
    job({ id: 'booked', day: '2026-11-13', status: 'booked', number: 9 }),
    job({ id: 'other', day: '2026-11-14', status: 'booked', truck_id: 't2', number: 1 }),
    job({ id: 'done', day: '2026-11-14', status: 'done' }),
    job({ id: 'cancelled', day: '2026-11-14', status: 'cancelled' }),
    job({ id: 'deleted', day: '2026-11-14', status: 'booked', deleted_at: '2026-11-14T10:00:00Z' }),
    job({ id: 'today', day: today, status: 'booked' })
  ];
  it('gives the mechanic his trucks’ open jobs of past days, oldest first', () => {
    expect(openBefore(jobs, today, ['t1']).map((j) => j.id)).toEqual(['booked', 'route', 'site']);
  });
  it('gives the owner and the office every open one, never done, cancelled, deleted or today’s', () => {
    expect(openBefore(jobs, today, null).map((j) => j.id)).toEqual(['booked', 'other', 'route', 'site']);
  });
});

describe('the way back to the start (jobs-b-08)', () => {
  const dayOf = (iso: string) => iso.slice(0, 10);
  const now = Date.parse('2026-11-15T22:00:00Z');
  const trip = (o: Partial<Trip>): Trip => ({ id: 'r', staff_id: 'me', kind: 'return', status: 'active', started_at: '2026-11-15T21:00:00Z', ended_at: null, expires_at: '2026-11-16T03:00:00Z', ...o } as Trip);
  it('is on the way while the trip back is active', () => {
    expect(returnState([trip({})], 'me', '2026-11-15', dayOf, null, now).kind).toBe('active');
  });
  it('is arrived once the trip back of today ended: no second « Je pars » (which would text the garage again)', () => {
    expect(returnState([trip({ status: 'arrived', ended_at: '2026-11-15T21:40:00Z' })], 'me', '2026-11-15', dayOf, '2026-11-15T20:30:00Z', now))
      .toEqual({ kind: 'arrived', at: '2026-11-15T21:40:00Z' });
  });
  it('offers the way back again when a job was finished after that arrival, or on another day', () => {
    const arrived = trip({ status: 'arrived', ended_at: '2026-11-15T19:00:00Z' });
    expect(returnState([arrived], 'me', '2026-11-15', dayOf, '2026-11-15T20:30:00Z', now).kind).toBe('none');
    expect(returnState([arrived], 'me', '2026-11-16', dayOf, null, now).kind).toBe('none');
    expect(returnState([arrived], 'someone else', '2026-11-15', dayOf, null, now).kind).toBe('none');
  });
});

describe('« À encaisser »', () => {
  it('lists an issued invoice with money still due, newest first', () => {
    const jobs = [job({ id: 'a', status: 'done', day: '2026-11-10' }), job({ id: 'b', status: 'done', day: '2026-11-12' }), job({ id: 'c', status: 'done' })];
    const map = invoicesByJob([inv({ id: '1', job_id: 'a', paid_cents: 4000 }), inv({ id: '2', job_id: 'b' }), inv({ id: '3', job_id: 'c', status: 'paid', paid_cents: 10000 })]);
    expect(collectList(jobs, map).map((x) => [x.job.id, x.due])).toEqual([['b', 10000], ['a', 6000]]);
  });
  it('lists « payer plus tard » without an invoice', () => {
    expect(collectList([job({ status: 'done', pay_later: true })], new Map())).toMatchObject([{ due: 0 }]);
  });
  it('leaves out a paid invoice, a draft, and a finished job with no invoice that is not « payer plus tard »', () => {
    const jobs = [job({ id: 'paid', status: 'done' }), job({ id: 'draft', status: 'done' }), job({ id: 'none', status: 'done' })];
    const map = invoicesByJob([inv({ id: 'p', job_id: 'paid', status: 'paid', paid_cents: 10000 }), inv({ id: 'd', job_id: 'draft', status: 'draft' })]);
    expect(collectList(jobs, map)).toEqual([]);
  });
  it('indexes each job’s invoice once, the void and deleted ones left out, the first one kept', () => {
    const map = invoicesByJob([inv({ id: 'v', status: 'void' }), inv({ id: 'd', deleted_at: '2026-11-01' }), inv({ id: 'first' }), inv({ id: 'second' })]);
    expect(map.get('j')?.id).toBe('first');
  });
});

describe('the last stop finished, for the way back', () => {
  const none = () => undefined;
  it('is the latest finished_at of the day', () => {
    expect(lastFinished([job({ id: 'a', status: 'done', finished_at: '2026-11-15T18:00:00Z' }), job({ id: 'b', status: 'done', finished_at: '2026-11-15T20:30:00Z' })], none))
      .toBe('2026-11-15T20:30:00Z');
    expect(lastFinished([job({ status: 'booked' })], none)).toBeNull();
  });
  it('a « Terminer » still waiting on the phone counts at the time it was made (no finished_at yet)', () => {
    const steps = (id: string) => (id === 'b' ? [{ action: 'arrive' as const, at: '2026-11-15T21:00:00.000Z' }, { action: 'finish' as const, at: '2026-11-15T22:10:00.000Z' }] : undefined);
    expect(lastFinished([job({ id: 'a', status: 'done', finished_at: '2026-11-15T18:00:00+00:00' }), job({ id: 'b', status: 'done', finished_at: null })], steps))
      .toBe('2026-11-15T22:10:00.000Z');
  });
  it('the server’s finished_at wins once the row came back, and a waiting step of a job not done counts for nothing', () => {
    const steps = () => [{ action: 'finish' as const, at: '2026-11-15T23:00:00.000Z' }];
    expect(lastFinished([job({ status: 'done', finished_at: '2026-11-15T22:59:00+00:00' })], steps)).toBe('2026-11-15T22:59:00+00:00');
    expect(lastFinished([job({ status: 'on_site', finished_at: null })], steps)).toBeNull();
  });
  it('a mechanic back once who finishes another job before it reaches the server is offered « Je pars » again', () => {
    const now = Date.parse('2026-11-15T22:30:00Z');
    const dayOf = (iso: string) => iso.slice(0, 10);
    const back = { id: 'r', staff_id: 'me', kind: 'return', status: 'arrived', ended_at: '2026-11-15T20:00:00Z', expires_at: '2026-11-15T21:00:00Z', deleted_at: null } as unknown as Trip;
    const steps = () => [{ action: 'finish' as const, at: '2026-11-15T22:10:00.000Z' }];
    const list = [job({ id: 'a', status: 'done', finished_at: '2026-11-15T19:00:00Z' }), job({ id: 'b', status: 'done', finished_at: null })];
    expect(returnState([back], 'me', '2026-11-15', dayOf, lastFinished(list, none), now).kind).toBe('arrived');
    expect(returnState([back], 'me', '2026-11-15', dayOf, lastFinished(list, steps), now).kind).toBe('none');
  });
});
