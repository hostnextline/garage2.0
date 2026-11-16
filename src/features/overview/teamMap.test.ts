import { describe, it, expect } from 'vitest';
import { mergeTeamMap } from './teamMap';
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
