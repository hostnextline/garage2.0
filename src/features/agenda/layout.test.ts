import { describe, it, expect } from 'vitest';
import { weekOfDay, shiftWeek, sameWeek, weekTitle, fillOf, freeWords, moveQuestion, dropRefusal, isWindowDay, dayState, byPlan, winInfo, winShort, dayWords, moveDayTitle, windowChoices } from './layout';
import { agenda as fr } from '../../i18n/fr/agenda';
import { agenda as en } from '../../i18n/en/agenda';
import { sameShape } from '../booking/dict-check';

describe('the week', () => {
  it('goes Sunday → Saturday around any day', () => {
    expect(weekOfDay('2026-11-04')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect(weekOfDay('2026-11-07')[0]).toBe('2026-11-01');
    expect(shiftWeek('2026-11-04', 1)).toBe('2026-11-11');
    expect(shiftWeek('2026-11-04', -1)).toBe('2026-10-28');
    expect(sameWeek('2026-11-01', '2026-11-07')).toBe(true);
    expect(sameWeek('2026-11-07', '2026-11-08')).toBe(false);
  });
  it('is titled in French and English', () => {
    expect(weekTitle('2026-11-04', 'fr')).toBe('Semaine du 1er au 7 novembre');
    expect(weekTitle('2026-11-30', 'fr')).toBe('Semaine du 29 novembre au 5 décembre');
    expect(weekTitle('2026-12-30', 'fr')).toBe('Semaine du 27 décembre 2026 au 2 janvier 2027');
    expect(weekTitle('2026-11-04', 'en')).toBe('Week of November 1 to 7');
    expect(weekTitle('2026-11-30', 'en')).toBe('Week of November 29 to December 5');
  });
});

describe('how full a truck is', () => {
  it('fills the bar, never past the end', () => {
    expect(fillOf(120, 240).pct).toBe(0.5);
    expect(fillOf(300, 240)).toMatchObject({ pct: 1, over: true, left: -60 });
    expect(fillOf(0, 0).pct).toBe(0);
    expect(fillOf(60, 0).pct).toBe(1);
  });
  it('says the free time in words', () => {
    expect(freeWords(160, 240, 'fr')).toBe('1 h 20 de libre');
    expect(freeWords(240, 240, 'fr')).toBe('Complet');
    expect(freeWords(260, 240, 'fr')).toBe('Complet, 20 min de trop');
    expect(freeWords(60, 0, 'fr')).toBe('Ne travaille plus dans ce bloc');
    expect(freeWords(0, 240, 'en')).toBe('4 h free');
    expect(freeWords(112, 240, 'en', true)).toBe('2 h 08 free');
    expect(freeWords(260, 240, 'fr', true)).toBe('Complet');
  });
});

describe('moving a job', () => {
  const today = '2026-11-04';
  it('asks the question with the days in words', () => {
    expect(moveQuestion('Julie', { day: '2026-11-10', block: 'am' }, { day: '2026-11-05', block: 'pm' }, today, 'fr'))
      .toBe('Déplacer la job de Julie de mardi matin à demain après-midi ?');
    expect(moveQuestion('Julie', { day: '2026-11-04', block: 'eve' }, { day: '2026-11-06', block: 'pm' }, today, 'fr'))
      .toBe('Déplacer la job de Julie de ce soir à vendredi après-midi ?');
    expect(moveQuestion('Julie', { day: '2026-11-10', block: 'am' }, { day: '2026-11-07', block: 'pm' }, today, 'en'))
      .toBe('Move Julie’s job from Tuesday morning to Saturday afternoon?');
  });
  it('refuses a drop where the server would say no anyway', () => {
    const job = { day: '2026-11-05', block: 'am' as const, status: 'booked' };
    const open = { started: false, open: true };
    expect(dropRefusal(job, { day: '2026-11-06', block: 'pm' }, open)).toBe(null);
    expect(dropRefusal(job, { day: '2026-11-05', block: 'am' }, open)).toBe('same');
    expect(dropRefusal(job, { day: '2026-11-03', block: 'pm' }, { started: true, open: true })).toBe('started');
    expect(dropRefusal(job, { day: '2026-11-06', block: 'eve' }, { started: false, open: false })).toBe('closed');
    expect(dropRefusal({ ...job, status: 'en_route' }, { day: '2026-11-06', block: 'pm' }, open)).toBe('not_booked');
  });
});

describe('« Plages d’arrivée »', () => {
  const today = '2026-11-14';
  it('draws a day in one piece when the garage books by windows (today and later) or the day holds a job of « the day »', () => {
    expect(isWindowDay('2026-11-14', today, true, [])).toBe(true);
    expect(isWindowDay('2026-11-20', today, true, ['am'])).toBe(true);
    // a past day of blocks keeps its blocks, even once the garage has switched
    expect(isWindowDay('2026-11-13', today, true, ['am', 'pm'])).toBe(false);
    expect(isWindowDay('2026-11-13', today, true, [])).toBe(false);
    // a past day already booked by windows
    expect(isWindowDay('2026-11-13', today, true, ['day', 'day'])).toBe(true);
    // the switch is off: blocks, as always
    expect(isWindowDay('2026-11-20', today, false, [])).toBe(false);
    expect(isWindowDay('2026-11-20', today, false, ['am', 'eve'])).toBe(false);
    expect(isWindowDay('2026-11-20', today, false, ['day'])).toBe(true);
  });
  it('keeps a whole day open until its last hour, while a truck has hours left', () => {
    const span: [number, number] = [480, 1200];
    expect(dayState('2026-11-15', today, 600, span, [720], 45)).toEqual({ started: false, open: true });
    expect(dayState(today, today, 600, span, [300], 45)).toEqual({ started: false, open: true });   // 10 h: the day goes on
    expect(dayState(today, today, 1200, span, [0], 45)).toEqual({ started: true, open: false });
    expect(dayState(today, today, 1170, span, [30], 45)).toEqual({ started: false, open: false });   // too little left
    expect(dayState('2026-11-13', today, 600, span, [0], 45)).toEqual({ started: true, open: false });
    expect(dayState('2026-11-15', today, 600, span, [], 45)).toEqual({ started: false, open: false });
    expect(dayState('2026-11-15', today, 600, span, [0, 0], 45)).toEqual({ started: false, open: false });
  });
  it('orders the stops as planned: the stop number, then the arrival', () => {
    const js = [{ stop_order: null, eta_min: 600, number: 4 }, { stop_order: 2, eta_min: 700, number: 1 }, { stop_order: 1, eta_min: 900, number: 2 }, { stop_order: null, eta_min: 500, number: 3 }];
    expect([...js].sort(byPlan).map((j) => j.number)).toEqual([2, 1, 3, 4]);
  });
  it('says the window of a job, « flexible », « hors plage »', () => {
    const j = { block: 'day' as const, win_start: 840, win_end: 1080, win_flex: false, eta_min: 900, status: 'booked' };
    expect(winInfo(j)).toEqual({ win: [840, 1080], flex: false, late: false });
    expect(winInfo({ ...j, eta_min: 840 })!.late).toBe(false);
    expect(winInfo({ ...j, eta_min: 1080 })!.late).toBe(false);
    expect(winInfo({ ...j, eta_min: 1100 })!.late).toBe(true);
    expect(winInfo({ ...j, eta_min: 800 })!.late).toBe(true);
    expect(winInfo({ ...j, eta_min: null })!.late).toBe(false);
    // once the mechanic is there or the job is done, the planned arrival no longer counts
    expect(winInfo({ ...j, eta_min: 1100, status: 'on_site' })!.late).toBe(false);
    expect(winInfo({ ...j, eta_min: 1100, status: 'done' })!.late).toBe(false);
    expect(winInfo({ ...j, eta_min: 1100, status: 'en_route' })!.late).toBe(false);
    expect(winInfo({ block: 'day', win_start: null, win_end: null, win_flex: true, eta_min: 700, status: 'booked' })).toEqual({ win: null, flex: true, late: false });
    expect(winInfo({ block: 'day', eta_min: 700, status: 'booked' })).toEqual({ win: null, flex: false, late: false });
    // a job of a block: drawn as before
    expect(winInfo({ block: 'am', eta_min: 500, status: 'booked' })).toBe(null);
    expect(winShort([840, 1080], 'fr')).toBe('14 h – 18 h');
    expect(winShort([570, 810], 'fr')).toBe('9 h 30 – 13 h 30');
    expect(winShort([840, 1080], 'en')).toBe('2 p.m. – 6 p.m.');
  });
  it('still refuses the same block, but a day of windows takes its own job again (another window)', () => {
    const job = { day: '2026-11-16', block: 'day' as const, status: 'booked' };
    const open = { started: false, open: true };
    expect(dropRefusal(job, { day: '2026-11-16', block: 'day' }, open)).toBe(null);
    expect(dropRefusal(job, { day: '2026-11-17', block: 'day' }, open)).toBe(null);
    expect(dropRefusal(job, { day: '2026-11-13', block: 'day' }, { started: true, open: false })).toBe('started');
    expect(dropRefusal(job, { day: '2026-11-17', block: 'day' }, { started: false, open: false })).toBe('closed');
    expect(dropRefusal({ ...job, status: 'on_site' }, { day: '2026-11-17', block: 'day' }, open)).toBe('not_booked');
  });
  it('titles the sheet of windows with the day in words', () => {
    expect(dayWords('2026-11-15', today, 'fr')).toBe('Demain');
    expect(dayWords('2026-11-17', today, 'fr')).toBe('Mardi');
    expect(dayWords('2026-11-30', today, 'fr')).toBe('Lundi 30 novembre');
    expect(moveDayTitle('Julie', '2026-11-16', '2026-11-17', today, 'fr')).toBe('Déplacer la job de Julie : mardi');
    expect(moveDayTitle('Julie', '2026-11-15', '2026-11-15', today, 'fr')).toBe('Changer la plage de Julie : demain');
    expect(moveDayTitle('', '2026-11-16', '2026-11-17', today, 'en')).toBe('Move this customer’s job: Tuesday');
  });
  it('offers the windows as the server ranked them, each once, the job’s own marked', () => {
    const list = [{ win_start: 600, win_end: 840, eta: 660 }, { win_start: 840, win_end: 1080, eta: 900 }, { win_start: 600, win_end: 840, eta: 670 }, { win_start: null, win_end: null }];
    const other = windowChoices(list, { day: '2026-11-16', win_start: 600 }, '2026-11-17', 'fr');
    expect(other.map((c) => [c.start, c.end, c.eta, c.best, c.current])).toEqual([[600, 840, 660, true, false], [840, 1080, 900, false, false]]);
    expect(other[0].words).toBe('Entre 10 h et 14 h');
    // the same day: the window it already has is not a choice, the next one is the best
    const same = windowChoices(list, { day: '2026-11-17', win_start: 600 }, '2026-11-17', 'fr');
    expect(same.map((c) => [c.start, c.best, c.current])).toEqual([[600, false, true], [840, true, false]]);
    expect(windowChoices([], { day: '2026-11-17', win_start: 600 }, '2026-11-17', 'en')).toEqual([]);
  });
  it('says a truck has finished its day, not « ce bloc »', () => {
    expect(freeWords(60, 0, 'fr', false, true)).toBe('A fini sa journée');
    expect(freeWords(60, 0, 'fr')).toBe('Ne travaille plus dans ce bloc');
  });
});

describe('words', () => {
  it('French and English have the same keys and the same {placeholders}', () => {
    expect(sameShape(fr, en)).toEqual([]);
  });
});
