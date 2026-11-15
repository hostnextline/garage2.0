/* The words of the texts sent to customers (supabase/functions/_shared/texts.ts, used by notify and book): a block job
   says its block exactly as before; a 'day' job (« Plages d’arrivée ») says its window, or « dans la journée ; … ». */
import { describe, it, expect } from 'vitest';
import { whenText, fill, jobWindow, momentWords, betweenWords, flexWords, blockWords, clock, longDay, WINDOW_TEXT } from '../../supabase/functions/_shared/texts';
import { DEFAULT_TEXTS } from '../features/settings/messages';

const BLOCKS = [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }];
const DAY = '2026-11-19';
const base = { prenom: 'Julie', garage: 'H.I.S', telephone: '438 901-6606', lien: 'https://x.test/c#t=abc', services: '• Huile : 79,99 $', soustotal: '79,99 $ + tx', total: '91,97 $' };
const say = (tpl: string, job: Parameters<typeof whenText>[1], lang: 'fr' | 'en') => {
  const w = whenText(tpl, job, BLOCKS, lang);
  return fill(w.tpl, { ...base, ...w.vars });
};
const block = { day: DAY, block: 'pm' };
const win = { day: DAY, block: 'day', win_start: 840, win_end: 1080, win_flex: false };
const flex = { day: DAY, block: 'day', win_start: null, win_end: null, win_flex: true };

describe('texts: a block job is said exactly as before', () => {
  it('the text is not touched and gets the block’s words and hours', () => {
    for (const lang of ['fr', 'en'] as const) {
      for (const kind of ['booking', 'moved', 'reminder'] as const) {
        const tpl = DEFAULT_TEXTS[lang][kind];
        const w = whenText(tpl, block, BLOCKS, lang);
        expect(w.tpl).toBe(tpl);
        expect(w.vars).toEqual({ jour: longDay(DAY, lang), bloc: blockWords('pm', lang), debut: clock(720, lang), fin: clock(960, lang), plage: betweenWords(720, 960, lang) });
      }
    }
    expect(say(DEFAULT_TEXTS.fr.booking, block, 'fr')).toContain('est confirmé : jeudi 19 novembre, l’après-midi (entre 12 h et 16 h).');
    expect(say(DEFAULT_TEXTS.en.booking, block, 'en')).toContain('is confirmed: Thursday, November 19, in the afternoon (between 12 p.m. and 4 p.m.).');
    expect(say(DEFAULT_TEXTS.fr.reminder, block, 'fr')).toBe('Rappel : H.I.S vient demain, jeudi 19 novembre, entre 12 h et 16 h. Pour changer : 438 901-6606');
  });
  it('an unknown block keeps the old fallback (8 h to 12 h, no words)', () => {
    expect(whenText('{bloc}|{debut}|{fin}', { day: DAY, block: 'zz' }, BLOCKS, 'fr').vars).toMatchObject({ bloc: '', debut: '8 h', fin: '12 h' });
    expect(whenText('x', block, null, 'fr').vars).toMatchObject({ debut: '8 h', fin: '12 h' });
  });
});

