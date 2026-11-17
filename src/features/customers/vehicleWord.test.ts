/* R170: the words of a fuel / drive code come from the dictionaries, the code itself when they have none. */
import { describe, it, expect } from 'vitest';
import { word } from './VehicleScreen';
import { lang } from '../../lib/i18n';

describe('fuel and drive words on the car file', () => {
  it('known codes in French and English, an unknown code as it is, nothing for nothing', () => {
    lang.value = 'fr';
    expect(word('fuel', 'diesel')).toBe('Diesel');
    expect(word('drive', 'awd')).toBe('Intégrale');
    expect(word('fuel', 'hydrogene')).toBe('hydrogene');
    expect(word('drive', null)).toBeNull();
    lang.value = 'en';
    expect(word('drive', 'fwd')).not.toBe('fwd');
    lang.value = 'fr';
  });
});
