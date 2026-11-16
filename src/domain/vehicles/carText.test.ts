import { describe, it, expect } from 'vitest';
import { km, parseKm, engineLine, refCode, refLine, sampleNumber } from './carText';
import type { EngineRow } from './engineRef';

describe('kilometres', () => {
  it('written the person’s way', () => {
    expect(km(84200, 'fr').replace(/\s/g, ' ')).toBe('84 200 km');
    expect(km(84200, 'en')).toBe('84,200 km');
    expect(km(null, 'fr')).toBe('');
  });
  it('read back', () => {
    expect(parseKm('84 200')).toBe(84200);
    expect(parseKm('84,200 km')).toBe(84200);
    expect(parseKm('84.200')).toBe(84200);
    expect(parseKm(km(84200, 'fr'))).toBe(84200);
    expect(parseKm('')).toBeNull();
    expect(Number.isNaN(parseKm('beaucoup'))).toBe(true);
  });
  it('a decimal is rounded, never read ten times too big; a space at the end is fine (customers-b-17)', () => {
    expect(parseKm('84200.5')).toBe(84201);
    expect(parseKm('84200,4')).toBe(84200);
    expect(parseKm('84.2')).toBe(84);
    expect(parseKm('84200 km ')).toBe(84200);
    expect(parseKm(' 84200 ')).toBe(84200);
  });
});

describe('the engine in words', () => {
  const row = (engine: string, over: Partial<EngineRow> = {}): EngineRow => ({ make: 'Honda', model: 'Civic', aliases: [], year_from: 2016, year_to: 2021, displacement: 1.5,
    cylinders: 4, turbo: true, fuel: 'gas', engine, oil_l: 3.5, oil_visc: '0W-20', oil_filter: '', drain_torque: '', coolant: '', trans: '', brake: '', plugs: '', ...over });
  it('the line', () => {
    expect(engineLine({ displacement: 2, cylinders: 4, turbo: true, code: 'K20C2' })).toBe('2.0 L 4 cyl. turbo (K20C2)');
    expect(engineLine({ displacement: 1.8, fuel: 'hybrid', code: 'In-Line' }, { turbo: 't', hybrid: 'hybrid', diesel: 'd' })).toBe('1.8 L hybrid');
  });
  it('the code of a line of the list', () => {
    expect(refCode(row('1.5T (L15B7)'))).toBe('L15B7');
    expect(refCode(row('LFX'))).toBe('');
    expect(refCode(row('K20C2'))).toBe('K20C2');
    expect(refLine(row('1.5T (L15B7)'))).toBe('1.5 L 4 cyl. turbo (L15B7)');
  });
  it('an example number', () => {
    expect(sampleNumber(4.2, 1, 'fr')).toBe('4,2');
    expect(sampleNumber(4.2, 1, 'en')).toBe('4.2');
  });
});
