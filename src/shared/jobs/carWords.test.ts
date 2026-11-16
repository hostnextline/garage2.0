import { describe, it, expect } from 'vitest';
import { carLine, oilLine, workLines } from './carWords';
import { jobs as fr } from '../../i18n/fr/jobs';
import { jobs as en } from '../../i18n/en/jobs';

describe('« Le véhicule d’abord »', () => {
  it('the car in one line, the engine under it', () => {
    expect(carLine({ year: 2015, make: 'Volkswagen', model: 'Golf', trim: null, engine: 'TSI', displacement: 1.8, cylinders: 4 })).toEqual({ name: '2015 Volkswagen Golf', detail: '1.8 L TSI, 4 cyl.' });
    expect(carLine({ year: null, make: 'Honda', model: 'Civic', trim: null, engine: null, displacement: null, cylinders: null })).toEqual({ name: 'Honda Civic', detail: '' });
    expect(carLine(undefined)).toEqual({ name: '', detail: '' });
  });
  it('the oil: grade, litres, filter; « à confirmer » when it comes from the engine list', () => {
    const sure = oilLine({ label: '', cylinders: 4, values: { oil_visc: '5W-30', oil_l: 4.5, oil_filter: 'PH7317' }, from: { oil_visc: 'sheet', oil_l: 'sheet', oil_filter: 'sheet' } }, 'fr');
    expect(sure).toMatchObject({ known: true, toConfirm: false });
    expect(sure.main).toContain('5W-30');
    expect(sure.sub).toContain('4,5 L');
    expect(sure.sub).toContain('PH7317');
    expect(oilLine({ label: '', cylinders: null, values: { oil_visc: '0W-20' }, from: { oil_visc: 'list' } }, 'fr').toConfirm).toBe(true);
    expect(oilLine({ label: '', cylinders: null, values: {}, from: {} }, 'fr')).toMatchObject({ known: false, sub: '', missing: ['grade', 'litres', 'filter'] });
    // what is not known is said, so it gets filled in
    expect(sure.missing).toEqual([]);
    expect(oilLine({ label: '', cylinders: null, values: { oil_visc: '5W-30', oil_l: 4.4 }, from: { oil_visc: 'sheet', oil_l: 'sheet' } }, 'fr').missing).toEqual(['filter']);
  });
  it('the work: what is planned or accepted, not the declined ones nor the discounts; else the problem', () => {
    const items = [
      { description: 'Changement d’huile', status: 'planned', kind: 'service', qty: 1, deleted_at: null },
      { description: 'Pneus d’hiver', status: 'approved', kind: 'part', qty: 4, deleted_at: null },
      { description: 'Essuie-glaces', status: 'declined', kind: 'part', qty: 1, deleted_at: null },
      { description: 'Rabais', status: 'planned', kind: 'discount', qty: 1, deleted_at: null }
    ] as never[];
    expect(workLines(items, 'bruit')).toEqual(['Changement d’huile', '4 × Pneus d’hiver']);
    expect(workLines([], ' Bruit au freinage ')).toEqual(['Bruit au freinage']);
  });
  it('every word exists in French and English', () => {
    expect(Object.keys(en.carFirst).sort()).toEqual(Object.keys(fr.carFirst).sort());
  });
});
