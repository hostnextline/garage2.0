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

/* Part 28 (R5a, REARRANGE.md §3.8, U7): « Dit au client » says what the customer was TOLD; while he is due, « nouvelle
   plage … : pas encore envoyée »; never told: « Pas encore averti ». */
describe('« Dit au client » reads what he was told', () => {
  const W = { ...N, block: 'day', status: 'booked', win_start: 780, win_end: 1020, win_flex: false, eta_min: 840 } as unknown as Job;
  const card = async (next: Job) => {
    await act(async () => { render(<TruckCard x={{ ...now(C), jobs: [C, next], next }} now={Date.now()} day={DAY} />, box); });
    return box.querySelector('[data-testid="today-truck-window"]')?.textContent ?? null;
  };
  beforeEach(() => { replaceLocal('settings', [{ id: '1', booking: { windows_on: true } }] as never); });
  it('told the window it has: « Dit au client : entre 13 h et 17 h », nothing more', async () => {
    expect(await card({ ...W, told_day: DAY, told_start: 780, told_end: 1020, told_at: '2026-11-20T10:00:00-05:00' } as Job)).toBe('Dit au client : entre 13 h et 17 h');
  });
  it('told 9 h à 13 h, planned 13 h à 17 h since: what he was told, and the new window not sent yet', async () => {
    const text = await card({ ...W, told_day: DAY, told_start: 540, told_end: 780, told_at: '2026-11-20T10:00:00-05:00' } as Job);
    expect(text).toBe('Dit au client : entre 9 h et 13 h, nouvelle plage entre 13 h et 17 h : pas encore envoyée');
    expect(box.querySelector('[data-testid="today-truck-notsent"]')).toBeTruthy();
  });
  it('his sure arrival still inside what he was told: nothing new to say (days F1) — when it is a minute pointed, or his planned window does not hold it', async () => {
    const told = { told_day: DAY, told_start: 780, told_end: 1020, told_at: '2026-11-20T10:00:00-05:00' };
    // told 13 h à 17 h; moved exactly to 14 h (a minute pointed): planned 14 h à 18 h, served inside what he was told
    expect(await card({ ...W, win_start: 840, win_end: 1080, eta_min: 840, arrive_at: 840, ...told } as Job)).toBe('Dit au client : entre 13 h et 17 h');
    // an earlier save cut 14 h à 18 h, he arrives 13 h 30 (outside it, inside what he was told): « Hors plage » for the
    // truck (the planned window, §3.8), nothing new for the customer
    expect(await card({ ...W, win_start: 840, win_end: 1080, eta_min: 810, ...told } as Job)).toBe('Dit au client : entre 13 h et 17 h Hors plage');
  });
  it('« Déplacer » to 14 h à 18 h, the truck there at 14 h (also inside what he was told): a new window to tell him (review R0)', async () => {
    expect(await card({ ...W, win_start: 840, win_end: 1080, eta_min: 840, told_day: DAY, told_start: 780, told_end: 1020, told_at: '2026-11-20T10:00:00-05:00' } as Job))
      .toBe('Dit au client : entre 13 h et 17 h, nouvelle plage entre 14 h et 18 h : pas encore envoyée');
  });
  it('never told anything: « Pas encore averti »', async () => {
    expect(await card(W)).toBe('Pas encore averti');
  });
});
