import { describe, it, expect, beforeEach } from 'vitest';
import { lang } from '../../lib/i18n';
import { rangeError, limitError, parseNum, fmtNum } from './checks';

beforeEach(() => { lang.value = 'fr'; });

describe('settings: numbers typed in a form', () => {
  it('reads a comma or a point, spaces ignored; empty is nothing, words are not a number', () => {
    expect(parseNum(' 1,5 ')).toBe(1.5);
    expect(parseNum('1 000')).toBe(1000);
    expect(parseNum('')).toBeNull();
    expect(Number.isNaN(parseNum('abc'))).toBe(true);
    expect(fmtNum(1.5, 'fr')).toBe('1,5');
    expect(fmtNum(1.5, 'en')).toBe('1.5');
    expect(fmtNum(null, 'fr')).toBe('');
  });
  it('a range: missing, too small or too big is said', () => {
    expect(rangeError(35, 10, 110)).toBeNull();
    expect(rangeError(null, 10, 110)).toBe('Écris un nombre.');
    expect(rangeError(5, 10, 110)).toBe('Entre 10 et 110.');
  });
  it('a limit that 0 switches off: 0 is fine (settings-team-10)', () => {
    expect(limitError(0, 10, 120)).toBeNull();
    expect(limitError(35, 10, 120)).toBeNull();
    expect(limitError(5, 10, 120)).toContain('0');
    expect(limitError(null, 10, 120)).toContain('10');
  });
});
