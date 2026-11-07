import { describe, it, expect } from 'vitest';
import { assemble, normalize, minuteOf, PALETTE, type TeamMapAnswer } from './assemble';

const HOME = { lat: 45.5005, lng: -73.6577, label: 'Centrale', address: '8255 av. Mountain Sights' };
const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };

function answer(): TeamMapAnswer {
  return {
    home: HOME,
    trucks: [
      { id: 't-complet', name: 'Camion Complet', color: '#D3000E', driver_id: 'u-saleh' },
      { id: 't-voiture', name: 'Voiture', color: null, driver_id: 'u-adam' },
      { id: 't-trois', name: 'Camion 3', color: '#1F8A53', driver_id: null }
    ],
    // given out of order on purpose: the server orders by block, then stop order
    jobs: [
      { id: 'j-5', number: 105, truck_id: 't-complet', order: 1, eta_min: 980, status: 'booked', block: 'eve', name: 'Émilie', address: '700 rue Lebeau', lat: 45.5159, lng: -73.6829 },
      { id: 'j-2', number: 102, truck_id: 't-complet', order: 2, eta_min: 590, status: 'on_site', block: 'am', name: 'Marc-André', address: '2150 boul. Thimens', lat: 45.5022, lng: -73.7094 },
      { id: 'j-1', number: 101, truck_id: 't-complet', order: 1, eta_min: 500, status: 'done', block: 'am', name: 'Julie', address: '1250 rue Graham', lat: 45.5205, lng: -73.6489 },
      { id: 'j-3', number: 103, truck_id: 't-complet', order: 1, eta_min: 735, status: 'booked', block: 'pm', name: 'Sophie', address: '5600 av. Royalmount', lat: null, lng: null },
      { id: 'j-6', number: 106, truck_id: 't-voiture', order: 1, eta_min: 640, status: 'en_route', block: 'am', name: 'Amira', address: '1400 rue Sauvé O', lat: 45.5307, lng: -73.6702 },
      { id: 'j-7', number: 107, truck_id: 't-voiture', order: 1, eta_min: 760, status: 'booked', block: 'pm', name: 'Patrick', address: '3900 boul. Décarie', lat: 45.4772, lng: -73.6213 },
      { id: 'j-x', number: 108, truck_id: null, order: null, eta_min: null, status: 'booked', block: 'pm', name: 'Kevin', address: '4800 ch. de la Côte-des-Neiges', lat: 45.4955, lng: -73.6152 }
    ],
    people: [
      { id: 'u-saleh', name: 'Saleh', color: '#B86E00', lat: 45.5022, lng: -73.7094, at: at(9, 50), job_id: 'j-2' },
      { id: 'u-adam', name: 'Adam', color: null, lat: 45.5201, lng: -73.6655, at: at(10, 20), job_id: 'j-6' }
    ],
    trips: [
      { job_id: 'j-6', staff_id: 'u-adam', eta_at: at(10, 40), km: 6.2, minutes: 14, route: [[45.5005, -73.6577], [45.512, -73.663], [45.5201, -73.6655]] }
    ]
  };
}

