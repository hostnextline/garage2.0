import { describe, it, expect } from 'vitest';
import { mergeTeamMap, afterFailure, mapKey, KEEP_PEOPLE_MS } from './teamMap';
import { assemble } from '../../shared/map/assemble';
import { overviewRows } from './rows';
import type { TeamMapAnswer } from '../../shared/map/assemble';
import type { Job } from '../../data/types';

const stop = (id: string, truck: string | null, order: number | null, name = id) => ({ id, number: 1, truck_id: truck, order, eta_min: 600, status: 'booked', block: 'am', name, address: '', lat: 45.5, lng: -73.6 });
const answer = (jobs: ReturnType<typeof stop>[], o: Partial<TeamMapAnswer> = {}): TeamMapAnswer => ({
  home: { lat: 45.5, lng: -73.6 }, trucks: [{ id: 't1', name: 'Camion Complet', color: '#D3000E', driver_id: null }], jobs, people: [], trips: [], ...o
});

describe('« Vue d’ensemble »: the phone’s copy with the server’s map over it (agenda-05)', () => {
  it('shows an appointment booked a moment ago on its truck, not « À placer », before the next answer', () => {
    const server = answer([stop('a', 't1', 1)]);
    const device = answer([stop('a', 't1', 1), stop('new', 't1', 2)]);
    const m = assemble(mergeTeamMap(server, device));
    const rows = overviewRows([{ id: 'a', block: 'am', eta_min: 600, number: 1, truck_id: 't1' }, { id: 'new', block: 'am', eta_min: 700, number: 2, truck_id: 't1' }] as Job[], m);
    expect(rows.find((r) => r.job.id === 'new')).toMatchObject({ n: 2, truckName: 'Camion Complet' });
    // the old way: the rows read the server's answer only
    expect(overviewRows([{ id: 'new', block: 'am', eta_min: 700, number: 2, truck_id: 't1' }] as Job[], assemble(server))[0].n).toBe(null);
  });
  it('follows the phone for a job re-planned since the last answer, keeps the server’s people and other trucks’ stops', () => {
    const server = answer([stop('a', 't1', 1), stop('other', 't1', 2)], { people: [{ id: 'p', name: 'Saleh', color: null, lat: 45.5, lng: -73.6, at: null, job_id: null }] });
    const device = answer([stop('a', null, null)]);
    const merged = mergeTeamMap(server, device);
    expect(merged.jobs.find((j) => j.id === 'a')?.truck_id).toBe(null);
    expect(merged.jobs.map((j) => j.id)).toContain('other');
    expect(merged.people).toHaveLength(1);
  });
  it('is the phone’s copy alone without an answer', () => {
    const device = answer([stop('a', 't1', 1)]);
    expect(mergeTeamMap(null, device)).toBe(device);
  });
  it('keeps a truck the server did not list when the phone has a job on it, never an idle one', () => {
    const device = answer([stop('a', 't2', 1)], { trucks: [{ id: 't2', name: 'Voiture', color: null, driver_id: null }, { id: 't3', name: 'Vieux', color: null, driver_id: null }] });
    expect(mergeTeamMap(answer([]), device).trucks.map((x) => x.id)).toEqual(['t1', 't2']);
  });
});

describe('a failed refresh of the map (review TA-7, agenda-05)', () => {
  const people = [{ id: 'p', name: 'Saleh', color: null, lat: 45.5, lng: -73.6, at: null, job_id: 'a' }];
  const trips = [{ job_id: 'a', staff_id: 'p', eta_at: null, km: 4, minutes: 9, route: [[45.5, -73.6]] as [number, number][] }];
  const prev = { day: '2026-11-16', at: 1_000_000, data: answer([stop('a', 't1', 1), stop('gone', 't1', 2)], { people, trips }) };
  it('keeps the mechanics’ positions and trips of a recent answer, never its appointments', () => {
    const kept = afterFailure(prev, '2026-11-16', prev.at + 31_000)!;
    expect(kept.data.people).toEqual(people);
    expect(kept.data.trips).toEqual(trips);
    expect(kept.data.jobs).toEqual([]);
    expect(kept.at).toBe(prev.at);
    const merged = mergeTeamMap(kept.data, answer([stop('a', null, null)]));
    expect(merged.jobs.map((j) => j.id)).toEqual(['a']);
    expect(merged.jobs[0].truck_id).toBe(null);
    expect(merged.people).toHaveLength(1);
  });
  it('drops everything from the server once the answer is old, or of another day', () => {
    expect(afterFailure(prev, '2026-11-16', prev.at + KEEP_PEOPLE_MS)).toBe(null);
    expect(afterFailure(prev, '2026-11-17', prev.at + 1000)).toBe(null);
    expect(afterFailure(null, '2026-11-16', 0)).toBe(null);
  });
});

describe('the key of a map (review TA-8)', () => {
  it('is the same for the same drawing, changes with a stop or a person, and does not spell out the routes', () => {
    const route = Array.from({ length: 500 }, (_, i): [number, number] => [45 + i / 1000, -73]);
    const a = answer([stop('a', 't1', 1)], { trips: [{ job_id: 'a', staff_id: 'p', eta_at: null, km: 4, minutes: 9, route }] });
    expect(mapKey(a)).toBe(mapKey({ ...a, trips: a.trips.map((x) => ({ ...x })) }));
    expect(mapKey(a)).not.toBe(mapKey(answer([stop('a', 't1', 2)], { trips: a.trips })));
    expect(mapKey(a).length).toBeLessThan(JSON.stringify(a).length / 5);
  });
});
