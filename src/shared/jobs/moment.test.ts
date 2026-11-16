import { describe, it, expect } from 'vitest';
import type { Job } from '../../data/types';
import { blockRange, momentWord, momentLabel, momentShort, promisedWindow, outsideWindow, keepWindow, wt, isWindowJob } from './select';

const J = (o: Partial<Job>): Job => ({ id: 'j', number: 1, day: '2026-11-17', block: 'pm', status: 'booked', eta_min: null, ...o } as Job);
const win = J({ block: 'day', win_start: 840, win_end: 1080 });
const flex = J({ block: 'day', win_start: null, win_end: null, win_flex: true });

describe('a job is shown by what it is: its block, or the window told to the customer', () => {
  it('a block job reads as before', () => {
    expect(isWindowJob(J({}))).toBe(false);
    expect(blockRange(J({}), 'fr')).toBe('12 h à 16 h');
    expect(momentWord(J({}), 'fr')).toBe('après-midi');
    expect(momentLabel(J({ block: 'am' }), 'fr')).toBe('Matin');
    expect(momentShort(J({ block: 'eve' }), 'fr')).toBe('Soir');
    expect(promisedWindow(J({}))).toBeNull();
    expect(keepWindow(J({}))).toBeNull();
  });
  it('a job booked by window says its window, never a block word', () => {
    expect(blockRange(win, 'fr')).toBe('entre 14 h et 18 h');
    expect(blockRange(win, 'en')).toBe('between 2 p.m. and 6 p.m.');
    expect(momentWord(win, 'fr')).toBe('entre 14 h et 18 h');
    expect(momentLabel(win, 'fr')).toBe('Entre 14 h et 18 h');
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