describe('texts: a job with a window says « entre 14 h et 18 h »', () => {
  it('the helpers', () => {
    expect(jobWindow(win)).toEqual([840, 1080]);
    expect(jobWindow({ ...win, win_start: '840', win_end: '1080' })).toEqual([840, 1080]);
    expect(jobWindow(flex)).toBe(null);
    expect(jobWindow({ day: DAY, block: 'pm', win_start: 840, win_end: 1080 })).toBe(null);   // a block job never has one
    expect(betweenWords(840, 1080, 'fr')).toBe('entre 14 h et 18 h');
    expect(betweenWords(840, 1080, 'en')).toBe('between 2 p.m. and 6 p.m.');
    expect(betweenWords(570, 810, 'fr')).toBe('entre 9 h 30 et 13 h 30');
    expect(momentWords(win, 'fr')).toBe('entre 14 h et 18 h');
    expect(momentWords(flex, 'en')).toBe(flexWords('en'));
    expect(momentWords(block, 'fr')).toBe('l’après-midi');
  });
  it('booking, moved, reminder: the window, never a block', () => {
    expect(say(DEFAULT_TEXTS.fr.booking, win, 'fr')).toContain('est confirmé : jeudi 19 novembre, entre 14 h et 18 h.\n\nEstimation :');
    expect(say(DEFAULT_TEXTS.en.booking, win, 'en')).toContain('is confirmed: Thursday, November 19, between 2 p.m. and 6 p.m.\n\nEstimate:');
    expect(say(DEFAULT_TEXTS.fr.moved, win, 'fr')).toBe('Bonjour Julie, votre rendez-vous avec H.I.S a changé : jeudi 19 novembre, entre 14 h et 18 h. Détails : https://x.test/c#t=abc');
    expect(say(DEFAULT_TEXTS.en.moved, win, 'en')).toBe('Hello Julie, your appointment with H.I.S has changed: Thursday, November 19, between 2 p.m. and 6 p.m. Details: https://x.test/c#t=abc');
    expect(say(DEFAULT_TEXTS.fr.reminder, win, 'fr')).toBe('Rappel : H.I.S vient demain, jeudi 19 novembre, entre 14 h et 18 h. Pour changer : 438 901-6606');
    expect(say(DEFAULT_TEXTS.en.reminder, win, 'en')).toBe('Reminder: H.I.S comes tomorrow, Thursday, November 19, between 2 p.m. and 6 p.m. To change: 438 901-6606');
    for (const lang of ['fr', 'en'] as const) for (const kind of ['booking', 'moved', 'reminder'] as const) {
      expect(say(DEFAULT_TEXTS[lang][kind], win, lang).split('\n')[0]).not.toMatch(/matin|après-midi|soir|morning|afternoon|evening|\(|, ,|,\.|\.\./);
    }
  });
  it('a garage’s own text: {bloc} alone becomes the window; {bloc} beside the hours goes away', () => {
    expect(say('RDV {jour}, {bloc}. {lien}', win, 'fr')).toBe('RDV jeudi 19 novembre, entre 14 h et 18 h. https://x.test/c#t=abc');
    expect(say('RDV {jour} {bloc}, de {debut} à {fin}.', win, 'fr')).toBe('RDV jeudi 19 novembre, de 14 h à 18 h.');
    expect(say('{bloc}, {jour} : {debut}-{fin}', win, 'en')).toBe('Thursday, November 19 : 2 p.m.-6 p.m.');
  });
});

describe('texts: a flexible job says « dans la journée ; nous vous confirmons la veille une plage de 4 heures »', () => {
  it('booking, moved, reminder in both languages', () => {
    expect(say(DEFAULT_TEXTS.fr.booking, flex, 'fr')).toContain('est confirmé : jeudi 19 novembre, dans la journée ; nous vous confirmons la veille une plage de 4 heures.\n\nEstimation :');
    expect(say(DEFAULT_TEXTS.en.booking, flex, 'en')).toContain('is confirmed: Thursday, November 19, during the day; we confirm a 4-hour window the day before.\n\nEstimate:');
    expect(say(DEFAULT_TEXTS.fr.moved, flex, 'fr')).toBe('Bonjour Julie, votre rendez-vous avec H.I.S a changé : jeudi 19 novembre, dans la journée ; nous vous confirmons la veille une plage de 4 heures. Détails : https://x.test/c#t=abc');
    expect(say(DEFAULT_TEXTS.en.moved, flex, 'en')).toBe('Hello Julie, your appointment with H.I.S has changed: Thursday, November 19, during the day; we confirm a 4-hour window the day before. Details: https://x.test/c#t=abc');
    expect(say(DEFAULT_TEXTS.fr.reminder, flex, 'fr')).toContain('jeudi 19 novembre, dans la journée ; nous vous confirmons la veille une plage de 4 heures. Pour changer');
    for (const lang of ['fr', 'en'] as const) for (const kind of ['booking', 'moved', 'reminder'] as const) {
      expect(say(DEFAULT_TEXTS[lang][kind], flex, lang).split('\n')[0]).not.toMatch(/matin|après-midi|soir|morning|afternoon|evening|entre|between|\(|, ,/);
    }
  });
  it('a \'day\' job with neither a window nor « flexible » is said the same way; the words are said once', () => {
    expect(say(DEFAULT_TEXTS.fr.moved, { day: DAY, block: 'day' }, 'fr')).toContain('dans la journée ; nous vous confirmons');
    const out = say('{jour}, {bloc}, de {debut} à {fin}.', flex, 'fr');
    expect(out.match(/dans la journée/g)).toHaveLength(1);
  });
});

describe('texts: the kind « window » (a flexible booking just got its window)', () => {
  it('the starting text in both languages', () => {
    expect(say(WINDOW_TEXT.fr, win, 'fr')).toBe('Bonjour Julie, votre plage d’arrivée est confirmée : H.I.S vient jeudi 19 novembre, entre 14 h et 18 h. Pour changer : 438 901-6606');
    expect(say(WINDOW_TEXT.en, win, 'en')).toMatch(/^Hello Julie, your arrival window is confirmed: H\.I\.S comes on .*between 2 p\.m\. and 6 p\.m\.? To change: /);
  });
  it('{plage} is the hours in words for every job', () => {
    expect(say('{jour}, {plage}.', block, 'fr')).toBe('jeudi 19 novembre, entre 12 h et 16 h.');
    expect(say('{jour}, {plage}.', win, 'fr')).toBe('jeudi 19 novembre, entre 14 h et 18 h.');
    expect(say('{jour}, {plage}.', win, 'en')).toBe('Thursday, November 19, between 2 p.m. and 6 p.m.');
    expect(say('{jour}, {plage}.', flex, 'fr')).toBe('jeudi 19 novembre, dans la journée ; nous vous confirmons la veille une plage de 4 heures.');
  });
  it('the settings screen’s own text for this kind is filled entirely by the server’s words', () => {
    const d = DEFAULT_TEXTS as unknown as Record<'fr' | 'en', Record<string, string | undefined>>;
    for (const lang of ['fr', 'en'] as const) {
      const out = say(d[lang].window ?? WINDOW_TEXT[lang], win, lang);
      expect(out).not.toMatch(/[{}]/);
      expect(out).toContain(betweenWords(840, 1080, lang).replace(/\.$/, ''));
      expect(out).not.toMatch(/\.\./);
    }
  });
});
