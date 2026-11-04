import { describe, it, expect, beforeEach, vi } from 'vitest';
import { yearsList, makeName, parseModels, mergeModels, modelsFor, VPIC } from './carModels';
import { engineRef } from './engineRef';

const answer = (make: string, models: string[]) => ({ Count: models.length, Results: models.map((m) => ({ Make_Name: make, Model_Name: m })) });

describe('Année → Marque → Modèle', () => {
  beforeEach(() => {
    localStorage.clear();
    engineRef.value = { status: 'ready', rows: [
      { make: 'Toyota', model: 'Corolla', aliases: [], year_from: 2012, year_to: 2026, displacement: 1.8, cylinders: 4, turbo: false, fuel: 'gas', engine: '', oil_l: 4.4, oil_visc: '0W-20', oil_filter: '', drain_torque: '', coolant: '', trans: '', brake: '', plugs: '' },
      { make: 'Toyota', model: 'Matrix', aliases: [], year_from: 2012, year_to: 2014, displacement: 1.8, cylinders: 4, turbo: false, fuel: 'gas', engine: '', oil_l: 4.4, oil_visc: '', oil_filter: '', drain_torque: '', coolant: '', trans: '', brake: '', plugs: '' }
    ] };
  });
  it('lists next year’s models down to 1980', () => {
    const y = yearsList(2026);
    expect(y[0]).toBe(2027);
    expect(y[y.length - 1]).toBe(1980);
  });
  it('writes the make our way', () => {
    expect(makeName('MERCEDES-BENZ')).toBe('Mercedes-Benz');
    expect(makeName('ram')).toBe('RAM');
    expect(makeName('  Lada ')).toBe('Lada');
  });
  it('keeps the models of that make only, once each, sorted', () => {
    const r = parseModels([answer('TOYOTA', ['RAV4', 'Camry', 'Corolla']), answer('TOYOTA', ['Corolla', 'Tacoma']), answer('TOYOTA-LIFT', ['8FGU25']), null], 'Toyota');
    expect(r).toEqual(['Camry', 'Corolla', 'RAV4', 'Tacoma']);
    expect(mergeModels(['Civic'], ['CR-V', 'civic'])).toEqual(['Civic', 'CR-V']);
  });
  it('asks NHTSA for cars, SUVs/minivans and pickups of that year, then keeps the list on the phone', async () => {
    const seen: string[] = [];
    const f = vi.fn(async (url: string) => {
      seen.push(url);
      const type = url.split('/vehicletype/')[1].split('?')[0];
      const models = type === 'car' ? ['Camry', 'Prius'] : type === 'mpv' ? ['RAV4', 'Highlander'] : ['Tacoma'];
      return new Response(JSON.stringify(answer('TOYOTA', models)), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await modelsFor('Toyota', 2013, f);
    expect(seen).toHaveLength(3);
    expect(seen[0]).toBe(`${VPIC}/GetModelsForMakeYear/make/toyota/modelyear/2013/vehicletype/car?format=json`);
    expect(r.complete).toBe(true);
    // the engine list's models of that year are added (Corolla, Matrix in 2013)
    expect(r.models).toEqual(['Camry', 'Corolla', 'Highlander', 'Matrix', 'Prius', 'RAV4', 'Tacoma']);
    const again = await modelsFor('Toyota', 2013, vi.fn() as unknown as typeof fetch);
    expect(again.models).toContain('Tacoma');
  });
  it('without signal: the common models of the engine list, marked as a short list', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const r = await modelsFor('Toyota', 2019, f);
    expect(r.complete).toBe(false);
    expect(r.models).toEqual(['Corolla']);
    const old = await modelsFor('Toyota', 1999, f);
    expect(old.models).toEqual(['Corolla', 'Matrix']);   // nothing that year: every model of the make
  });
});
