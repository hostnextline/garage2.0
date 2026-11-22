import { describe, it, expect } from 'vitest';
import refJson from '../../../public/data/engine-ref.json';
import { parseEngineRef } from '../vehicles/engineRef';
import { weekNeeds, itemsToCreate, type NeedsInput, type NeedLine } from './needs';
import { allocateStock, matchingItems, type StockLine } from './allocate';
import type { InventoryItem, Job, JobItem, Service, ServicePart, Vehicle } from '../../data/types';

const REF = parseEngineRef(refJson);
const OIL = { id: 's-oil', name_fr: 'Changement d’huile', name_en: null, includes: [], needs: null, deleted_at: null } as unknown as Service;
const TIRES = { id: 's-tires', name_fr: 'Pneus neufs', name_en: null, includes: [], needs: [{ kind: 'tires', qty: 4 }], deleted_at: null } as unknown as Service;
const car = (id: string, extra: Partial<Vehicle>) => ({ id, year: null, make: null, model: null, cylinders: null, tire_size: null, spec_key: null, deleted_at: null, ...extra }) as unknown as Vehicle;
const stock = (id: string, name: string, qty: number, extra: Partial<InventoryItem> = {}) => ({ id, name, qty, unit: 'unité', sku: null, category: null, notes: null, active: true, deleted_at: null, ...extra }) as unknown as InventoryItem;

/** a week of one appointment per car, each with the given services */
function week(cars: [Vehicle, Service[]][], inventory: InventoryItem[], parts: ServicePart[] = [], extraItems: JobItem[] = []): NeedsInput {
  const jobs = cars.map(([v], k) => ({ id: `j${k}`, number: 1000 + k, day: `2026-11-1${k % 7}`, vehicle_id: v.id, status: 'booked', deleted_at: null }) as unknown as Job);
  const items = cars.flatMap(([, ss], k) => ss.map((s, n) => ({ id: `l${k}-${n}`, job_id: `j${k}`, service_id: s.id, item_id: null, kind: 'service', qty: 1, status: 'planned', deleted_at: null }) as unknown as JobItem)).concat(extraItems);
  const services = [OIL, TIRES];
  return {
    from: '2026-11-10', to: '2026-11-16', jobs, itemsOf: (id) => items.filter((i) => i.job_id === id),
    service: (id) => services.find((s) => s.id === id), partsOf: (id) => parts.filter((p) => p.service_id === id),
    vehicle: (id) => cars.map(([v]) => v).find((v) => v.id === id), spec: () => undefined, refRows: REF, inventory
  };
}
const total = (lines: NeedLine[], kind: string) => Math.round(lines.filter((l) => l.kind === kind).reduce((n, l) => n + l.toBuy, 0) * 100) / 100;

describe('one stock item is counted once over the whole week', () => {
  it('a Jeep (5W-20 MS-6395) and a Grand Caravan (5W-20) share 6 L: 5.3 L to buy (nothing with 12 L)', () => {
    const jeep = car('jeep', { year: 2015, make: 'Jeep', model: 'Wrangler' });
    const van = car('van', { year: 2015, make: 'Dodge', model: 'Grand Caravan' });
    const w = weekNeeds(week([[jeep, [OIL]], [van, [OIL]]], [stock('h', 'Huile 5W-20 synthétique', 6, { unit: 'L' })]));
    const oil = w.lines.filter((l) => l.kind === 'oil');
    expect(oil.map((l) => l.key).sort()).toEqual(['oil|5W-20|', 'oil|5W-20|ms6395']);
    expect(total(w.lines, 'oil')).toBe(5.3);
    // the line with the approval is served first: it has the 6 L, the plain one gets what is left
    expect(oil.find((l) => l.spec)).toMatchObject({ qty: 5.7, stock: 6, toBuy: 0 });
    expect(oil.find((l) => !l.spec)).toMatchObject({ qty: 5.6, stock: 0.3, toBuy: 5.3 });
    const enough = weekNeeds(week([[jeep, [OIL]], [van, [OIL]]], [stock('h', 'Huile 5W-20 synthétique', 12, { unit: 'L' })]));
    expect(total(enough.lines, 'oil')).toBe(0);
  });
  it('four tires with no season cover the winter line or the « any season » line, not both', () => {
    const a = car('a', { tire_size: '215/55R16' }), b = car('b', { tire_size: '215/55R16' });
    const winter = { ...TIRES, id: 's-w', needs: [{ kind: 'tires', qty: 4, season: 'winter' }] } as unknown as Service;
    const input = week([[a, [winter]], [b, [TIRES]]], [stock('p', 'Pneu 215/55R16', 4, { unit: 'pneu' })]);
    const svc = input.service;
    input.service = (id) => (id === 's-w' ? winter : svc(id));
    const w = weekNeeds(input);
    expect(w.lines.filter((l) => l.kind === 'tires').map((l) => l.key).sort()).toEqual(['tires|215/55R16|?', 'tires|215/55R16|winter']);
    expect(total(w.lines, 'tires')).toBe(4);
    expect(w.lines.find((l) => l.season === 'winter')).toMatchObject({ toBuy: 0 });
  });
  it('a part sold on the appointment and an oil filter line matching the same item share it', () => {
    const civic = car('civic', { year: 2019, make: 'Honda', model: 'Civic', spec_key: 'k' });
    const filter = stock('f', 'Filtre à huile', 1, { sku: 'PH7317' });
    const input = week([[civic, [OIL]]], [filter, stock('h', 'Huile 0W-20', 20, { unit: 'L' })], [], [
      { id: 'sold', job_id: 'j0', service_id: null, item_id: 'f', kind: 'part', qty: 1, status: 'planned', deleted_at: null } as unknown as JobItem
    ]);
    input.spec = () => ({ data: { oil_l: 4.2, oil_visc: '0W-20', oil_filter: 'PH7317' } }) as never;
    const w = weekNeeds(input);
    expect(w.lines.find((l) => l.key === 'item|f')).toMatchObject({ qty: 1, stock: 1, toBuy: 0 });
    expect(w.lines.find((l) => l.key === 'oil_filter|ph7317')).toMatchObject({ qty: 1, stock: 0, toBuy: 1 });
  });
  it('whatever the week: never less to buy than what the distinct items cannot cover', () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 16807) % 2147483647; return seed % n; };
    for (let round = 0; round < 200; round++) {
      const lines: StockLine[] = Array.from({ length: 1 + rnd(5) }, (_, k) => ({
        key: `oil|5W-30|${k % 2 ? 'x' : ''}${k}`, kind: 'oil', ref: '5W-30', spec: k % 2 ? 'X' : null, season: null, itemId: null,
        qty: 1 + rnd(9), jobs: [{ day: `2026-11-1${rnd(7)}` }], stock: null, stockItems: [], toBuy: 0, jugL: null
      }));
      const items = Array.from({ length: rnd(3) }, (_, k) => stock(`i${k}`, `Huile 5W-30 ${k ? 'X' : ''}`, rnd(8), { unit: 'L' }));
      allocateStock(lines, items);
      const need = lines.reduce((n, l) => n + l.qty, 0), have = items.reduce((n, i) => n + Number(i.qty), 0);
      const buy = lines.reduce((n, l) => n + l.toBuy, 0);
      expect(buy).toBeGreaterThanOrEqual(Math.round((need - have) * 100) / 100 - 1e-9);
      expect(buy).toBeLessThanOrEqual(need + 1e-9);
    }
  });
});

