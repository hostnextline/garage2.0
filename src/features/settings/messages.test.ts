import { describe, it, expect } from 'vitest';
import { fillPreview, previewParts, unknownVars, insertAt, VARS_OF, DEFAULT_TEXTS, MSG_KINDS, ALL_VARS, SWITCH_OF, SWITCHES, DEFAULT_ON, kindsFor, plageWords, momentVars } from './messages';

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

describe('settings: the texts in « Plages d’arrivée » mode', () => {
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
