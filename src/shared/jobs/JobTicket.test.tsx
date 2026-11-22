/* A job's ticket (the agenda's lanes and day, the customer's file, the car's history, « Ma journée »): a stop on the way says
   the trip's REAL arrival (the server's TomTom / OSRM time) or no time, never the plan's time said as an arrival (task point
   L4 / F10; review-trip F1: the ticket said « Vers 10 h » from the plan, with or without a trip time). The same rule as the
   map legend and the truck card. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { JobTicket } from './JobTicket';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import { clock, today } from '../../lib/dates';
import { minuteOf } from '../../domain/jobs/when';
import type { Access, Job } from '../../data/types';

const DAY = today();
const C = { id: 'c1', number: 5, customer_id: null, truck_id: 't1', day: DAY, block: 'am', status: 'en_route', stop_order: 1, duration_min: 60, eta_min: 600, deleted_at: null } as unknown as Job;
const TRIP = (eta: string | null, p: Record<string, unknown> = {}) => ({ id: 'tr1', job_id: 'c1', kind: 'job', staff_id: null, status: 'active', started_at: new Date().toISOString(), ended_at: null, eta_at: eta,
  km: null, minutes: null, route: null, dest_lat: null, dest_lng: null, sms_status: null, expires_at: new Date(Date.now() + 3600_000).toISOString(), ...p });
const PLAN = clock(600, 'fr');   // « 10 h », the plan's time
/** the time said as a whole: « 10 h » is not in « 10 h 45 » nor in « 110 h » */
const hasTime = (s: string, time: string) => new RegExp(`(^|[^0-9])${time.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?! ?[0-9])`).test(s);
const box = document.createElement('div');
document.body.appendChild(box);
const text = () => box.querySelector('[data-testid="job-ticket"]')!.textContent || '';
function show(j: Job, props: { showDay?: boolean; showTruck?: boolean } = {}) {
  replaceLocal('jobs', [j] as never);
  act(() => render(<JobTicket job={j} {...props} />, box));
}

beforeEach(() => {
  clearAll();
  lang.value = 'fr';
  access.value = { id: 'office', roles: ['office'], owner: false, rights: { agenda: true }, trucks: ['t1'] } as unknown as Access;
  replaceLocal('trucks', [{ id: 't1', name: 'Camion', active: true, sort: 1, color: '#D3000E', driver_id: null }] as never);
});
afterEach(() => { act(() => render(null, box)); access.value = null; lang.value = 'fr'; });

describe('JobTicket: a stop on the way', () => {
  it('no trip time from the server: no time at all (before: « Aujourd’hui, vers 10 h », the plan’s)', () => {
    show(C, { showDay: true });
    expect(text()).toContain('Client sans nom');
    expect(text()).toContain('En route');
    expect(text()).not.toContain(PLAN);
    expect(text()).not.toMatch(/vers \d/i);
  });
  it('a trip with no time (the server found no road): no time either', () => {
    replaceLocal('trips', [TRIP(null)] as never);
    show(C);
    expect(text()).not.toContain(PLAN);
    expect(text()).not.toMatch(/vers \d/i);
  });
  it('the server’s real time: that one (before: still the plan’s « Vers 10 h »)', () => {
    const eta = new Date(Date.now() + 25 * 60_000).toISOString();
    replaceLocal('trips', [TRIP(eta)] as never);
    // the plan 3 hours away from the real arrival, whatever the hour the test runs (final-critic K1: « 10 h » was inside
    // « 10 h 45 » every morning from 9 h 35 to 10 h 34)
    const plan = (minuteOf(eta)! + 180) % 1440;
    show({ ...C, eta_min: plan } as Job);
    const real = clock(minuteOf(eta)!, 'fr');
    expect(real).not.toBe(clock(plan, 'fr'));
    expect(text()).toContain(`Vers ${real}`);
    expect(hasTime(text(), clock(plan, 'fr'))).toBe(false);
  });
  it('a trip that is over (arrived) is not the stop’s time', () => {
    replaceLocal('trips', [TRIP(new Date(Date.now() + 25 * 60_000).toISOString(), { status: 'arrived' })] as never);
    show(C);
    expect(text()).not.toMatch(/vers \d/i);
  });
  it('in English too', () => {
    lang.value = 'en';
    show(C);
    expect(text()).not.toContain(clock(600, 'en'));
  });
});

describe('JobTicket: the other stops say what they said before', () => {
  it('a booked stop keeps the plan’s time (it is a plan, said « vers »)', () => {
    show({ ...C, status: 'booked' } as Job);
    expect(text()).toContain(`Vers ${PLAN}`);
  });
  it('a booked stop is not given a trip’s time', () => {
    replaceLocal('trips', [TRIP(new Date(Date.now() + 25 * 60_000).toISOString())] as never);
    show({ ...C, status: 'booked' } as Job);
    expect(text()).toContain(`Vers ${PLAN}`);
  });
  it('on site: the time it arrived; done: the time it finished', () => {
    show({ ...C, status: 'on_site', arrived_at: '2026-11-20T14:44:00Z' } as Job);
    expect(text()).toContain('9 h 44');
    show({ ...C, status: 'done', finished_at: '2026-11-20T15:50:00Z' } as Job);
    expect(text()).toContain('10 h 50');
  });
});
