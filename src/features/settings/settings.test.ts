import { describe, it, expect } from 'vitest';
import { isDirty, sameValue, changedKeys, normalize, nextVersion, cleanText } from './draft';
import { fillPreview, previewParts, unknownVars, insertAt, VARS_OF, DEFAULT_TEXTS, MSG_KINDS, ALL_VARS } from './messages';

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
  it('names the fields that changed', () => {
    expect(changedKeys({ a: 1, b: 'x', c: null }, { a: 1, b: 'y', d: '' })).toEqual(['b']);
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

describe('settings: preview of the texts', () => {
  const vars = { prenom: 'Julie', garage: 'Mécanique Mobile H.I.S', lien: 'https://x.test/c' };

  it('replaces the known words and leaves the unknown ones visible', () => {
    expect(fillPreview('Bonjour {prenom}, {garage} : {lien}', vars)).toBe('Bonjour Julie, Mécanique Mobile H.I.S : https://x.test/c');
    expect(fillPreview('Bonjour {prenom} {pernom}!', vars)).toBe('Bonjour Julie {pernom}!');
    expect(fillPreview('{prenom}{prenom}', vars)).toBe('JulieJulie');
    expect(fillPreview('  Bonjour   {prenom}\n\n merci ', vars)).toBe('Bonjour Julie merci');
    expect(fillPreview('', vars)).toBe('');
    expect(fillPreview('Total {total}', { total: 0 })).toBe('Total 0');
  });
  it('marks the unknown words for the screen', () => {
    expect(previewParts('Bonjour {prenom}, {heure} ok', vars)).toEqual([{ text: 'Bonjour Julie, ' }, { text: '{heure}', unknown: 'heure' }, { text: ' ok' }]);
    expect(previewParts('{x}', {})).toEqual([{ text: '{x}', unknown: 'x' }]);
  });
  it('lists the words a kind of text does not get', () => {
    expect(unknownVars('Bonjour {prenom}, arrivée vers {heure} {pernom} {heure}', VARS_OF.booking)).toEqual(['heure', 'pernom']);
    expect(unknownVars(DEFAULT_TEXTS.fr.en_route, VARS_OF.en_route)).toEqual([]);
  });
  it('every starting text uses only the words its kind gets, in both languages', () => {
    for (const k of MSG_KINDS) {
      expect(unknownVars(DEFAULT_TEXTS.fr[k], VARS_OF[k])).toEqual([]);
      expect(unknownVars(DEFAULT_TEXTS.en[k], VARS_OF[k])).toEqual([]);
      for (const v of VARS_OF[k]) expect(ALL_VARS).toContain(v);
    }
  });
  it('inserts a word at the cursor with the right spaces', () => {
    expect(insertAt('Bonjour', 7, 7, 'prenom')).toEqual({ text: 'Bonjour {prenom}', cursor: 16 });
    expect(insertAt('Bonjour , merci', 8, 8, 'prenom')).toEqual({ text: 'Bonjour {prenom}, merci', cursor: 16 });
    expect(insertAt('', null, null, 'lien')).toEqual({ text: '{lien}', cursor: 6 });
    expect(insertAt('Bonjour XX ok', 8, 10, 'prenom').text).toBe('Bonjour {prenom} ok');
  });
});
