import { describe, it, expect, afterEach } from 'vitest';
import { parseMoney } from './money';
import { lang, setLang } from './i18n';

/* review lt-2: the money field (ui/forms MoneyInput) calls parseMoney(s) without a language. The team member's language
   decides: « 1,000 » is a thousand in English (as before the rebuild) and a slip in French (core-data-20). */
afterEach(() => setLang('fr'));

describe('an amount typed without a language follows the language of the app', () => {
  it('in English, « 1,000 » and « $1,250 » are thousands', () => {
    setLang('en');
    expect(lang.value).toBe('en');
    expect(parseMoney('1,000')).toBe(100000);
    expect(parseMoney('$1,250')).toBe(125000);
    expect(parseMoney('59,999')).toBe(5999900);
    expect(parseMoney('1.000')).toBeNull();
  });
  it('in French, « 59,999 » and « 1,000 » are still refused', () => {
    setLang('fr');
    expect(parseMoney('59,999')).toBeNull();
    expect(parseMoney('1,000')).toBeNull();
  });
  it('the language follows each change, and a language given by the caller wins', () => {
    setLang('en');
    expect(parseMoney('1,000')).toBe(100000);
    expect(parseMoney('1,000', 'fr')).toBeNull();
    setLang('fr');
    expect(parseMoney('1,000')).toBeNull();
    expect(parseMoney('1,000', 'en')).toBe(100000);
  });
  it('amounts with decimals read the same in both languages (the receipt reader)', () => {
    for (const l of ['fr', 'en'] as const) {
      setLang(l);
      expect(parseMoney('59,99')).toBe(5999);
      expect(parseMoney('59.99')).toBe(5999);
      expect(parseMoney('1,234.56')).toBe(123456);
      expect(parseMoney('1 234,56')).toBe(123456);
      expect(parseMoney('1.234,50')).toBe(123450);
    }
  });
});
