import { describe, it, expect } from 'vitest';
import refJson from '../../../public/data/engine-ref.json';
import { parseEngineRef } from '../customers/engineRef';
import { oilGrade, partRef, tireSize, seasonOf, litresIn, guessNeeds, needsOf, carFacts, weekNeeds, litresPerUnit, shoppingWeek, type NeedsInput } from './needs';
import type { EngineSpec, InventoryItem, Job, JobItem, Service, ServicePart, Vehicle } from '../../data/types';

const REF = parseEngineRef(refJson);
const svc = (id: string, name_fr: string, extra: Partial<Service> = {}) => ({ id, name_fr, name_en: null, includes: [], category: 'entretien', needs: null, deleted_at: null, ...extra }) as unknown as Service;
const car = (id: string, extra: Partial<Vehicle>) => ({ id, year: null, make: null, model: null, trim: null, engine: null, displacement: null, cylinders: null, fuel: null, tire_size: null, spec_key: null, deleted_at: null, ...extra }) as unknown as Vehicle;
const job = (id: string, number: number, day: string, vehicle_id: string | null, extra: Partial<Job> = {}) => ({ id, number, day, vehicle_id, status: 'booked', deleted_at: null, ...extra }) as unknown as Job;
const line = (id: string, job_id: string, service_id: string | null, extra: Partial<JobItem> = {}) => ({ id, job_id, service_id, item_id: null, kind: 'service', qty: 1, status: 'planned', deleted_at: null, ...extra }) as unknown as JobItem;
const stock = (id: string, name: string, qty: number, extra: Partial<InventoryItem> = {}) => ({ id, name, qty, unit: 'unité', sku: null, category: null, notes: null, active: true, deleted_at: null, ...extra }) as unknown as InventoryItem;

describe('reading oil grades, part numbers, tire sizes', () => {
  it('oil grades and their approval', () => {
    expect(oilGrade('5W-40 (VW 502 00)')).toEqual({ grade: '5W-40', spec: 'VW 502 00' });
    expect(oilGrade('0w20 synthétique')).toEqual({ grade: '0W-20', spec: null });
    expect(oilGrade('SAE 10W 30')).toEqual({ grade: '10W-30', spec: null });
    expect(oilGrade('')).toEqual({ grade: null, spec: null });
  });
  it('part numbers and tire sizes', () => {
    expect(partRef('06K 115 562 (06L 115 562 B from 04/2018)')).toBe('06K 115 562');
    expect(partRef('  ')).toBeNull();
    expect(tireSize('P225/65R17')).toBe('225/65R17');
    expect(tireSize('225 65 17')).toBe('225/65R17');
    expect(tireSize('245/40 ZR 18')).toBe('245/40R18');
    expect(tireSize('pneus')).toBeNull();
  });
  it('seasons and litres in words', () => {
    expect(seasonOf('Pneus neufs d’hiver')).toBe('winter');
    expect(seasonOf('4 saisons')).toBe('all');
    expect(seasonOf('Pneus d’été')).toBe('summer');
    expect(seasonOf('Pneus neufs')).toBeNull();
    expect(litresIn('Changement d’huile (5 L)')).toBe(5);
    expect(litresIn('Bidon 4,4 L')).toBe(4.4);
    expect(litresIn('Pinte 946 ml')).toBe(0.946);
    expect(litresIn('Filtre')).toBeNull();
  });
});

describe('what a service uses', () => {
  it('guessed from the name (the garage’s real price list)', () => {
    expect(guessNeeds(svc('a', 'Changement d’huile (5 L)')).map((n) => n.kind)).toEqual(['oil', 'oil_filter']);
    expect(guessNeeds(svc('b', 'Promo : pneus montés + huile')).map((n) => n.kind)).toEqual(['oil', 'oil_filter']);
    expect(guessNeeds(svc('c', 'Pneus : montage et changement (18, 19 po)'))).toEqual([]);
    expect(guessNeeds(svc('d', 'Top up des liquides'))).toEqual([]);
    expect(guessNeeds(svc('e', 'Vente de pneus neufs d’hiver'))).toEqual([{ kind: 'tires', qty: 4, season: 'winter' }]);
    expect(guessNeeds(svc('f', 'Changement d’huile à transmission'))).toEqual([]);
    expect(guessNeeds(svc('g', 'Entretien', { includes: [{ fr: 'Huile et filtre' }, { fr: 'Filtre à air' }] })).map((n) => n.kind)).toEqual(['oil', 'oil_filter', 'air_filter']);
  });
  it('said in the settings wins (even « nothing »)', () => {
    expect(needsOf(svc('a', 'Changement d’huile', { needs: [] }))).toEqual({ needs: [], guessed: false });
    expect(needsOf(svc('a', 'Rien', { needs: [{ kind: 'wipers' }] })).needs).toEqual([{ kind: 'wipers' }]);
    expect(needsOf(svc('a', 'Changement d’huile')).guessed).toBe(true);
  });
});

