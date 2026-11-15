import { describe, it, expect } from 'vitest';
import { isDirty, sameValue, changedKeys, normalize, nextVersion, cleanText } from './draft';
import { fillPreview, previewParts, unknownVars, insertAt, VARS_OF, DEFAULT_TEXTS, MSG_KINDS, ALL_VARS, SWITCH_OF, SWITCHES, DEFAULT_ON, kindsFor, plageWords, momentVars } from './messages';
import { spanOf, withDaySpan, exampleWindow, spanTooShort } from './windows';

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

describe('settings: « Plages d’arrivée »', () => {
  const blocks = [{ key: 'am' as const, start: 480, end: 720 }, { key: 'pm' as const, start: 720, end: 960 }, { key: 'eve' as const, start: 960, end: 1200 }];

  it('the example: an arrival at 3 pm is told 2 pm to 6 pm; the window stays inside the day', () => {
    expect(exampleWindow(900, { before: 60, after: 180, round: 60 }, [480, 1200])).toEqual([840, 1080]);
    expect(exampleWindow(900, { before: 30, after: 210, round: 60 }, [480, 1200])).toEqual([870, 1110]);
    expect(exampleWindow(900, { before: 60, after: 180, round: 60 }, [480, 1020])).toEqual([780, 1020]);
    // a number missing or wrong while typing: the usual one
    expect(exampleWindow(900, { before: null, after: Number.NaN, round: 45 }, [480, 1200])).toEqual([840, 1080]);
  });
  it('« Heures de la journée » keeps the stored blocks and moves only the first start and the last end', () => {
    expect(spanOf(blocks)).toEqual([480, 1200]);
    const later = withDaySpan(blocks, 540, 1140);
    expect(later.map((b) => [b.key, b.start, b.end])).toEqual([['am', 540, 720], ['pm', 720, 960], ['eve', 960, 1140]]);
    expect(blocks[0].start).toBe(480);
    // a day that no longer holds the old cuts: cut again in equal parts, still in order with no hole
    const short = withDaySpan(blocks, 780, 1020);
    expect(spanOf(short)).toEqual([780, 1020]);
    expect(short.map((b) => b.key)).toEqual(['am', 'pm', 'eve']);
    short.forEach((b, i) => { expect(b.end).toBeGreaterThan(b.start); if (i) expect(b.start).toBe(short[i - 1].end); });
    expect(withDaySpan(blocks, 900, 600)).toBe(blocks);
  });
  it('a day shorter than one window is refused', () => {
    expect(spanTooShort([480, 1200], { before: 60, after: 180, round: 60 })).toBe(false);
    expect(spanTooShort([480, 700], { before: 60, after: 180, round: 60 })).toBe(true);
    expect(spanTooShort([480, 720], { before: null, after: null, round: null })).toBe(false);
  });
  it('the text « Plage confirmée » exists only in window mode, with its own switch, on by default', () => {
    expect(kindsFor(false)).not.toContain('window');
    expect(kindsFor(true)).toContain('window');
    expect(kindsFor(true)).toEqual(MSG_KINDS);
    expect(SWITCH_OF.window).toBe('window');
    expect(SWITCHES).toContain('window');
    expect(DEFAULT_ON.window).toBe(true);
    expect(VARS_OF.window).toContain('plage');
    for (const k of ['booking', 'moved', 'reminder'] as const) expect(VARS_OF[k]).toContain('plage');
  });
  it('{plage} says the window, or the whole day for a flexible appointment', () => {
    expect(plageWords([840, 1080], 'fr')).toBe('entre 14 h et 18 h');
    expect(plageWords([840, 1080], 'en')).toBe('between 2 p.m. and 6 p.m.');
    expect(plageWords(null, 'fr')).toContain('la veille');
    expect(plageWords(null, 'en')).toContain('the day before');
  });
  it('the preview shows a window, never a block, when windows are on', () => {
    const o = { block: [480, 720] as const, blockWords: 'le matin', dayWords: 'dans la journée' };
    const off = momentVars({ ...o, window: null }, 'fr');
    expect(off).toEqual({ bloc: 'le matin', debut: '8 h', fin: '12 h', plage: 'entre 8 h et 12 h' });
    const on = momentVars({ ...o, window: [840, 1080] }, 'fr');
    expect(on).toEqual({ bloc: 'dans la journée', debut: '14 h', fin: '18 h', plage: 'entre 14 h et 18 h' });
    expect(fillPreview(DEFAULT_TEXTS.fr.booking.split('\n')[0], { prenom: 'Julie', garage: 'H.I.S', jour: 'demain', ...on })).toBe('Bonjour Julie, votre rendez-vous avec H.I.S est confirmé : demain, dans la journée (entre 14 h et 18 h).');
    expect(fillPreview(DEFAULT_TEXTS.fr.window, { prenom: 'Julie', garage: 'H.I.S', jour: 'demain', telephone: '438 901-6606', ...on })).toBe('Bonjour Julie, votre plage d’arrivée est confirmée : H.I.S vient demain, entre 14 h et 18 h. Pour changer : 438 901-6606');
  });
});
