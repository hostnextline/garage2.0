import { describe, it, expect } from 'vitest';
import { bestPlace, placeNewStop, stopRank, moveStops, NEW_STOP } from './preview';
import type { TeamMapAnswer } from '../map/assemble';

// the Centrale, then stops going east along a line; the new one between two of them
const home = { lat: 45.5, lng: -73.70 };
const job = (id: string, truck: string, block: string, order: number, lng: number) =>
  ({ id, number: Number(id.replace(/\D/g, '')) || 1, truck_id: truck, order, eta_min: null, status: 'booked', block, name: id, address: '', lat: 45.5, lng });
const day: TeamMapAnswer = {
  home: { ...home, label: 'Centrale', address: '' },
  trucks: [{ id: 'T1', name: 'Camion 1', color: null, driver_id: null }, { id: 'T2', name: 'Camion 2', color: null, driver_id: null }],
  jobs: [job('a1', 'T1', 'am', 1, -73.68), job('a2', 'T1', 'am', 2, -73.60), job('p1', 'T1', 'pm', 1, -73.50), job('far', 'T2', 'pm', 1, -73.20)],
  people: [], trips: []
};

describe('« Voir sur la carte »: where the new appointment goes in the truck’s day', () => {
  it('between the two stops it sits between, in its own block', () => {
    const r = bestPlace(home, day.jobs.filter((j) => j.truck_id === 'T1'), { block: 'am', lat: 45.5, lng: -73.64 });
    expect(r.index).toBe(1);
    expect(r.extraKm).toBeLessThan(0.1);
  });
  it('never in another block: an afternoon appointment comes after the morning, even closer to it', () => {
    const r = bestPlace(home, day.jobs.filter((j) => j.truck_id === 'T1'), { block: 'pm', lat: 45.5, lng: -73.69 });
    expect(r.index).toBeGreaterThanOrEqual(2);
  });
  it('the truck said by the suggestion; its stops numbered with the new one in its place', () => {
    const p = placeNewStop(day, { day: '2026-11-17', block: 'am', truckId: 'T1', lat: 45.5, lng: -73.64, name: 'Nouveau', address: '' });
    expect(p.truckId).toBe('T1');
    const t1 = p.after.jobs.filter((j) => j.truck_id === 'T1').sort((a, b) => a.order! - b.order!).map((j) => j.id);
    expect(t1).toEqual(['a1', NEW_STOP, 'a2', 'p1']);
    expect(p.before.jobs.some((j) => j.id === NEW_STOP)).toBe(false);
    expect(p.after.jobs.find((j) => j.id === 'far')?.order).toBe(1);   // the other truck is left as it is
  });
  it('no truck said: the one where it adds the least driving', () => {
    const p = placeNewStop(day, { day: '2026-11-17', block: 'pm', truckId: null, lat: 45.5, lng: -73.21, name: 'Nouveau', address: '' });
    expect(p.truckId).toBe('T2');
    expect(p.extraKm).toBeLessThan(1);   // on its way to its stop: almost nothing more
  });
});

describe('the stop number said on a moment offered', () => {
  const spot = { day: '2026-11-17', name: 'Nouveau', address: '', lat: 45.5 };
  it('second of four when it sits between the two morning stops', () => {
    expect(stopRank(day, { ...spot, block: 'am', truckId: 'T1', lng: -73.64 })).toEqual({ n: 2, total: 4 });
  });
  it('an evening appointment comes last', () => {
    expect(stopRank(day, { ...spot, block: 'eve', truckId: 'T1', lng: -73.69 })).toEqual({ n: 4, total: 4 });
  });
  it('first and alone on a route with nothing yet; nothing said when no vehicle works', () => {
    expect(stopRank({ ...day, jobs: [] }, { ...spot, block: 'am', truckId: 'T2', lng: -73.64 })).toEqual({ n: 1, total: 1 });
    expect(stopRank({ ...day, trucks: [], jobs: [] }, { ...spot, block: 'am', truckId: null, lng: -73.64 })).toBeNull();
  });
});

describe('« La voiture ferme »: its appointments on the other vehicle', () => {
  it('each goes to its own block of the other route, at the cheapest place; the route is numbered again', () => {
    const r = moveStops(day, ['far'], 'T1');
    const t1 = r.jobs.filter((j) => j.truck_id === 'T1').sort((a, b) => a.order! - b.order!);
    expect(t1.map((j) => j.id)).toEqual(['a1', 'a2', 'p1', 'far']);
    expect(t1.map((j) => j.order)).toEqual([1, 2, 3, 4]);
    expect(r.jobs.some((j) => j.truck_id === 'T2')).toBe(false);
  });
  it('a morning one never lands after the afternoon; one already there stays', () => {
    const r = moveStops(day, ['a1', 'a2', 'p1'], 'T2');
    expect(r.jobs.filter((j) => j.truck_id === 'T2').sort((a, b) => a.order! - b.order!).map((j) => j.block)).toEqual(['am', 'am', 'pm', 'pm']);
    expect(moveStops(day, ['far'], 'T2')).toEqual(day);
  });
});
