import { describe, it, expect } from 'vitest';
import type { Job } from '../../data/types';
import { blockRange, momentWord, momentShort, promisedWindow, outsideWindow, keepWindow, wt, isWindowJob, minuteOf, clockOf, enRouteTicket, plannedTime, etaUnsure } from './when';

describe('the hour of a moment is the garage’s, whatever the phone’s zone (R169)', () => {
  it('reads Montréal’s clock (winter UTC−5, summer UTC−4, just after midnight)', () => {
    expect(minuteOf('2026-11-16T19:32:00Z')).toBe(14 * 60 + 32);
    expect(minuteOf('2026-07-16T18:32:00Z')).toBe(14 * 60 + 32);
    expect(minuteOf('2026-11-16T05:05:00Z')).toBe(5);
    expect(clockOf('2026-11-16T19:32:00Z', 'fr')).toBe('14 h 32');
  });
  it('nothing or not a date: no hour', () => {
    expect(minuteOf(null)).toBeNull();
    expect(minuteOf('')).toBeNull();
    expect(minuteOf('pas une date')).toBeNull();
    expect(clockOf(undefined, 'fr')).toBe('');
  });
});

const J = (o: Partial<Job>): Job => ({ id: 'j', number: 1, day: '2026-11-17', block: 'pm', status: 'booked', eta_min: null, ...o } as Job);
const win = J({ block: 'day', win_start: 840, win_end: 1080 });
const flex = J({ block: 'day', win_start: null, win_end: null, win_flex: true });

describe('a job is shown by what it is: its block, or the window told to the customer', () => {
  it('a block job reads as before', () => {
    expect(isWindowJob(J({}))).toBe(false);
    expect(blockRange(J({}), 'fr')).toBe('12 h à 16 h');
    expect(momentWord(J({}), 'fr')).toBe('après-midi');
    expect(momentShort(J({ block: 'eve' }), 'fr')).toBe('Soir');
    expect(promisedWindow(J({}))).toBeNull();
    expect(keepWindow(J({}))).toBeNull();
  });
  it('a job booked by window says its window, never a block word', () => {
    expect(blockRange(win, 'fr')).toBe('entre 14 h et 18 h');
    expect(blockRange(win, 'en')).toBe('between 2 p.m. and 6 p.m.');
    expect(momentWord(win, 'fr')).toBe('entre 14 h et 18 h');
    expect(momentShort(win, 'fr')).toBe('14 h–18 h');
    expect(momentShort(win, 'en')).toBe('2–6 p.m.');
    expect(momentShort(J({ block: 'day', win_start: 600, win_end: 840 }), 'en')).toBe('10 a.m.–2 p.m.');
    for (const s of [blockRange(win, 'fr'), momentWord(win, 'fr'), momentShort(win, 'fr')]) expect(s).not.toMatch(/matin|après-midi|soir|bloc/i);
  });
  it('a flexible job has no window yet', () => {
    expect(promisedWindow(flex)).toBeNull();
    expect(blockRange(flex, 'fr')).toBe('dans la journée (plage confirmée la veille)');
    expect(momentShort(flex, 'fr')).toBe('Flexible');
    expect(keepWindow(flex)).toEqual({ start: null, flex: true });
    expect(keepWindow(win)).toEqual({ start: 840, flex: false });
  });
  it('« Hors plage »: a coming stop whose planned arrival misses its window', () => {
    expect(outsideWindow({ ...win, eta_min: 900 })).toBe(false);
    expect(outsideWindow({ ...win, eta_min: 840 })).toBe(false);
    expect(outsideWindow({ ...win, eta_min: 1080 })).toBe(false);
    expect(outsideWindow({ ...win, eta_min: 1085 })).toBe(true);
    expect(outsideWindow({ ...win, eta_min: 800 })).toBe(true);
    expect(outsideWindow({ ...win, eta_min: null })).toBe(false);
    // on the way or there: no longer judged; a flexible or a block job: never
    expect(outsideWindow({ ...win, eta_min: 1100, status: 'en_route' })).toBe(false);
    expect(outsideWindow({ ...flex, eta_min: 1100 })).toBe(false);
    expect(outsideWindow(J({ eta_min: 100 }))).toBe(false);
  });
  it('the texts that say « bloc » have a twin for a window job', () => {
    expect(wt(J({}), 'jobs.menu.cancelSub', undefined, 'fr')).toBe('Le bloc se libère');
    expect(wt(win, 'jobs.menu.cancelSub', undefined, 'fr')).toBe('Sa place se libère');
    for (const k of ['jobs.did.cancel', 'jobs.work.longerHint', 'jobs.moment.moveLead', 'jobs.moment.moveLeadText', 'jobs.moment.help', 'jobs.order.firstMenuSub',
      'jobs.menu.resendBookingSub', 'jobs.menu.cancelSub', 'jobs.menu.reopenSub', 'jobs.menu.moveSub', 'jobs.ask.cancelText', 'jobs.ask.reopenText', 'jobs.edit.when',
      'jobs.truck.menuSub', 'jobs.truck.off', 'jobs.truck.none']) {
      for (const l of ['fr', 'en'] as const) {
        const s = wt(win, k, { truck: 'X' }, l);
        expect(s, k).not.toContain('jobs.');
        expect(s, k).not.toMatch(/\bblocs?\b|\bblocks?\b/i);
      }
    }
  });
});

