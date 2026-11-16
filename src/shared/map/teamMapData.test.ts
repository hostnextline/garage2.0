import { describe, it, expect } from 'vitest';
import { withPositions, freshen, forDay } from './teamMapData';
import { assemble, type TeamMapAnswer } from './assemble';

const answer = (): TeamMapAnswer => ({
  home: { lat: 45.5, lng: -73.65, label: 'Centrale', address: '' },
  trucks: [{ id: 't1', name: 'Camion', color: '#D3000E', driver_id: 'u1' }, { id: 't2', name: 'Voiture', color: null, driver_id: null }],
  jobs: [
    { id: 'a', number: 1, truck_id: 't1', order: 1, eta_min: 540, status: 'booked', block: 'am', name: 'A', address: null, lat: null, lng: null },
    { id: 'b', number: 2, truck_id: 't1', order: 2, eta_min: 600, status: 'en_route', block: 'am', name: 'B', address: null, lat: 45.52, lng: -73.6 }
  ],
  people: [{ id: 'u1', name: 'Saleh', color: null, lat: 45.51, lng: -73.62, at: '2026-11-16T14:00:00Z', job_id: 'b' }],
  trips: [{ job_id: 'b', staff_id: 'u1', eta_at: '2026-11-16T15:00:00Z', km: 3, minutes: 8, route: null }]
});

describe('the team map made the best it can be on this phone', () => {
  it('a job without a position on the server takes the one the phone knows (found just now first)', () => {
    const d = withPositions(answer(), (id) => (id === 'a' ? { lat: 45.53, lng: -73.61 } : null));
    expect(d.jobs[0]).toMatchObject({ lat: 45.53, lng: -73.61 });
    expect(withPositions(answer(), () => null, { a: { lat: 1, lng: 2 } }).jobs[0]).toMatchObject({ lat: 1, lng: 2 });
    const same = answer();
    expect(withPositions(same, () => null)).toBe(same);   // nothing to add: the same answer (the map draws nothing again)
  });
  it('no signal: what the phone did after the last answer wins (a job finished offline, its own position sent later)', () => {
    const at = Date.parse('2026-11-16T14:05:00Z');
    const d = freshen(answer(), at, {
      job: (id) => (id === 'b' ? { status: 'done', updatedAt: at + 60000 } : id === 'a' ? { status: 'cancelled', updatedAt: at - 60000 } : null),
      positions: [{ id: 'u1', lat: 45.4, lng: -73.7, at: '2026-11-16T14:10:00Z', job_id: null }]
    });
    expect(d.jobs.map((j) => j.status)).toEqual(['booked', 'done']);   // « a » changed before the answer: the answer knows
    expect(d.people[0]).toMatchObject({ lat: 45.4, lng: -73.7, job_id: null });
    const old = freshen(answer(), at, { job: () => null, positions: [{ id: 'u1', lat: 1, lng: 1, at: '2026-11-16T13:00:00Z', job_id: null }] });
    expect(old.people[0].lat).toBe(45.51);
  });
  it('another day than today: nobody on the road, no trip, only the trucks with stops', () => {
    const a = assemble(answer());
    const other = forDay(a, false);
    expect(other.people).toEqual([]);
    expect(other.trucks.map((t) => t.id)).toEqual(['t1']);
    expect(other.trucks[0].trip).toBeNull();
    expect(other.trucks[0].legs.every((l) => l.kind !== 'trip')).toBe(true);
    expect(forDay(a, true)).toBe(a);
  });
});
