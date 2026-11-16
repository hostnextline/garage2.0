import { describe, it, expect } from 'vitest';
import { assemble, normalize, minuteOf, PALETTE, type TeamMapAnswer } from './assemble';

const HOME = { lat: 45.5005, lng: -73.6577, label: 'Centrale', address: '8255 av. Mountain Sights' };
// a moment of a November day in Montréal (UTC-5), written so the tests give the same answer in any time zone
// (before the rebuild this helper used the phone's own zone, the bug map-hours-23 was hidden by it)
const at = (h: number, m: number) => `2026-11-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`;

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

describe('team map: a mechanic working at a customer stays on the map', () => {
  it('on site: shown at the customer, with the job, whatever the age of the position', () => {
    const a = answer();
    // the phone slept while he works: the last position is old and a few streets away
    a.people[0] = { ...a.people[0], lat: 45.49, lng: -73.7, at: at(7, 0), job_id: null };
    const m = assemble(a, { nameOf: () => '' });
    const saleh = m.people.find((p) => p.id === 'u-saleh')!;
    expect(saleh.onSite).toEqual({ jobId: 'j-2', name: 'Marc-André' });
    expect([saleh.lat, saleh.lng]).toEqual([45.5022, -73.7094]);
    // on the way: where his phone says
    const adam = m.people.find((p) => p.id === 'u-adam')!;
    expect(adam.onSite).toBeNull();
    expect([adam.lat, adam.lng]).toEqual([45.5201, -73.6655]);
  });
});

describe('the map with « Plages d\'arrivée » (block \'day\')', () => {
  it('a day of windows: each truck\'s stops by stop order, each with the window told to the customer', () => {
    const m = assemble({
      home: HOME, trucks: [{ id: 't1', name: 'Camion', color: null, driver_id: null }], people: [], trips: [],
      jobs: [
        { id: 'b', number: 2, truck_id: 't1', order: 2, eta_min: 900, status: 'booked', block: 'day', name: 'B', address: null, lat: 45.5, lng: -73.6, win_start: 840, win_end: 1080 },
        { id: 'a', number: 1, truck_id: 't1', order: 1, eta_min: 560, status: 'booked', block: 'day', name: 'A', address: null, lat: 45.51, lng: -73.61, win_start: 480, win_end: 720 },
        { id: 'c', number: 3, truck_id: 't1', order: 3, eta_min: 1000, status: 'booked', block: 'day', name: 'C', address: null, lat: 45.52, lng: -73.62, win_start: null, win_end: null, win_flex: true }
      ]
    });
    const stops = m.trucks[0].stops;
    expect(stops.map((s) => [s.id, s.n])).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    expect(stops.map((s) => s.win ?? null)).toEqual([[480, 720], [840, 1080], null]);
  });
  it('an answer without windows (blocks, or an older server) is read as before', () => {
    expect(normalize(answer()).jobs.every((j) => !('win_start' in j))).toBe(true);
  });
});

describe('team map: the person is tied to what he is doing, not to the truck he usually drives (« Routes partagées »)', () => {
  // Adam usually drives the Voiture; today he drives the Camion to Amira, while Saleh works at Patrick's with the Voiture
  function swapped(): TeamMapAnswer {
    return {
      home: HOME,
      trucks: [{ id: 't-camion', name: 'Camion', color: '#D3000E', driver_id: 'u-saleh' }, { id: 't-voiture', name: 'Voiture', color: '#2F6FD0', driver_id: 'u-adam' }],
      jobs: [
        { id: 'x', number: 1, truck_id: 't-camion', order: 1, eta_min: 600, status: 'en_route', block: 'am', name: 'Amira', address: null, lat: 45.53, lng: -73.67 },
        { id: 'y', number: 2, truck_id: 't-voiture', order: 1, eta_min: 590, status: 'on_site', block: 'am', name: 'Patrick', address: null, lat: 45.47, lng: -73.62 }
      ],
      people: [
        { id: 'u-adam', name: 'Adam', color: null, lat: 45.51, lng: -73.66, at: at(10, 0), job_id: 'x' },
        { id: 'u-saleh', name: 'Saleh', color: null, lat: 45.4701, lng: -73.6201, at: at(10, 0), job_id: 'y' }
      ],
      trips: [{ job_id: 'x', staff_id: 'u-adam', eta_at: at(10, 20), km: 4, minutes: 9, route: null }]
    };
  }
  it('Adam is drawn where his phone is, on his way to Amira with the Camion; Saleh is at Patrick’s with the Voiture', () => {
    const m = assemble(swapped());
    const adam = m.people.find((p) => p.id === 'u-adam')!;
    expect(adam.onSite).toBeNull();
    expect([adam.lat, adam.lng]).toEqual([45.51, -73.66]);
    expect(adam.truckId).toBe('t-camion');
    const saleh = m.people.find((p) => p.id === 'u-saleh')!;
    expect(saleh.onSite).toEqual({ jobId: 'y', name: 'Patrick' });
    expect(saleh.truckId).toBe('t-voiture');
  });
  it('the Camion’s trip without a road starts from Adam, who drives it, not from Saleh, its usual driver', () => {
    const camion = assemble(swapped()).trucks.find((t) => t.id === 't-camion')!;
    expect(camion.legs[0]).toEqual({ points: [[45.51, -73.66], [45.53, -73.67]], kind: 'trip' });
  });
  it('a position with no job never takes a job someone else’s phone is at', () => {
    const a = swapped();
    a.people[0] = { ...a.people[0], job_id: null };
    a.trips = [];
    const adam = assemble(a).people.find((p) => p.id === 'u-adam')!;
    expect(adam.onSite).toBeNull();                 // « y » is Saleh's, even though Adam is the Voiture's driver
    expect([adam.lat, adam.lng]).toEqual([45.51, -73.66]);
  });
});

describe('team map: times in Montréal whatever the phone’s time zone', () => {
  it('reads a moment as Montréal minutes (winter and summer)', () => {
    expect(minuteOf('2026-11-16T15:40:00Z')).toBe(10 * 60 + 40);   // UTC-5
    expect(minuteOf('2026-07-16T14:40:00Z')).toBe(10 * 60 + 40);   // UTC-4
    expect(minuteOf('2026-11-16T05:05:00Z')).toBe(5);              // just after midnight
  });
});

describe('team map: one order of the stops', () => {
  it('a stop done out of order comes before the stops still to do in its block', () => {
    const m = assemble({
      home: HOME, trucks: [{ id: 't1', name: 'Camion', color: null, driver_id: null }], people: [], trips: [],
      jobs: [
        { id: 'first', number: 1, truck_id: 't1', order: 1, eta_min: 500, status: 'booked', block: 'am', name: 'A', address: null, lat: 45.5, lng: -73.6 },
        { id: 'done', number: 2, truck_id: 't1', order: 2, eta_min: 560, status: 'done', block: 'am', name: 'B', address: null, lat: 45.51, lng: -73.61 },
        { id: 'pm', number: 3, truck_id: 't1', order: 1, eta_min: 760, status: 'booked', block: 'pm', name: 'C', address: null, lat: 45.52, lng: -73.62 }
      ]
    });
    expect(m.trucks[0].stops.map((s) => [s.id, s.n])).toEqual([['done', 1], ['first', 2], ['pm', 3]]);
  });
});