describe('a window job whose twin text is missing says the base text, never a raw key (i18n-12)', () => {
  it('falls back to the base text', () => {
    // jobs.step.leave has no twin under jobs.win
    expect(wt(win, 'jobs.step.leave', undefined, 'fr')).toBe('Je pars');
    expect(wt(win, 'jobs.step.leave', undefined, 'en')).toBe('I’m leaving');
    expect(wt(J({}), 'jobs.step.leave', undefined, 'fr')).toBe('Je pars');
  });
});

describe('enRouteTicket: a stop on the way says the trip’s real arrival or no time (fix-sheets L4)', () => {
  const j = { id: 'c1', eta_min: 600 };
  it('on the way, no trip time: no time at all, never the plan’s 10 h', () => {
    expect(enRouteTicket(j, 'en_route', null).eta_min).toBeNull();
    expect(enRouteTicket(j, 'en_route', undefined).eta_min).toBeNull();
  });
  it('on the way with the trip’s arrival: that time (the garage’s clock)', () => {
    expect(enRouteTicket(j, 'en_route', '2026-11-20T15:25:00Z').eta_min).toBe(minuteOf('2026-11-20T15:25:00Z'));
  });
  it('booked or anything else: the job as it is (the same object)', () => {
    expect(enRouteTicket(j, 'booked', '2026-11-20T15:25:00Z')).toBe(j);
    expect(enRouteTicket(j, 'on_site', null)).toBe(j);
  });
});

describe('a plan’s time that is not sure (« Vraies routes » on, jobs.eta_measured false: final-guess G1)', () => {
  it('plannedTime: no time while a trip before the stop is not measured; the plan’s time otherwise, as before', () => {
    expect(plannedTime({ eta_min: 580, eta_measured: false })).toBeNull();
    expect(plannedTime({ eta_min: 580, eta_measured: true })).toBe(580);
    expect(plannedTime({ eta_min: 580, eta_measured: null })).toBe(580);
    expect(plannedTime({ eta_min: 580 })).toBe(580);   // switch off, or a server without the column
    expect(plannedTime({ eta_min: null, eta_measured: true })).toBeNull();
    expect(etaUnsure({ eta_min: 580, eta_measured: false })).toBe(true);
    expect(etaUnsure({ eta_min: null, eta_measured: false })).toBe(false);
    expect(etaUnsure({ eta_min: 580 })).toBe(false);
  });
  it('outsideWindow: never « Hors plage » from a time that is not sure', () => {
    const j = { block: 'day' as const, win_start: 540, win_end: 780, status: 'booked' as const, eta_min: 900 };
    expect(outsideWindow(j)).toBe(true);
    expect(outsideWindow({ ...j, eta_measured: false })).toBe(false);
    expect(outsideWindow({ ...j, eta_measured: true })).toBe(true);
  });
  it('enRouteTicket: a booked stop’s unsure time is not said (the flag kept); on the way the trip’s real time is said', () => {
    const j = { id: 'c1', eta_min: 580, eta_measured: false };
    expect(enRouteTicket(j, 'booked', null).eta_min).toBeNull();
    expect(enRouteTicket(j, 'booked', null).eta_measured).toBe(false);
    const r = enRouteTicket(j, 'en_route', '2026-11-20T15:25:00Z');
    expect(r.eta_min).toBe(minuteOf('2026-11-20T15:25:00Z'));
    expect(plannedTime(r)).toBe(minuteOf('2026-11-20T15:25:00Z'));
    const sure = { id: 'c2', eta_min: 580, eta_measured: true };
    expect(enRouteTicket(sure, 'booked', null)).toBe(sure);
  });
});
