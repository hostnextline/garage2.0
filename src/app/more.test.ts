import { describe, it, expect } from 'vitest';
import { filtersFor, tilesFor, dayCounts, dueCents, unpaidCount, ratio, TILE_HUE, type Tileable } from './more';

const owner: Tileable[] = [
  { key: 'today', group: 'day' }, { key: 'agenda', group: 'day' }, { key: 'customers', group: 'office' },
  { key: 'invoices', group: 'office' }, { key: 'hours', group: 'garage' }, { key: 'guide', group: 'garage' }
];

describe('« Plus »: the tiles and the filters', () => {
  it('shows « Tout » and only the groups that have a tile', () => {
    expect(filtersFor(owner)).toEqual(['all', 'day', 'office', 'garage']);
    expect(filtersFor(owner.filter((i) => i.group !== 'office'))).toEqual(['all', 'day', 'garage']);
    // everything in one group: no filters at all
    expect(filtersFor([{ key: 'today', group: 'day' }, { key: 'agenda', group: 'day' }])).toEqual([]);
  });
  it('a filter keeps the order of the menu; a filter with nothing in it shows everything', () => {
    expect(tilesFor(owner, 'all').map((i) => i.key)).toEqual(['today', 'agenda', 'customers', 'invoices', 'hours', 'guide']);
    expect(tilesFor(owner, 'office').map((i) => i.key)).toEqual(['customers', 'invoices']);
    expect(tilesFor(owner.filter((i) => i.group !== 'garage'), 'garage')).toHaveLength(4);
  });
  it('every part of the app has its own colour', () => {
    const keys = ['today', 'agenda', 'map', 'customers', 'quotes', 'invoices', 'treasury', 'dashboard', 'hours', 'inventory', 'team', 'settings', 'guide'];
    for (const k of keys) expect(TILE_HUE[k]).toMatch(/^#[0-9A-F]{6}$/);
    expect(new Set(keys.map((k) => TILE_HUE[k])).size).toBe(keys.length);
  });
});

describe('« Plus »: today in numbers', () => {
  it('counts the jobs to start, under way and finished (not the cancelled ones)', () => {
    const jobs = ['booked', 'booked', 'en_route', 'on_site', 'done', 'cancelled', 'no_show'].map((status) => ({ status }));
    expect(dayCounts(jobs)).toEqual({ booked: 2, live: 2, done: 1 });
    expect(dayCounts([])).toEqual({ booked: 0, live: 0, done: 0 });
  });
  it('what is still owed: finished invoices only, the part not paid yet', () => {
    const inv = [
      { status: 'issued', total_cents: 10347, paid_cents: 0 },
      { status: 'issued', total_cents: 30690, paid_cents: 10000 },
      { status: 'issued', total_cents: 5000, paid_cents: 5000 },            // paid by several payments, not marked yet
      { status: 'draft', total_cents: 99999, paid_cents: 0 },               // not owed yet
      { status: 'paid', total_cents: 20000, paid_cents: 20000 },
      { status: 'void', total_cents: 15000, paid_cents: 0 },                // cancelled: never owed
      { status: 'issued', total_cents: 8000, paid_cents: 0, deleted_at: '2026-11-01T00:00:00Z' }
    ];
    expect(dueCents(inv)).toBe(10347 + 20690);
    expect(unpaidCount(inv)).toBe(2);
  });
  it('the getting-started ring stays between empty and full', () => {
    expect(ratio(4, 8)).toBe(0.5);
    expect(ratio(0, 0)).toBe(0);
    expect(ratio(9, 8)).toBe(1);
  });
});