describe('team map: stops and routes per truck', () => {
  const m = assemble(answer(), { nameOf: (id) => ({ 'u-saleh': 'Saleh', 'u-adam': 'Adam' } as Record<string, string>)[id] || '' });

  it('keeps only the trucks that have something that day', () => {
    expect(m.trucks.map((t) => t.id)).toEqual(['t-complet', 't-voiture']);
    expect(m.count).toBe(7);
  });

  it('numbers the stops of each truck in stop order across the day (matin, après-midi, soir)', () => {
    const c = m.trucks[0];
    expect(c.stops.map((s) => [s.id, s.n])).toEqual([['j-1', 1], ['j-2', 2], ['j-3', 3], ['j-5', 4]]);
    expect(c.done).toBe(1);
    expect(c.total).toBe(4);
    expect(c.next?.id).toBe('j-2');
    expect(c.nextEta).toBe(590);
    expect(c.driverName).toBe('Saleh');
    expect(c.color).toBe('#D3000E');
  });

  it('draws the route from the Centrale through the stops, skipping a stop without a position', () => {
    const c = m.trucks[0];
    expect(c.legs).toEqual([
      { points: [[HOME.lat, HOME.lng], [45.5205, -73.6489]], kind: 'done' },
      { points: [[45.5205, -73.6489], [45.5022, -73.7094]], kind: 'todo' },
      { points: [[45.5022, -73.7094], [45.5159, -73.6829]], kind: 'todo' }
    ]);
  });

  it("uses the active trip's own route (ending at the customer) and its arrival time", () => {
    const v = m.trucks[1];
    expect(v.color).toBe(PALETTE[1]);                // no colour stored: the palette by position
    expect(v.trip?.jobId).toBe('j-6');
    expect(v.legs[0].kind).toBe('trip');
    expect(v.legs[0].points[0]).toEqual([45.5005, -73.6577]);
    expect(v.legs[0].points[v.legs[0].points.length - 1]).toEqual([45.5307, -73.6702]);   // the destination is added
    expect(v.legs[1]).toEqual({ points: [[45.5307, -73.6702], [45.4772, -73.6213]], kind: 'todo' });
    expect(v.nextEta).toBe(10 * 60 + 40);
    expect(m.trips[0].dest).toEqual([45.5307, -73.6702]);
  });

  it('a trip without a road route goes straight from the driver to the customer', () => {
    const a = answer();
    a.trips[0].route = null;
    const v = assemble(a).trucks[1];
    expect(v.legs[0]).toEqual({ points: [[45.5201, -73.6655], [45.5307, -73.6702]], kind: 'trip' });
  });

  it('puts jobs without a truck apart, and gives each person a colour and a truck', () => {
    expect(m.unplaced.map((s) => [s.id, s.n])).toEqual([['j-x', 1]]);
    expect(m.people.find((p) => p.id === 'u-saleh')).toMatchObject({ color: '#B86E00', truckId: 't-complet', name: 'Saleh' });
    expect(m.people.find((p) => p.id === 'u-adam')).toMatchObject({ color: PALETTE[1], truckId: 't-voiture' });
  });

  it('a truck whose driver is out but with no stop still shows; an empty answer gives an empty map', () => {
    const a = answer();
    a.jobs = []; a.trips = [];
    expect(assemble(a).trucks.map((t) => [t.id, t.total, t.next])).toEqual([['t-complet', 0, null], ['t-voiture', 0, null]]);
    const empty = assemble(null);
    expect(empty).toMatchObject({ home: null, trucks: [], unplaced: [], people: [], count: 0 });
  });

  it('reads a sloppy answer without throwing (numbers as text, bad positions)', () => {
    const n = normalize({ home: { lat: '45.5', lng: '-73.6' }, trucks: [{ id: 1, name: 'A' }], jobs: [{ id: 'x', lat: 'abc', lng: 3, order: '2' }], people: [{ id: 'p', lat: 200, lng: 0 }], trips: [{ job_id: 'x', route: [[1, 2], ['a', 3], 5] }] });
    expect(n.home).toMatchObject({ lat: 45.5, lng: -73.6 });
    expect(n.trucks[0].id).toBe('1');
    expect(n.jobs[0]).toMatchObject({ lat: null, order: 2 });
    expect(n.people).toEqual([]);
    expect(n.trips[0].route).toEqual([[1, 2]]);
    expect(minuteOf('not a date')).toBeNull();
  });
});

describe('team map: a truck that leaves from its own address (Part 18)', () => {
  const own = { lat: 45.5600, lng: -73.7000, label: 'Chez Saleh', address: '10 rue X, Laval' };
  const a = answer();
  a.trucks[0] = { ...a.trucks[0], start: own };
  const m = assemble(a);
  const complet = m.trucks.find((t) => t.id === 't-complet')!;
  const voiture = m.trucks.find((t) => t.id === 't-voiture')!;

  it('starts its route from its own start; the others from « Départ des camions »', () => {
    expect(complet.from).toEqual([own.lat, own.lng]);
    expect(complet.start).toEqual(own);
    expect(complet.legs[0].points[0]).toEqual([own.lat, own.lng]);
    expect(voiture.from).toEqual([HOME.lat, HOME.lng]);
    expect(voiture.start).toBeNull();
  });
  it('reads a start sent as text, and ignores one without a position', () => {
    const n = normalize({ trucks: [{ id: 'a', start: { lat: '45.5', lng: '-73.6', label: 'X' } }, { id: 'b', start: { lat: null, lng: 2 } }, { id: 'c', start: 'oops' }] });
    expect(n.trucks[0].start).toEqual({ lat: 45.5, lng: -73.6, label: 'X', address: null });
    expect(n.trucks[1].start).toBeNull();
    expect(n.trucks[2].start).toBeNull();
  });
});
