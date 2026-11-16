import { describe, it, expect, afterEach, vi } from 'vitest';
import { t, tl, tMaybe, lang, setLang, startLang, dictKeys, DICTS } from './i18n';
import type { Lang } from './i18n';
import { sameShape } from './dict-check';

afterEach(() => {
  setLang('fr');
  try { localStorage.clear(); } catch { /* jsdom always has it */ }
  window.location.hash = '';
  vi.restoreAllMocks();
});

describe('translate', () => {
  it('finds a word in the current language', () => {
    setLang('fr');
    expect(t('common.done')).toBe('Terminé');
    setLang('en');
    expect(lang.value).toBe('en');
    expect(t('common.minutes', { n: 2 })).toBe('2 minutes');
  });
  it('a given language wins over the current one (a customer\'s texts and invoice)', () => {
    setLang('fr');
    expect(tl('en', 'common.hours', { n: 3 })).toBe('3 hours');
    expect(t('common.hours', { n: 3 }, 'en')).toBe('3 hours');
  });
  // review lt-4: a language from the data that is neither (null, 'es') used to read French; it must not throw
  it('a language that is neither French nor English reads French', () => {
    const odd = ['xx', 'es', null, undefined, ''] as unknown as Lang[];
    for (const l of odd) {
      if (l === undefined) continue; // undefined is the default parameter: the current language
      expect(t('common.done', undefined, l)).toBe('Terminé');
      expect(tl(l, 'common.langs.fr')).toBe('Français');
      expect(tMaybe('common.done', undefined, l)).toBe('Terminé');
      expect(tMaybe('no.such.key', undefined, l)).toBeUndefined();
      expect(t('common.hours', { n: 1.5 }, l)).toBe(t('common.hours', { n: 1.5 }, 'fr'));
    }
    expect(t('common.done', undefined, 'en')).not.toBe('Terminé'); // English still reads English
  });
  it('replaces placeholders; a missing value leaves nothing', () => {
    expect(t('common.genericError', { msg: 'boum' }, 'fr')).toBe('Quelque chose n’a pas marché : boum');
    expect(t('common.genericError', { msg: null }, 'en')).toBe('Something went wrong: ');
    expect(t('common.genericError', undefined, 'en')).toBe('Something went wrong: {msg}');
  });
  it('plural: zero, one, other; French is singular below 2', () => {
    expect(t('customers.count', { n: 0 }, 'fr')).toBe('Aucun client');
    expect(t('customers.count', { n: 1 }, 'fr')).toBe('1 client');
    expect(t('customers.count', { n: 2 }, 'fr')).toBe('2 clients');
    expect(t('common.hours', { n: 1.5 }, 'fr')).toBe('1.5 heure');
    expect(t('common.hours', { n: 1.5 }, 'en')).toBe('1.5 hours');
    expect(t('common.hours', { n: -1 }, 'en')).toBe('-1 hour');
    // no « zero » form: 0 takes « one » in French, « other » in English
    expect(t('common.hours', { n: 0 }, 'fr')).toBe('0 heure');
    expect(t('common.hours', { n: 0 }, 'en')).toBe('0 hours');
  });
  it('a key with no words comes back as itself; tMaybe says undefined', () => {
    expect(t('nothing.here')).toBe('nothing.here');
    expect(tMaybe('nothing.here')).toBeUndefined();
    expect(tMaybe('errors.nothing_like_this', undefined, 'en')).toBeUndefined();
    expect(tMaybe('common.done', undefined, 'fr')).toBe('Terminé');
    expect(tMaybe('common.minutes', { n: 1 }, 'en')).toBe('1 minute');
  });
  it('an answer asked twice is the same (the lookup is remembered per language)', () => {
    expect(t('common.done', undefined, 'fr')).toBe(t('common.done', undefined, 'fr'));
    expect(t('common.done', undefined, 'en')).not.toBe(t('common.done', undefined, 'fr'));
  });
});

describe('the language', () => {
  it('setLang keeps the choice on the phone and tells the page', () => {
    setLang('en');
    expect(localStorage.getItem('his.lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en-CA');
    setLang('fr');
    expect(document.documentElement.lang).toBe('fr-CA');
  });
  it('at start: the saved choice first', () => {
    localStorage.setItem('his.lang', 'en');
    window.location.hash = '#/today?l=fr';
    expect(startLang()).toBe('en');
  });
  it('then « l= » in the link', () => {
    window.location.hash = '#/today?l=en';
    expect(startLang()).toBe('en');
    window.location.hash = '#t=abc&l=fr';
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-CA']);
    expect(startLang()).toBe('fr');
  });
  it('then the phone\'s language; French when it is anything else', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US', 'fr-CA']);
    expect(startLang()).toBe('en');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['es-MX']);
    expect(startLang()).toBe('fr');
  });
  it('a saved value that is not a language is ignored', () => {
    localStorage.setItem('his.lang', 'de');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-CA']);
    expect(startLang()).toBe('fr');
  });
  it('a phone where storage throws (private mode) still starts', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-CA']);
    expect(startLang()).toBe('en');
  });
});

/* i18n-13: one check over every section of both dictionaries */
describe('the two dictionaries', () => {
  it('have the same keys and the same {placeholders} everywhere (empty only where French is empty too)', () => {
    const problems = sameShape(DICTS.fr, DICTS.en).filter((p) => {
      const m = /^(.+): empty$/.exec(p);
      return !(m && dictKeys().includes(m[1]) && t(m[1], undefined, 'fr') === '');
    });
    expect(problems).toEqual([]);
  });
  it('lists every key, plural forms as one key', () => {
    const keys = dictKeys();
    expect(keys).toContain('common.done');
    expect(keys).toContain('customers.count');
    expect(keys).not.toContain('customers.count.one');
    expect(new Set(keys).size).toBe(keys.length);
  });
});
