import { describe, it, expect } from 'vitest';
import type { Quote } from '../../data/types';
import { cleanItems, quoteIsEmpty, quoteExpired, defaultValidUntil, dropWhenLeft, quoteTotals, changedOnly } from './quote';
import { workMinutes } from '../moment/logic';
import { QC_TAXES } from '../../lib/money';

describe('an estimate', () => {
  it('a line typed by hand is not a service of the price list: booked, it adds no 45 minutes per unit', () => {
    const items = cleanItems([
      { _k: 'a', description: 'Valves', qty: 4, unit_cents: 500, taxable: true, kind: 'service' },
      { _k: 'b', description: 'Pneus d’hiver', qty: 4, unit_cents: 15000, taxable: true, kind: 'service', service_id: 's-pneus', duration_min: 60 },
      { _k: 'c', description: 'Rabais', qty: 1, unit_cents: 1000, taxable: true, kind: 'discount' }
    ]);
    expect(items.map((i) => i.kind)).toEqual(['labour', 'service', 'discount']);
    expect(items[1]).toMatchObject({ service_id: 's-pneus', duration_min: 60 });
    expect('_k' in items[0]).toBe(false);
    // booking counts the service's own minutes (4 × 60) and nothing for the typed line (it counted 4 × 45 more before)
    expect(workMinutes(items.map((i) => ({ ...i, kind: i.kind || 'service', service_id: i.service_id ?? null, item_id: null, duration_min: i.duration_min ?? null })) as never)).toBe(240);
  });
  it('totals: taxes always on (as the settings say), a discount lowers it', () => {
    expect(quoteTotals([{ description: 'x', qty: 1, unit_cents: 10000, taxable: true }, { description: 'r', qty: 1, unit_cents: 1000, taxable: true, kind: 'discount' }], QC_TAXES).total).toBe(10348);
    expect(quoteTotals(null, QC_TAXES).total).toBe(0);
  });
  it('empty, expired, valid until', () => {
    const empty = { items: [], contact_name: ' ', contact_phone: null, vehicle_text: null, customer_id: null, vehicle_id: null, notes: null } as unknown as Quote;
    expect(quoteIsEmpty(empty)).toBe(true);
    expect(quoteIsEmpty({ ...empty, notes: 'appeler' })).toBe(false);
    expect(quoteExpired({ valid_until: '2026-11-01', status: 'sent' }, '2026-11-15')).toBe(true);
    expect(quoteExpired({ valid_until: '2026-11-01', status: 'accepted' }, '2026-11-15')).toBe(false);
    expect(defaultValidUntil('2026-11-15')).toBe('2026-12-15');
  });
  it('left empty, it is dropped only by the one who just made it on this phone', () => {
    const row = { status: 'open', deleted_at: null } as Pick<Quote, 'status' | 'deleted_at'>;
    expect(dropWhenLeft({ madeHere: true, canEdit: true, row, empty: true })).toBe(true);
    // the office opening Adam's fresh estimate and going back must not delete it under him
    expect(dropWhenLeft({ madeHere: false, canEdit: true, row, empty: true })).toBe(false);
    expect(dropWhenLeft({ madeHere: true, canEdit: false, row, empty: true })).toBe(false);
    expect(dropWhenLeft({ madeHere: true, canEdit: true, row, empty: false })).toBe(false);
    expect(dropWhenLeft({ madeHere: true, canEdit: true, row: { ...row, status: 'sent' }, empty: true })).toBe(false);
    expect(dropWhenLeft({ madeHere: true, canEdit: true, row: undefined, empty: true })).toBe(false);
  });
});

describe('saving an estimate', () => {
  it('only the fields that changed are sent', () => {
    const base = { items: [{ description: 'a', qty: 1 }], notes: 'x', lang: 'fr' };
    expect(changedOnly({ ...base, notes: 'y' }, base)).toEqual({ notes: 'y' });
    expect(changedOnly({ ...base, items: [{ description: 'a', qty: 2 }] }, base)).toEqual({ items: [{ description: 'a', qty: 2 }] });
    expect(changedOnly({ ...base }, base)).toBeNull();
  });
});

