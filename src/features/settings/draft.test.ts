import { describe, it, expect } from 'vitest';
import { isDirty, sameValue, normalize, nextVersion, cleanText, changesOf, withChanges, sameChanges } from './draft';

describe('settings: « changements non enregistrés »', () => {
  const saved = { name: 'Mécanique Mobile H.I.S', phone: '438 901-6606', website: undefined as string | undefined, travel: { cents: 0, free_over_cents: null as number | null } };

  it('nothing typed: clean', () => {
    expect(isDirty(saved, { ...saved })).toBe(false);
    expect(isDirty(saved, JSON.parse(JSON.stringify(saved)))).toBe(false);
  });
  it('a real change: dirty', () => {
    expect(isDirty(saved, { ...saved, phone: '514 555-1234' })).toBe(true);
    expect(isDirty(saved, { ...saved, travel: { cents: 1500, free_over_cents: null } })).toBe(true);
    expect(isDirty({ on: { reminder: false } }, { on: { reminder: true } })).toBe(true);
  });
  it('typing then erasing, spaces around words, empty vs missing, key order: not a change', () => {
    expect(isDirty(saved, { ...saved, website: '' })).toBe(false);
    expect(isDirty(saved, { ...saved, website: '   ' })).toBe(false);
    expect(isDirty(saved, { ...saved, name: '  Mécanique Mobile H.I.S ' })).toBe(false);
    expect(isDirty({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(isDirty({ footer_fr: 'Merci' }, { footer_fr: 'Merci', footer_en: '' })).toBe(false);
    expect(isDirty(null, {})).toBe(false);
  });
  it('the order of a list counts; a number is not its text', () => {
    expect(isDirty(['Pièces', 'Carburant'], ['Carburant', 'Pièces'])).toBe(true);
    expect(isDirty({ speed: 35 }, { speed: '35' })).toBe(true);
    expect(isDirty({ speed: 35 }, { speed: Number.NaN })).toBe(true);
    expect(sameValue([1, null], [1, undefined])).toBe(true);
  });
  it('an object with only empty values is nothing', () => {
    expect(normalize({ x: { y: '' } })).toBeUndefined();
  });
  it('cleans texts and counts waiver versions', () => {
    expect(cleanText('  ')).toBeNull();
    expect(cleanText(' F- ')).toBe('F-');
    expect(nextVersion('1')).toBe('2');
    expect(nextVersion('1.9')).toBe('1.10');
    expect(nextVersion('')).toBe('2');
    expect(nextVersion(undefined)).toBe('2');
  });
});


describe('settings: a draft holds only what the person changed (settings-team-01)', () => {
  const saved = { start: 'Mountain Sights', horizon: 120, speed: 35 };

  it('only the fields that differ from what is saved are kept', () => {
    expect(changesOf(saved, { ...saved, horizon: 90 })).toEqual({ horizon: 90 });
    expect(changesOf(saved, { ...saved, horizon: 120 })).toEqual({});
    expect(changesOf(saved, { ...saved, start: ' Mountain Sights ' })).toEqual({});
  });
  it('a field another device changed meanwhile shows its new value; the field typed here stays', () => {
    const mine = changesOf(saved, { ...saved, horizon: 90 });
    const later = { ...saved, start: 'Legendre' };              // saved elsewhere, the draft not touched
    expect(withChanges(later, mine)).toEqual({ start: 'Legendre', horizon: 90, speed: 35 });
    // what is saved from here is the field typed, never the old start
    expect(changesOf(later, withChanges(later, mine))).toEqual({ horizon: 90 });
  });
  it('a change saved elsewhere with the same value leaves the draft (the list and the bar agree)', () => {
    const mine = { horizon: 90 };
    const later = { ...saved, horizon: 90 };
    expect(changesOf(later, withChanges(later, mine))).toEqual({});
    expect(sameChanges(mine, {})).toBe(false);
    expect(sameChanges({ a: ' x ' }, { a: 'x' })).toBe(true);
  });
});
