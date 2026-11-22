/* « La journée »: a truck on the way says the trip's real arrival (« Je pars »: TomTom, else OSRM) or no time at all,
   never the plan's time said as an arrival (F10, like the map's legend); the ticket of « Ma journée » the same. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { TruckCard } from './TruckCard';
import { ticketJob } from './select';
import { arrivalOf } from './rules';
import { replaceLocal } from '../../data/store';
import { lang } from '../../lib/i18n';
import { clock, minuteOf, today } from '../../lib/dates';
import type { Job, Truck } from '../../data/types';
import type { TruckNow } from './select';

const DAY = today();
const C = { id: 'c1', number: 5, customer_id: null, truck_id: 't1', day: DAY, block: 'am', status: 'en_route', stop_order: 1, duration_min: 60, eta_min: 600, deleted_at: null } as unknown as Job;
const N = { ...C, id: 'n2', number: 6, status: 'booked', stop_order: 2, eta_min: 700 } as unknown as Job;
const T = { id: 't1', name: 'Camion', active: true, sort: 1, color: '#D3000E', driver_id: null } as unknown as Truck;
const now = (c: Job): TruckNow => ({ truck: T, jobs: [c, N], done: 0, total: 2, current: c, next: N, state: 'en_route', shiftOpen: false, posAt: null });
const ETA = new Date(Date.now() + 25 * 60_000).toISOString();
const trip = (eta: string | null) => replaceLocal('trips', [{ id: 'tr1', job_id: 'c1', kind: 'job', staff_id: null, status: 'active', started_at: new Date().toISOString(), ended_at: null, eta_at: eta,
  km: null, minutes: null, route: null, dest_lat: null, dest_lng: null, sms_status: null, expires_at: new Date(Date.now() + 3600_000).toISOString() }] as never);

const box = document.createElement('div');
document.body.appendChild(box);
const line = () => box.querySelector('.today-truck-now')!.textContent;
async function show(c: Job) { await act(async () => { render(<TruckCard x={now(c)} now={Date.now()} day={DAY} />, box); }); }
beforeEach(() => { lang.value = 'fr'; replaceLocal('trips', []); replaceLocal('trucks', [T] as never); });
afterEach(() => { render(null, box); });

describe('the truck on the way', () => {
  it('no real arrival from the server: « En route vers … » with no time (before: the plan’s 10 h said as its arrival)', async () => {
    await show(C);
    expect(line()).toBe('En route vers Client sans nom');
    expect(line()).not.toContain(clock(600, 'fr'));
    trip(null);
    await show(C);
    expect(line()).not.toContain(clock(600, 'fr'));
  });
  it('the trip’s real arrival when the server has one', async () => {
    trip(ETA);
    await show(C);
    expect(line()).toContain(`arrivée vers ${clock(minuteOf(new Date(ETA)), 'fr')}`);
  });
  it('the next stop, still to come, keeps its planned time (« Prochain : … vers … »)', async () => {
    await show(C);
    expect(box.textContent).toContain(clock(700, 'fr'));
  });
});

describe('arrivalOf, ticketJob', () => {
  it('on the way: only the trip’s time; booked: the plan', () => {
    expect(arrivalOf({ status: 'en_route', eta_min: 600 }, null)).toBeNull();
    expect(arrivalOf({ status: 'en_route', eta_min: 600 }, 615)).toBe(615);
    expect(arrivalOf({ status: 'booked', eta_min: 600 }, 615)).toBe(600);
    expect(arrivalOf({ status: 'booked', eta_min: null }, null)).toBeNull();
  });
  it('the ticket of a stop on the way has the trip’s arrival or none; a booked one is left as it is', () => {
    expect(ticketJob(C).eta_min).toBeNull();
    trip(ETA);
    expect(ticketJob(C).eta_min).toBe(minuteOf(new Date(ETA)));
    expect(ticketJob(N)).toBe(N);
  });
});