describe('what is known about a car', () => {
  it('the engine sheet first, then the engine list (to confirm)', () => {
    const golf = carFacts(car('v', { year: 2015, make: 'Volkswagen', model: 'Golf' }), undefined, REF);
    expect(golf.values).toMatchObject({ oil_l: 5.7, oil_visc: '5W-40 (VW 502 00)', oil_filter: '06K 115 562 (06L 115 562 B from 04/2018)' });
    expect(golf.from.oil_visc).toBe('list');
    const sheet = { data: { oil_l: 4.2, oil_visc: '0W-20', oil_filter: 'PH7317' } } as unknown as EngineSpec;
    const civic = carFacts(car('v', { year: 2019, make: 'Honda', model: 'Civic', tire_size: '215/55R16' }), sheet, REF);
    expect(civic.values).toMatchObject({ oil_l: 4.2, oil_visc: '0W-20', oil_filter: 'PH7317', tires: '215/55R16' });
    expect(civic.from).toMatchObject({ oil_visc: 'sheet', tires: 'car' });
    expect(carFacts(undefined, undefined, REF)).toEqual({ label: '', values: {}, from: {}, cylinders: null });
  });
});

describe('the week: what the appointments take, and what to buy', () => {
  const S = {
    oil: svc('s-oil', 'Changement d’huile (5 L)'),
    promo: svc('s-promo', 'Promo : pneus montés + huile'),
    mount: svc('s-mount', 'Pneus : montage et changement (15, 16, 17 po)', { category: 'pneus' }),
    tires: svc('s-tires', 'Pneus neufs', { category: 'pneus', needs: [{ kind: 'tires', qty: 4, season: 'winter' }] }),
    wash: svc('s-wash', 'Lave-glace', { needs: [] })
  };
  const V: Record<string, Vehicle> = {
    golf: car('golf', { year: 2015, make: 'Volkswagen', model: 'Golf' }),
    civic: car('civic', { year: 2019, make: 'Honda', model: 'Civic', tire_size: '215/55R16', spec_key: 'honda|civic|2019|2.0' })
  };
  const SHEET = { key: 'honda|civic|2019|2.0', data: { oil_l: 4.2, oil_visc: '0W-20', oil_filter: 'PH7317' } } as unknown as EngineSpec;
  const PARTS: ServicePart[] = [{ id: 'sp', service_id: 's-wash', item_id: 'i-wash', qty: 2, deleted_at: null } as unknown as ServicePart];
  const jobs = [
    job('j1', 1004, '2026-11-07', 'golf'),
    job('j2', 1005, '2026-11-07', null),
    job('j3', 1006, '2026-11-09', 'civic'),
    job('j4', 1007, '2026-11-10', 'civic'),
    job('j5', 1008, '2026-11-10', 'civic', { status: 'cancelled' }),
    job('j6', 1009, '2026-11-20', 'civic'),
    job('j7', 1003, '2026-11-07', null)
  ];
  const items: Record<string, JobItem[]> = {
    j1: [line('a', 'j1', 's-oil')],
    j2: [line('b', 'j2', 's-oil')],
    j3: [line('c', 'j3', 's-tires'), line('c2', 'j3', 's-mount'), line('c3', 'j3', 's-wash')],
    j4: [line('d', 'j4', 's-promo'), line('d2', 'j4', 's-oil', { status: 'declined' })],
    j5: [line('e', 'j5', 's-oil')],
    j6: [line('f', 'j6', 's-oil')],
    j7: [line('g', 'j7', 's-mount')]
  };
  const inventory = [
    stock('i-0w20', 'Huile 0W-20 synthétique 5 L', 1, { unit: 'bidon', category: 'Huile' }),
    stock('i-ph', 'Filtre à huile', 3, { sku: 'PH7317' }),
    stock('i-tire', 'Pneu d’hiver 215/55R16', 2),
    stock('i-wash', 'Lave-glace -40', 10, { unit: 'bidon' })
  ];
  const input: NeedsInput = {
    from: '2026-11-07', to: '2026-11-13', jobs, itemsOf: (id) => items[id] || [],
    service: (id) => Object.values(S).find((s) => s.id === id), partsOf: (id) => PARTS.filter((p) => p.service_id === id),
    vehicle: (id) => (id ? V[id] : undefined), spec: (k) => (k === SHEET.key ? SHEET : undefined), refRows: REF, inventory
  };
  const w = weekNeeds(input);
  const get = (key: string) => w.lines.find((l) => l.key === key)!;

  it('only the appointments still to do that week', () => {
    expect(w.jobs).toBe(5);
    expect(w.lines.flatMap((l) => l.jobs.map((j) => j.number))).not.toContain(1008);
    expect(w.lines.flatMap((l) => l.jobs.map((j) => j.number))).not.toContain(1009);
  });
  it('oil by grade, in litres: the sheet’s 0W-20 is in stock, the Golf’s 5W-40 (to confirm) is to buy', () => {
    const civic = get('oil|0W-20|');
    expect(civic).toMatchObject({ qty: 4.2, sure: true, stock: 5, toBuy: 0, jugL: 5 });
    const golf = get('oil|5W-40|vw50200');
    expect(golf).toMatchObject({ ref: '5W-40', spec: 'VW 502 00', qty: 5.7, sure: false, stock: null, toBuy: 5.7 });
    expect(golf.jobs).toEqual([{ jobId: 'j1', number: 1004, day: '2026-11-07', car: '2015 Volkswagen Golf', qty: 5.7, sure: false }]);
  });
  it('an appointment without a car: its oil is « à confirmer » (the litres in the service’s name) and it is listed to complete', () => {
    expect(get('oil|?|')).toMatchObject({ ref: null, qty: 5, toBuy: 5 });
    expect(get('oil_filter|?')).toMatchObject({ qty: 1 });
    expect(w.missing).toEqual([{ jobId: 'j2', number: 1005, day: '2026-11-07', car: '', what: ['car'] }]);
  });
  it('oil filters by part number, compared with the stock', () => {
    expect(get('oil_filter|ph7317')).toMatchObject({ ref: 'PH7317', qty: 1, stock: 3, toBuy: 0 });
    expect(get('oil_filter|06k115562')).toMatchObject({ ref: '06K 115 562', qty: 1, stock: null, toBuy: 1 });
  });
  it('new tires by size and season; tires already mounted take nothing', () => {
    expect(get('tires|215/55R16|winter')).toMatchObject({ unit: 'tire', qty: 4, stock: 2, toBuy: 2, sure: true });
    expect(w.lines.some((l) => l.jobs.some((j) => j.number === 1003))).toBe(false);
  });
  it('the fixed parts of a service, from the stock', () => {
    expect(get('item|i-wash')).toMatchObject({ kind: 'item', qty: 2, stock: 10, toBuy: 0 });
  });
  it('declined work takes nothing; lines come oil first', () => {
    expect(get('oil|0W-20|').jobs).toHaveLength(1);
    expect(w.lines[0].kind).toBe('oil');
    expect(w.lines.at(-1)!.kind).toBe('item');
  });
});

describe('the stock and the week to prepare', () => {
  it('litres in one unit of the stock', () => {
    expect(litresPerUnit(stock('x', 'Huile 5W-30', 3, { unit: 'L' }))).toBe(1);
    expect(litresPerUnit(stock('x', 'Huile 5W-30 bidon 4,4 L', 3))).toBe(4.4);
    expect(litresPerUnit(stock('x', 'Huile 5W-30', 3))).toBeNull();
  });
  it('from Thursday, next week (it starts on Sunday); on Sunday, this one; else none', () => {
    expect(shoppingWeek('2026-11-05')).toBe('2026-11-08');   // Thursday
    expect(shoppingWeek('2026-11-07')).toBe('2026-11-08');   // Saturday
    expect(shoppingWeek('2026-11-08')).toBe('2026-11-08');   // Sunday
    expect(shoppingWeek('2026-11-09')).toBeNull();           // Monday
  });
});
