/* « Ma journée »: the tickets under the next stop (« Ensuite ») and the next working day's first stop. A stop on the way says
   the trip's real arrival or no time, never the plan's time said as an arrival (task point L4; review-trip F3: with two
   stops on the way — « Les deux », two vehicles — the second one said « Vers 11 h 30 » from the plan, and no test saw it). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { MechanicDay } from './MechanicDay';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import { addDays, clock, today } from '../../lib/dates';
import { minuteOf } from '../../domain/jobs/when';
import type { Access, Job } from '../../data/types';
/** the time said as a whole: « 10 h » is not in « 10 h 45 » nor in « 110 h » */
const hasTime = (s: string, time: string) => new RegExp(`(^|[^0-9])${time.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?! ?[0-9])`).test(s);

const DAY = today();
const J = (id: string, truck: string, eta: number, order: number, p: Partial<Job> = {}) => ({ id, number: order, customer_id: null, truck_id: truck, day: DAY, block: 'am', status: 'en_route',
  stop_order: order, duration_min: 60, eta_min: eta, deleted_at: null, ...p }) as unknown as Job;
const TRIP = (jobId: string, eta: string | null) => ({ id: `tr-${jobId}`, job_id: jobId, kind: 'job', staff_id: 'saleh', status: 'active', started_at: new Date().toISOString(), ended_at: null,
  eta_at: eta, km: null, minutes: null, route: null, dest_lat: null, dest_lng: null, sms_status: null, expires_at: new Date(Date.now() + 3600_000).toISOString() });
const box = document.createElement('div');
document.body.appendChild(box);
const then = () => box.querySelector('[aria-labelledby="today-then"]')?.textContent ?? null;
const ahead = () => box.querySelector('[data-testid="today-ahead"]')?.textContent ?? '';

beforeEach(() => {
  clearAll();
  lang.value = 'fr';
  access.value = { id: 'saleh', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1', 't2'] } as unknown as Access;
  replaceLocal('trucks', [{ id: 't1', name: 'Camion', active: true, sort: 1, color: '#D3000E', driver_id: 'saleh' }, { id: 't2', name: 'Voiture', active: true, sort: 2, color: '#0000ff', driver_id: 'saleh' }] as never);
});
afterEach(() => { act(() => render(null, box)); access.value = null; });

describe('« Ensuite »: a second stop on the way (« Les deux »)', () => {
  it('no trip time from the server: no time (before: « Vers 11 h 30 », the plan’s)', () => {
    replaceLocal('jobs', [J('a', 't1', 600, 1), J('b', 't2', 690, 1)] as never);
    act(() => render(<MechanicDay />, box));
    expect(then()).not.toBeNull();
    expect(then()).toContain('En route');
    expect(then()).not.toContain(clock(690, 'fr'));
    expect(then()).not.toMatch(/vers \d/i);
  });
  it('the server’s real time for that trip: that one', () => {
    const eta = new Date(Date.now() + 40 * 60_000).toISOString();
    // the plan 3 hours away from the real arrival, whatever the hour the test runs (final-critic K1: 10 h 50 failed)
    const plan = (minuteOf(eta)! + 180) % 1440;
    replaceLocal('jobs', [J('a', 't1', 600, 1), J('b', 't2', plan, 1)] as never);
    replaceLocal('trips', [TRIP('b', eta)] as never);
    act(() => render(<MechanicDay />, box));
    expect(then()).toContain(`Vers ${clock(minuteOf(eta)!, 'fr')}`);
    expect(hasTime(then()!, clock(plan, 'fr'))).toBe(false);
  });
  it('a stop still booked keeps the plan’s time', () => {
    replaceLocal('jobs', [J('a', 't1', 600, 1), J('b', 't1', 690, 2, { status: 'booked' })] as never);
    act(() => render(<MechanicDay />, box));
    expect(then()).toContain(`Vers ${clock(690, 'fr')}`);
  });
});

describe('the next working day’s first stop', () => {
  it('booked: the plan’s time', () => {
    replaceLocal('jobs', [J('n', 't1', 540, 1, { day: addDays(DAY, 1), status: 'booked' })] as never);
    act(() => render(<MechanicDay />, box));
    expect(ahead()).toContain(`Vers ${clock(540, 'fr')}`);
  });
  it('already on the way (« Je pars » pressed early) without a trip time: no time', () => {
    replaceLocal('jobs', [J('n', 't1', 540, 1, { day: addDays(DAY, 1) })] as never);
    act(() => render(<MechanicDay />, box));
    expect(ahead()).toContain('Client sans nom');
    expect(ahead()).not.toContain(clock(540, 'fr'));
  });
});