describe('stock found by the exact grade', () => {
  const line = (ref: string): StockLine => ({ key: `oil|${ref}|`, kind: 'oil', ref, spec: null, season: null, itemId: null, qty: 5, jobs: [], stock: null, stockItems: [], toBuy: 0, jugL: null });
  it('20 L of 15W-40 diesel is not 5W-40; 10W-30 is not 0W-30; a note does not make an oil', () => {
    const inv = [stock('d', 'Huile 15W-40 diesel', 20, { unit: 'L' }), stock('t', 'Huile 10W-30', 8, { unit: 'L' }), stock('n', 'Huile 5W-20', 4, { unit: 'L', notes: 'remplace la 5W-30' })];
    expect(matchingItems(line('5W-40'), inv)).toEqual([]);
    expect(matchingItems(line('0W-30'), inv)).toEqual([]);
    expect(matchingItems(line('5W-30'), inv)).toEqual([]);
    const l = line('5W-40');
    allocateStock([l], inv);
    expect(l).toMatchObject({ stock: null, toBuy: 5 });
    expect(matchingItems(line('15W-40'), inv).map((i) => i.id)).toEqual(['d']);
  });
});

describe('« Ajouter à l’inventaire » only when the stock has nothing for the line', () => {
  it('a jug with no litres counts nothing, but is not offered again at every tap', () => {
    const golf = car('g', { year: 2015, make: 'Volkswagen', model: 'Golf' });
    const jug = stock('c', 'Huile 5W-40 Castrol', 6, { unit: 'bidon', category: 'Huile' });
    const w = weekNeeds(week([[golf, [OIL]]], [jug]));
    const oil = w.lines.find((l) => l.kind === 'oil')!;
    expect(oil).toMatchObject({ stock: null, stockItems: ['c'], toBuy: 5.7 });
    expect(itemsToCreate(w.lines, (l) => String(l.ref), (k) => k).filter((i) => i.category === 'oil')).toEqual([]);
    // with nothing in the stock it is offered
    const none = weekNeeds(week([[golf, [OIL]]], []));
    expect(itemsToCreate(none.lines, (l) => String(l.ref), (k) => k).map((i) => i.name)).toContain('5W-40');
  });
  it('the items whose size is known count, the others are only listed', () => {
    const golf = car('g', { year: 2015, make: 'Volkswagen', model: 'Golf' });
    const w = weekNeeds(week([[golf, [OIL]]], [stock('c', 'Huile 5W-40 Castrol', 6, { unit: 'bidon' }), stock('l', 'Huile 5W-40', 2, { unit: 'L' })]));
    expect(w.lines.find((l) => l.kind === 'oil')).toMatchObject({ stock: 2, stockItems: ['c', 'l'], toBuy: 3.7 });
  });
});
