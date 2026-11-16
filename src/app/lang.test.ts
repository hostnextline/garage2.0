import { describe, it, expect, beforeEach } from 'vitest';
import { pickLang, showLang, storedLang } from './lang';
import { lang } from '../lib/i18n';

describe('the language of the app on this device', () => {
  beforeEach(() => { localStorage.clear(); });
  it('the person chose on this device: that one, whatever the account says', () => {
    expect(pickLang({ stored: 'en', account: 'fr', guess: 'fr' })).toBe('en');
  });
  it('no choice on this device: the account’s language (old logic kept the phone’s guess for ever)', () => {
    expect(pickLang({ stored: null, account: 'fr', guess: 'en' })).toBe('fr');
    expect(pickLang({ stored: null, account: 'en', guess: 'fr' })).toBe('en');
  });
  it('nothing known: the phone’s guess', () => {
    expect(pickLang({ stored: null, account: null, guess: 'en' })).toBe('en');
    expect(pickLang({ stored: null, account: 'es', guess: 'fr' })).toBe('fr');
  });
  it('showing a language never writes it down (a written guess looked like a choice)', () => {
    showLang('en');
    expect(lang.value).toBe('en');
    expect(document.documentElement.lang).toBe('en-CA');
    expect(storedLang()).toBeNull();
    showLang('fr');
  });
});
