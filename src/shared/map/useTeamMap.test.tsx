/* useTeamMap: asks the server for the day, keeps the last answer, drops an answer that comes back too late, and a
   refresh never starts over. (The server is pretended.) */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const answers: { day: string; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return { ...real, rpcNow: (_n: string, args: { p_day: string }) => new Promise((resolve, reject) => { answers.push({ day: args.p_day, resolve, reject }); }) };
});
vi.mock('./device', () => ({ fromDevice: (day: string) => ({ home: null, trucks: [], jobs: [{ id: `device-${day}`, number: 1, truck_id: null, order: null, eta_min: null, status: 'booked', block: 'am', name: 'D', address: null, lat: 1, lng: 1 }], people: [], trips: [] }) }));
import { useTeamMap, forgetTeamMaps, type TeamMap } from './useTeamMap';

const box = document.createElement('div');
let seen: TeamMap | null = null;
function Probe(p: { day: string }) { seen = useTeamMap(p.day); return null; }
const job = (id: string) => ({ home: null, trucks: [], jobs: [{ id, number: 1, truck_id: null, order: null, eta_min: null, status: 'booked', block: 'am', name: id, address: null, lat: 1, lng: 1 }], people: [], trips: [] });
const flushP = () => act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });

describe('useTeamMap', () => {
  beforeEach(() => { answers.length = 0; forgetTeamMaps(); });
  afterEach(() => { render(null, box); });

  it('the phone’s copy first, then the server’s answer; a refresh keeps showing the answer until the new one comes', async () => {
    await act(async () => { render(<Probe day="2026-11-16" />, box); });
    expect(seen!.source).toBe('device');
    expect(seen!.data.jobs[0].id).toBe('device-2026-11-16');
    answers[0].resolve(job('server-1'));
    await flushP();
    expect(seen!.source).toBe('server');
    expect(seen!.status).toBe('ok');
    let done = false;
    await act(async () => { void seen!.refresh().then(() => { done = true; }); });
    expect(seen!.data.jobs[0].id).toBe('server-1');   // nothing starts over while it asks
    expect(seen!.busy).toBe(true);
    answers[1].resolve(job('server-2'));
    await flushP();
    expect(done).toBe(true);
    expect(seen!.data.jobs[0].id).toBe('server-2');
  });
  it('an answer that comes back after a newer question is dropped', async () => {
    await act(async () => { render(<Probe day="2026-11-16" />, box); });
    await act(async () => { void seen!.refresh(); });
    answers[1].resolve(job('newer'));
    await flushP();
    answers[0].resolve(job('older'));
    await flushP();
    expect(seen!.data.jobs[0].id).toBe('newer');
  });
  it('another day: shows that day at once (never the day before under the new title); the answer of the old day is dropped', async () => {
    await act(async () => { render(<Probe day="2026-11-16" />, box); });
    await act(async () => { render(<Probe day="2026-11-17" />, box); });
    expect(seen!.data.jobs[0].id).toBe('device-2026-11-17');
    answers[0].resolve(job('of-the-16th'));
    await flushP();
    expect(seen!.data.jobs[0].id).toBe('device-2026-11-17');
  });
  it('no signal: says so and keeps the last answer of that day', async () => {
    await act(async () => { render(<Probe day="2026-11-16" />, box); });
    answers[0].resolve(job('kept'));
    await flushP();
    render(null, box);
    await act(async () => { render(<Probe day="2026-11-16" />, box); });
    expect(seen!.data.jobs[0].id).toBe('kept');   // shown at once from the memory
    answers[answers.length - 1].reject(new TypeError('Failed to fetch'));
    await flushP();
    expect(seen!.status).toBe('offline');
    expect(seen!.source).toBe('server');
  });
  it('the same inputs give the same map: drawing the screen again does not make a new one (mh-6)', async () => {
    await act(async () => { render(<Probe day="2026-11-20" />, box); });
    const first = seen!.data;
    await act(async () => { render(<Probe day="2026-11-20" />, box); });
    expect(seen!.data).toBe(first);   // the phone's copy, not built again
    answers[answers.length - 1].resolve(job('server-x'));
    await flushP();
    const answered = seen!.data;
    expect(answered.jobs[0].id).toBe('server-x');
    await act(async () => { render(<Probe day="2026-11-20" />, box); });
    expect(seen!.data).toBe(answered);
  });
});
