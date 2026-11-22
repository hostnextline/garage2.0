import { describe, it, expect } from 'vitest';
import { teamMarkers, teamLines, fitIds, dimTruck, type MapUi } from './layers';
import { assemble } from './assemble';

const m = assemble({
  home: { lat: 45.5, lng: -73.65, label: 'Centrale', address: '1401 rue Legendre' },
  trucks: [{ id: 't1', name: 'Camion', color: '#D3000E', driver_id: 'u1', start: { lat: 45.56, lng: -73.7, label: 'Chez Saleh', address: null } }, { id: 't2', name: 'Voiture', color: '#2F6FD0', driver_id: 'u2' }],
  jobs: [
    { id: 'a', number: 1, truck_id: 't1', order: 1, eta_min: 540, status: 'done', block: 'am', name: 'Julie', address: null, lat: 45.51, lng: -73.61 },
    { id: 'b', number: 2, truck_id: 't1', order: 2, eta_min: 600, status: 'booked', block: 'am', name: 'Marc', address: null, lat: 45.52, lng: -73.62 },
    { id: 'c', number: 3, truck_id: 't2', order: 1, eta_min: 600, status: 'booked', block: 'am', name: 'Sophie', address: null, lat: 45.53, lng: -73.63 },
    { id: 'x', number: 4, truck_id: null, order: null, eta_min: null, status: 'booked', block: 'pm', name: 'Kevin', address: null, lat: 45.54, lng: -73.64 }
  ],
  people: [{ id: 'u2', name: 'Adam', color: null, lat: 45.5, lng: -73.6, at: '2026-11-16T15:00:00Z', job_id: 'c' }],
  trips: []
});
const ui = (o: Partial<MapUi> = {}): MapUi => ({ selected: null, focus: null, pan: null, now: Date.parse('2026-11-16T15:20:00Z'), onChoose: () => undefined, road: (l) => l.points, ...o });

describe('what the team map draws', () => {
  it('the start, each truck’s own start, the stops numbered, « À placer » with a ?, the people', () => {
    const ids = teamMarkers(m, ui()).map((x) => x.id);
    expect(ids).toEqual(['home', 'start-t1', 'a', 'b', 'c', 'x', 'p:u2']);
    const x = teamMarkers(m, ui()).find((k) => k.id === 'x')!;
    expect(x.number).toBe('?');
  });
  it('a position 20 minutes old is faded and says « Dernière position … »', () => {
    const p = teamMarkers(m, ui()).find((k) => k.id === 'p:u2')!;
    expect(p.dim).toBe(true);
    expect(p.sub).toMatch(/20 min/);
    expect(p.sub).not.toBe(teamMarkers(m, ui({ now: Date.parse('2026-11-16T15:01:00Z') })).find((k) => k.id === 'p:u2')!.sub);
  });
  it('the stop chosen is labelled; one truck seen alone fades the others and their routes', () => {
    const mk = teamMarkers(m, ui({ selected: 'b', focus: 't1' }));
    expect(mk.find((k) => k.id === 'b')).toMatchObject({ active: true, label: 'Marc', sub: 'Camion' });
    expect(mk.find((k) => k.id === 'c')!.dim).toBe(true);
    const lines = teamLines(m, ui({ focus: 't1' }));
    expect(lines.filter((l) => l.color === '#2F6FD0').every((l) => l.opacity === 0.14)).toBe(true);
    expect(dimTruck(m, 'unplaced', 't1')).toBe(true);
    expect(dimTruck(m, null, 't1')).toBe(false);
  });
  it('the view fits the stop chosen in the list, the truck seen alone with the person driving it today, or everyone', () => {
    expect(fitIds(m, { focus: null, pan: 'b' })).toEqual(['b']);
    expect(fitIds(m, { focus: 't2', pan: null })).toEqual(['c', 'p:u2']);
    expect(fitIds(m, { focus: 'unplaced', pan: null })).toEqual(['x']);
    expect(fitIds(m, { focus: null, pan: null })).toBeNull();
  });
});
