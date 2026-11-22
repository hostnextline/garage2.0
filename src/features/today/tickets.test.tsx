/* « Ma journée » and « Pas terminé »: a stop on the way says the trip's real arrival or no time, never the plan's time said
   as an arrival (task point 4; review-sheets L4: NextStop's ticket had no test, « Pas terminé » and « Ensuite » still said
   « vers 10 h » from the plan). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { NextStop } from './NextStop';
import { OpenBefore } from './OpenBefore';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import { addDays, clock, today } from '../../lib/dates';
import { minuteOf } from '../../domain/jobs/when';
import type { Access, Job } from '../../data/types';
/** the time said as a whole: « 10 h » is not in « 10 h 45 » nor in « 110 h » */
const hasTime = (s: string, time: string) => new RegExp(`(^|[^0-9])${time.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?! ?[0-9])`).test(s);

const DAY = today();
const C = { id: 'c1', number: 5, customer_id: null, truck_id: 't1', day: DAY, block: 'am', status: 'en_route', stop_order: 1, duration_min: 60, eta_min: 600, deleted_at: null } as unknown as Job;
const TRIP = (eta: string | null) => ({ id: 'tr1', job_id: 'c1', kind: 'job', staff_id: null, status: 'active', started_at: new Date().toISOString(), ended_at: null, eta_at: eta,
  km: null, minutes: null, route: null, dest_lat: null, dest_lng: null, sms_status: null, expires_at: new Date(Date.now() + 3600_000).toISOString() });
const box = document.createElement('div');
document.body.appendChild(box);
const ticketText = () => box.querySelector('[data-testid="today-next"], [data-testid="today-open"]')!.textContent || '';

beforeEach(() => {
  clearAll();
  lang.value = 'fr';
  access.value = { id: 'saleh', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1'] } as unknown as Access;
  replaceLocal('trucks', [{ id: 't1', name: 'Camion', active: true, sort: 1, color: '#D3000E', driver_id: null }] as never);
});
afterEach(() => { act(() => render(null, box)); access.value = null; });

describe('NextStop: the stop on the way', () => {
  it('no trip time from the server: no time (before: « vers 10 h », the plan’s)', () => {
    replaceLocal('jobs', [C] as never);
    act(() => render(<NextStop day={DAY} list={[C]} />, box));
    expect(ticketText()).toContain('Client sans nom');
    expect(ticketText()).not.toContain(clock(600, 'fr'));
  });
  it('the trip’s real arrival when the server has one', () => {
    const eta = new Date(Date.now() + 25 * 60_000);
    // the plan 3 hours away from the real arrival, whatever the hour the test runs (final-critic K1)
    const P = { ...C, eta_min: (minuteOf(eta.toISOString())! + 180) % 1440 } as Job;
    replaceLocal('jobs', [P] as never);
    replaceLocal('trips', [TRIP(eta.toISOString())] as never);
    act(() => render(<NextStop day={DAY} list={[P]} />, box));
    expect(hasTime(ticketText(), clock(P.eta_min!, 'fr'))).toBe(false);
    expect(ticketText()).toContain(`Vers ${clock(minuteOf(eta.toISOString())!, 'fr')}`);
  });
  it('a booked stop keeps its planned time', () => {
    const B = { ...C, status: 'booked' } as Job;
    replaceLocal('jobs', [B] as never);
    act(() => render(<NextStop day={DAY} list={[B]} />, box));
    expect(ticketText()).toContain(`Vers ${clock(600, 'fr')}`);
  });
});

describe('« Pas terminé »: a past day’s stop left on the way', () => {
  it('no time said as an arrival', () => {
    const P = { ...C, day: addDays(DAY, -1) } as Job;
    replaceLocal('jobs', [P] as never);
    act(() => render(<OpenBefore day={DAY} mineOnly />, box));
    expect(ticketText()).toContain('Client sans nom');
    expect(ticketText()).not.toContain(clock(600, 'fr'));
  });
});
