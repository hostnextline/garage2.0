/* « La voiture ferme » with the real roads: the other vehicle's day is the server's (move_preview), or the day as it is
   with the moved appointments apart (no number), never the phone's straight-line insertion. */
import { describe, it, expect } from 'vitest';
import { serverDay, dayAsItIs, movedPins, startOf } from './closeRoute';
import { assemble, type TeamMapAnswer } from '../../shared/map/assemble';
import { moveStops } from '../../shared/moment/preview';

const J = (id: string, truck: string, order: number | null, lat: number, lng: number, block = 'am'): TeamMapAnswer['jobs'][number] =>
  ({ id, number: Number(id.replace(/\D/g, '')) || 1, truck_id: truck, order, eta_min: null, status: 'booked', block, name: id.toUpperCase(), address: null, lat, lng });
// the truck leaves from the Centrale (west), A in the east, B further east; X (moved from the car) sits right beside the
// start: a straight line puts X FIRST, the server (real roads: a highway the other way) puts it LAST
const day: TeamMapAnswer = {
  home: { lat: 45.5, lng: -73.7, label: 'Centrale', address: '' },
  trucks: [{ id: 'car', name: 'Voiture', color: '#2F6FD0', driver_id: null }, { id: 'truck', name: 'Camion', color: '#D3000E', driver_id: null }],
  jobs: [J('a1', 'truck', 1, 45.5, -73.6), J('b2', 'truck', 2, 45.5, -73.5), J('x3', 'car', 1, 45.5, -73.69)],
  people: [], trips: []
};
const order = (a: TeamMapAnswer) => assemble(a).trucks.find((t) => t.id === 'truck')!.stops.map((s) => `${s.n}:${s.id}`);

describe('serverDay: the server’s order, numbers and arrivals', () => {
  it('numbers the stops in the order the server answered, not where a straight line puts them', () => {
    expect(order(moveStops(day, ['x3'], 'truck'))).toEqual(['1:x3', '2:a1', '3:b2']);           // the phone's guess (switch off)
    const s = serverDay(day, 'truck', { order: ['a1', 'b2', 'x3'], eta: { a1: 540, b2: 610, x3: 700 } });
    expect(order(s)).toEqual(['1:a1', '2:b2', '3:x3']);
    expect(s.jobs.find((j) => j.id === 'x3')).toMatchObject({ truck_id: 'truck', eta_min: 700 });
  });
  it('a moved appointment the server refused stays off the vehicle; a stop the answer does not list is not drawn', () => {
    const s = serverDay(day, 'truck', { order: ['b2'], eta: { b2: 600 } });
    expect(order(s)).toEqual(['1:b2']);
    expect(s.jobs.find((j) => j.id === 'x3')!.truck_id).toBe('car');
  });
  it('keeps the blocks: a morning stop the server lists after an afternoon one still comes in the morning', () => {
    const a: TeamMapAnswer = { ...day, jobs: [J('a1', 'truck', 1, 45.5, -73.6, 'pm'), J('x3', 'car', 1, 45.5, -73.69, 'am')] };
    expect(order(serverDay(a, 'truck', { order: ['x3', 'a1'], eta: {} }))).toEqual(['1:x3', '2:a1']);
  });
});

describe('while the server is asked or does not answer', () => {
  it('the day as it is, without the moved appointments; they are black pins WITHOUT a number', () => {
    expect(order(dayAsItIs(day, ['x3']))).toEqual(['1:a1', '2:b2']);
    const pins = movedPins(day, ['x3', 'nowhere']);
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ id: 'x3', kind: 'job', number: null, color: '#111827', lat: 45.5, lng: -73.69 });
  });
  it('a moved appointment without a position has no pin', () => {
    const a: TeamMapAnswer = { ...day, jobs: [{ ...J('x3', 'car', 1, 0, 0), lat: null, lng: null }] };
    expect(movedPins(a, ['x3'])).toEqual([]);
  });
  it('the start: the vehicle’s own, else « Départ des camions »', () => {
    expect(startOf(day, 'truck')).toEqual({ lat: 45.5, lng: -73.7, label: 'Centrale', own: false });
    const own: TeamMapAnswer = { ...day, trucks: [{ id: 'truck', name: 'Camion', color: null, driver_id: null, start: { lat: 45.6, lng: -73.4, label: 'Chez Saleh', address: null } }] };
    expect(startOf(own, 'truck')).toEqual({ lat: 45.6, lng: -73.4, label: 'Chez Saleh', own: true });
    expect(startOf({ ...day, home: null }, 'truck')).toBeNull();
  });
});
