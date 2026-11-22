/* The agenda's time grid and « Vue d'ensemble »: a stop on the way says the trip's REAL arrival (the server's TomTom / OSRM
   time) or no time, never the plan's time said as an arrival — the rule JobTicket follows (review-trip F1; fix-trip « for the
   lead »: GridJob.tsx:34, JobRow.tsx:24). A booked stop keeps the plan's time. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { GridJob } from './GridJob';
import { JobRow } from '../overview/JobRow';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import { clock, today } from '../../lib/dates';
import { minuteOf } from '../../domain/jobs/when';
import type { Access, Job } from '../../data/types';

const J = (status: string) => ({ id: 'j1', number: 7, customer_id: null, truck_id: 't1', day: today(), block: 'am', status, stop_order: 1, duration_min: 60, eta_min: 600, deleted_at: null }) as unknown as Job;
const TRIP = (eta: string | null, p: Record<string, unknown> = {}) => ({ id: 'tr1', job_id: 'j1', kind: 'job', staff_id: null, status: 'active', started_at: new Date().toISOString(), ended_at: null, eta_at: eta,
  km: null, minutes: null, route: null, dest_lat: null, dest_lng: null, sms_status: null, expires_at: new Date(Date.now() + 3600_000).toISOString(), ...p });
const PLAN = clock(600, 'fr');
/** the time said as a whole: « 10 h » is not in « 10 h 45 » nor in « 110 h » */
const hasTime = (s: string, time: string) => new RegExp(`(^|[^0-9])${time.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?! ?[0-9])`).test(s);
const box = document.createElement('div');
document.body.appendChild(box);
const noop = () => {};
const grid = (j: Job) => {
  replaceLocal('jobs', [j] as never);
  act(() => render(<GridJob job={j} box={{ top: 0, height: 6 }} slot={{ col: 0, cols: 1 }} compact={false} draggable={false} dragging={false} onDragStart={noop} onDragEnd={noop} />, box));
  const a = box.querySelector('[data-testid="grid-job-j1"]')!;
  return { label: a.getAttribute('aria-label') || '', text: a.textContent || '' };
};
const row = (j: Job) => {
  replaceLocal('jobs', [j] as never);
  act(() => render(<JobRow r={{ job: j, n: 1, color: '#D3000E', truckName: 'Camion' } as never} on={false} />, box));
  return box.querySelector('.overview-time')!.textContent || '';
};

beforeEach(() => {
  clearAll();
  lang.value = 'fr';
  access.value = { id: 'office', roles: ['office'], owner: false, rights: { agenda: true }, trucks: ['t1'] } as unknown as Access;
  replaceLocal('trucks', [{ id: 't1', name: 'Camion', active: true, sort: 1, color: '#D3000E', driver_id: null }] as never);
});
afterEach(() => { act(() => render(null, box)); access.value = null; });

describe('the time grid (GridJob): a stop on the way', () => {
  it('no trip time from the server: no arrival said (before: « arrivée prévue à 10 h », the plan’s)', () => {
    const g = grid(J('en_route'));
    expect(g.label).not.toContain(PLAN);
    expect(g.text).not.toContain(PLAN);
    replaceLocal('trips', [TRIP(null)] as never);
    expect(grid(J('en_route')).label).not.toContain(PLAN);
  });
  it('the server’s real time: that one', () => {
    const eta = new Date(Date.now() + 25 * 60_000).toISOString();
    replaceLocal('trips', [TRIP(eta)] as never);
    const real = clock(minuteOf(eta)!, 'fr');
    // the plan 3 hours away from the real arrival, whatever the hour the test runs (final-critic K1)
    const plan = (minuteOf(eta)! + 180) % 1440;
    expect(real).not.toBe(clock(plan, 'fr'));
    const g = grid({ ...J('en_route'), eta_min: plan } as Job);
    expect(g.label).toContain(real);
    expect(g.text).toContain(real);
    expect(hasTime(g.label, clock(plan, 'fr'))).toBe(false);
  });
  it('booked: the plan’s time, as before (a trip time is never taken for it)', () => {
    replaceLocal('trips', [TRIP(new Date(Date.now() + 25 * 60_000).toISOString())] as never);
    const g = grid(J('booked'));
    expect(g.label).toContain(PLAN);
    expect(g.text).toContain(PLAN);
  });
});

describe('« Vue d’ensemble » (JobRow): a stop on the way', () => {
  it('no trip time: « — », not the plan’s time; the real time when the server has one; booked: the plan’s', () => {
    expect(row(J('en_route'))).toBe('—');
    const eta = new Date(Date.now() + 25 * 60_000).toISOString();
    replaceLocal('trips', [TRIP(eta)] as never);
    expect(row(J('en_route'))).toBe(clock(minuteOf(eta)!, 'fr'));
    expect(row(J('booked'))).toBe(PLAN);
  });
});
