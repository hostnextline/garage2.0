/* The tracking page's questions to public_track, on a pretended clock: every 5 s while the trip is on its way and the
   page on screen, longer and longer after failures (15 s, 30 s, a minute), nothing while hidden, at once back on
   screen, nothing once the trip is over. And the minutes shown follow where he is, not the server's fixed eta_at. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { TrackAnswer } from '../api';

let calls = 0;
let reply: () => TrackAnswer | Error = () => ({ status: 'not_found' });
vi.mock('../api', async (orig) => {
  const real = await orig<typeof import('../api')>();
  return { ...real, callTrack: async () => { calls++; const r = reply(); if (r instanceof Error) throw r; return r; } };
});
import { ClientError } from '../api';
import { useTrack, waitAfter } from './useTrack';

const box = document.createElement('div');
document.body.appendChild(box);
let vis: DocumentVisibilityState = 'visible';
function Probe() {
  const { view, err } = useTrack('TRIP-token-123456');
  return <p data-left={view?.eta?.left ?? ''} data-err={err ?? ''} />;
}
const shown = () => box.querySelector('p')!.getAttribute('data-left');
const pass = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const setVis = async (v: DocumentVisibilityState) => { vis = v; await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); }); };

// a bent route (1112 m north, then 780 m east), 20 minutes planned
const ROUTE: [number, number][] = [[45.5, -73.6], [45.51, -73.6], [45.51, -73.59]];
const answer = (pos: { lat: number; lng: number } | null, o: Partial<TrackAnswer> = {}): TrackAnswer => {
  const now = Date.now();
  return {
    status: 'active', garage: { name: 'Garage', phone: '438 901-6606' }, mechanic: 'Adam', lang: 'fr', dest: { lat: 45.51, lng: -73.59 },
    route: ROUTE, km: 1.9, minutes: 20, eta_at: new Date(now + 3 * 60000).toISOString(), now: new Date(now).toISOString(),
    pos: pos && { ...pos, at: new Date(now - 5000).toISOString() }, ...o
  };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-20T17:00:00Z'));
  calls = 0;
  vis = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
});
afterEach(async () => {
  await act(() => { render(null, box); });
  vi.useRealTimers();
});
// the first question goes once the page is drawn (its effect), its answer comes a moment later
const open = async () => { await act(async () => { render(<Probe />, box); }); await pass(0); };

describe('how often the tracking page asks', () => {
  it('the waits: 5 s answered; 15 s, 30 s, then a minute after failures in a row', () => {
    expect([0, 1, 2, 3, 4, 9].map(waitAfter)).toEqual([5000, 15000, 30000, 60000, 60000, 60000]);
  });
  it('every 5 s while the trip is on its way and the page on screen', async () => {
    reply = () => answer({ lat: 45.5, lng: -73.6 });
    await open();
    expect(calls).toBe(1);
    await pass(4900);
    expect(calls).toBe(1);
    await pass(100);
    expect(calls).toBe(2);
    await pass(5000 * 4);
    expect(calls).toBe(6);
  });
  it('backs off when the server does not answer, and 5 s again at the first answer', async () => {
    reply = () => answer({ lat: 45.5, lng: -73.6 });
    await open();
    reply = () => new ClientError('network', 'Failed to fetch');
    await pass(5000);                    // asks, fails
    expect(calls).toBe(2);
    expect(box.querySelector('p')!.getAttribute('data-err')).toBe('network');
    await pass(14900);
    expect(calls).toBe(2);               // not before 15 s
    await pass(100);
    expect(calls).toBe(3);               // fails again → 30 s
    await pass(29900);
    expect(calls).toBe(3);
    await pass(100);
    expect(calls).toBe(4);               // → a minute
    await pass(59900);
    expect(calls).toBe(4);
    await pass(100);
    expect(calls).toBe(5);               // → a minute again (never more often)
    reply = () => answer({ lat: 45.5, lng: -73.6 });
    await pass(60000);
    expect(calls).toBe(6);               // answered
    expect(box.querySelector('p')!.getAttribute('data-err')).toBe('');
    await pass(5000);
    expect(calls).toBe(7);
  });
  it('nothing while the page is hidden; at once when it comes back on screen', async () => {
    reply = () => answer({ lat: 45.5, lng: -73.6 });
    await open();
    await setVis('hidden');
    await pass(5000);                    // the question due finds the page hidden: not asked
    await pass(120000);
    expect(calls).toBe(1);
    await setVis('visible');
    expect(calls).toBe(2);
    await pass(5000);
    expect(calls).toBe(3);
  });
  it('stops once the trip is over', async () => {
    reply = () => ({ status: 'arrived', mechanic: 'Adam', ended_at: new Date().toISOString() });
    await open();
    await pass(120000);
    expect(calls).toBe(1);
  });
});

describe('the minutes shown follow where he is', () => {
  it('far on the road with the server’s eta_at in 3 minutes: about 14 min (not 3), then down as he drives', async () => {
    reply = () => answer({ lat: 45.505, lng: -73.6 });          // 556 + 780 m of road left of 1892 → 14.1 min
    await open();
    expect(shown()).toBe('14');
    reply = () => answer({ lat: 45.51, lng: -73.595 });         // the second leg, halfway → 4.1 min: clearly closer, at once
    await pass(5000);
    expect(shown()).toBe('4');
  });
  it('stuck in traffic: the minutes stay, the server’s countdown would have said « 1 min »', async () => {
    reply = () => answer({ lat: 45.505, lng: -73.6 }, { eta_at: new Date(Date.now() + 3 * 60000).toISOString() });
    await open();
    const first = Date.now();
    reply = () => answer({ lat: 45.505, lng: -73.6 }, { eta_at: new Date(first + 3 * 60000).toISOString() });
    for (let i = 0; i < 24; i++) { await pass(5000); expect(shown()).toBe('14'); }    // two minutes at the same place
  });
  it('a position 3 minutes old: the server’s eta_at, as before', async () => {
    reply = () => answer({ lat: 45.505, lng: -73.6 }, { pos: { lat: 45.505, lng: -73.6, at: new Date(Date.now() - 3 * 60000).toISOString() } });
    await open();
    expect(shown()).toBe('3');
  });
});
