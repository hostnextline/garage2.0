import { describe, it, expect } from 'vitest';
import { weekOfDay, shiftWeek, sameWeek, weekTitle, fillOf, freeWords, moveQuestion, dropRefusal } from './layout';
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

describe('words', () => {
  it('French and English have the same keys and the same {placeholders}', () => {
    expect(sameShape(fr, en)).toEqual([]);
  });
});
