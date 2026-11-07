import { describe, it, expect } from 'vitest';
import { overviewRows } from './rows';
import { assemble, UNPLACED_COLOR } from '../map/assemble';
import type { Job } from '../../data/types';
import { overview as fr } from '../../i18n/fr/overview';
import { overview as en } from '../../i18n/en/overview';

const job = (id: string, block: string, eta: number | null, truck: string | null, number = 1) => ({ id, block, eta_min: eta, truck_id: truck, number, status: 'booked' } as unknown as Job);

describe('« Vue d’ensemble »: the appointments of the day', () => {
  const jobs = [job('c', 'pm', 760, 't1', 3), job('a', 'am', 520, 't1', 1), job('x', 'am', null, null, 9), job('b', 'am', 600, 't1', 2)];
  const m = assemble({
    home: { lat: 45.5, lng: -73.6 },
    trucks: [{ id: 't1', name: 'Camion Complet', color: '#D3000E', driver_id: null }],
    jobs: jobs.filter((j) => j.truck_id).map((j, i) => ({ id: j.id, number: j.number, truck_id: j.truck_id, order: i + 1, eta_min: j.eta_min, status: 'booked', block: j.block, name: j.id, address: '', lat: 45.5, lng: -73.6 })),
    people: [], trips: []
  });
  const rows = overviewRows(jobs, m);
  it('goes by block, then by arrival time', () => {
    expect(rows.map((r) => r.job.id)).toEqual(['a', 'b', 'x', 'c']);
  });
  it('gives the stop number and colour of the map, and « À placer » without a truck', () => {
    expect(rows.find((r) => r.job.id === 'a')).toMatchObject({ n: 1, color: '#D3000E', truckName: 'Camion Complet' });
    expect(rows.find((r) => r.job.id === 'c')?.n).toBe(3);
    expect(rows.find((r) => r.job.id === 'x')).toMatchObject({ n: null, color: UNPLACED_COLOR });
  });
  it('every word exists in French and English', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });
});
