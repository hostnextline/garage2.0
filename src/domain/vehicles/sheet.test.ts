import { describe, it, expect, afterEach } from 'vitest';
import { upsertLocal, clearAll } from '../../data/store';
import { sheetOf } from './sheet';
import { engineButtons } from './words';
import { lang } from '../../lib/i18n';
import type { EngineChoice } from './engineRef';

afterEach(() => clearAll());
const spec = (id: string, key: string) => ({ id, key, year: 2019, make: 'Honda', model: 'Civic', engine: '2.0 L', data: { oil_l: 4.2 }, confirmed_by: null });

describe('the sheet a car shows (customers-b-06)', () => {
  it('its own first, else the one confirmed for a car alike, said as not linked', () => {
    upsertLocal('engine_specs', [spec('S1', 'honda|civic|2019|2.0'), spec('S2', 'own-key')], { force: true });
    const car = { spec_key: null, year: 2019, make: 'Honda', model: 'Civic', engine: null, displacement: 2 };
    expect(sheetOf(car)).toMatchObject({ spec: { id: 'S1' }, linked: false });
    expect(sheetOf({ ...car, spec_key: 'own-key' })).toMatchObject({ spec: { id: 'S2' }, linked: true });
    expect(sheetOf({ ...car, model: 'Accord' })).toBeNull();
    expect(sheetOf(null)).toBeNull();
  });
});

describe('the engine buttons (customers-b-20)', () => {
  const e = (key: string, oil_l: number | null, over: Partial<EngineChoice> = {}): EngineChoice =>
    ({ key, displacement: 1.5, cylinders: 4, turbo: true, fuel: 'gas', code: '1.5T', oil_visc: '0W-20', oil_filter: 'PF63', oil_l, ...over });
  it('two engines that read the same also say their litres', () => {
    lang.value = 'fr';
    const b = engineButtons([e('fwd', 4), e('awd', 5), e('2.0', 5.7, { displacement: 2 })], 'fr');
    expect(b[0].sub).toBe('huile 0W-20 (4 L), filtre PF63');
    expect(b[1].sub).toBe('huile 0W-20 (5 L), filtre PF63');
    expect(b[2].sub).toBe('huile 0W-20, filtre PF63');
    expect(b[0].title).toBe(b[1].title);
  });
});
