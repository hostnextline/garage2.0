import { describe, it, expect } from 'vitest';
import { plannedPartsOf, stepQty, qtyStep, qtyFloor } from './parts';

const items: Record<string, { id: string; name: string; unit: string; qty: number; deleted_at: string | null }> = {
  oil: { id: 'oil', name: 'Huile 5W-30', unit: 'L', qty: 20, deleted_at: null },
  filter: { id: 'filter', name: 'Filtre PH7317', unit: 'unité', qty: 5, deleted_at: null },
  gone: { id: 'gone', name: 'Ancien', unit: 'unité', qty: 1, deleted_at: '2026-11-01' }
};
const partsOf = (s: string) => (s === 'vidange' ? [{ item_id: 'oil', qty: 4.5 }, { item_id: 'filter', qty: 1 }] : s === 'old' ? [{ item_id: 'gone', qty: 1 }] : []);
const line = (x: Partial<{ item_id: string | null; service_id: string | null; qty: number; status: string; deleted_at: string | null }>) =>
  ({ item_id: null, service_id: null, qty: 1, status: 'planned', deleted_at: null, ...x }) as never;

describe('the parts a job takes', () => {
  it('adds the service’s parts times the line’s quantity, plus the lines that are items', () => {
    const got = plannedPartsOf([line({ service_id: 'vidange' }), line({ item_id: 'filter', qty: 2 })], partsOf, (id) => items[id]);
    expect(got).toEqual([
      { item_id: 'filter', name: 'Filtre PH7317', unit: 'unité', qty: 3, onHand: 5 },
      { item_id: 'oil', name: 'Huile 5W-30', unit: 'L', qty: 4.5, onHand: 20 }
    ]);
  });
  it('skips refused or removed lines, and items that no longer exist', () => {
    const got = plannedPartsOf([line({ service_id: 'vidange', status: 'declined' }), line({ service_id: 'vidange', deleted_at: 'x' }), line({ service_id: 'old' })], partsOf, (id) => items[id]);
    expect(got).toEqual([]);
  });
  it('two lines of the same service: the quantities add up', () => {
    const got = plannedPartsOf([line({ service_id: 'vidange' }), line({ service_id: 'vidange', status: 'approved' })], partsOf, (id) => items[id]);
    expect(got.find((p) => p.item_id === 'oil')?.qty).toBe(9);
  });
});

describe('« Pièces utilisées »: the quantity buttons (jobs-b-15)', () => {
  it('half a litre for what is measured, one for the rest', () => {
    expect(qtyStep('L')).toBe(0.5);
    expect(qtyStep('kg')).toBe(0.5);
    expect(qtyStep('unité')).toBe(1);
  });
  it('a planned 4.7 L reaches 4.5, 5 and down to 0 (before: stuck between 0.2 and 4.7, never 0 nor 5)', () => {
    expect(stepQty(4.7, false, 0.5)).toBe(4.5);
    expect(stepQty(4.7, true, 0.5)).toBe(5);
    expect(stepQty(0.2, false, 0.5)).toBe(0);
    let q = 4.7;
    for (let i = 0; i < 20; i++) q = stepQty(q, false, 0.5);
    expect(q).toBe(0);
  });
  it('on the grid it moves by one step, as before', () => {
    expect(stepQty(4.5, false, 0.5)).toBe(4);
    expect(stepQty(4.5, true, 0.5)).toBe(5);
    expect(stepQty(3, true, 1)).toBe(4);
    expect(stepQty(0, false, 1)).toBe(0);
  });
  it('the floor keeps « − » offered off the grid only', () => {
    expect(qtyFloor(4.7, 0.5)).toBe(-0.5);
    expect(qtyFloor(4.5, 0.5)).toBe(0);
    expect(qtyFloor(0, 0.5)).toBe(0);
    expect(qtyFloor(2, 1)).toBe(0);
  });
});
