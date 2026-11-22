/* The background work of the frame (the mechanic's position, the search of addresses with no position) comes in files
   of their own. One that could not start (its code did not come, even with the phone saying it is online) is tried
   again: at the signal back, at the app back on screen, or after a wait, so the mechanic's position never stays unshared
   for the whole session (app-shell-r2-2). Reported once with signal, never without. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const reports: string[] = [];
vi.mock('../platform/report', async (orig) => ({
  ...(await orig<typeof import('../platform/report')>()),
  reportError: (_e: unknown, where: string) => { reports.push(where); }
}));
let positionFails = 0;
const positionStarts: number[] = [];
vi.mock('../services/position', () => ({
  startPositionSharing: () => { positionStarts.push(1); if (positionFails > 0) { positionFails--; throw new TypeError('Failed to fetch dynamically imported module'); } }
}));
const locatorStarts: number[] = [];
vi.mock('../shared/customers/locator', () => ({ startLocator: () => { locatorStarts.push(1); } }));
// « Vraies routes »: the driver's trip refresh and the measure of the trips still missing (else the test imports the real
// data layer)
const tripStarts: number[] = [];
vi.mock('../services/tripRefresh', () => ({ startTripRefresh: () => { tripStarts.push(1); } }));
let roadsFails = 0;
const roadsStarts: number[] = [];
vi.mock('../services/roadsSweep', () => ({
  startRoadsSweep: () => { roadsStarts.push(1); if (roadsFails > 0) { roadsFails--; throw new TypeError('Failed to fetch dynamically imported module'); } }
}));
import { startWithRetry, startBackground, BACKGROUND_RETRY_MS } from './Shell';

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /assets/position-x.js');
/** a start whose code fails `n` times, then comes */
function flaky(n: number) {
  const calls: number[] = [];
  let left = n;
  const run = () => { calls.push(1); return left-- > 0 ? Promise.reject(chunkError()) : Promise.resolve(); };
  return { calls, run };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
let online = true;
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  reports.length = 0; positionStarts.length = 0; locatorStarts.length = 0; positionFails = 0;
  tripStarts.length = 0; roadsStarts.length = 0; roadsFails = 0;
  online = true; visibility = 'visible';
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('a background start that failed with the phone online', () => {
  it('is tried again after a wait, reported once', async () => {
    const f = flaky(1);
    startWithRetry('position', f.run);
    await flush();
    expect(f.calls).toHaveLength(1);
    expect(reports).toEqual(['start:position']);
    await vi.advanceTimersByTimeAsync(BACKGROUND_RETRY_MS[0]);
    expect(f.calls).toHaveLength(2);
    // it worked: never asked again
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(f.calls).toHaveLength(2);
    expect(reports).toEqual(['start:position']);
  });
  it('is tried again as soon as the app is back on screen', async () => {
    const f = flaky(1);
    startWithRetry('position', f.run);
    await flush();
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(f.calls).toHaveLength(1);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(f.calls).toHaveLength(2);
  });
  it('is tried again at the next « online », even when the phone never said it was offline', async () => {
    const f = flaky(1);
    startWithRetry('locator', f.run);
    await flush();
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(f.calls).toHaveLength(2);
  });
  it('keeps trying, waiting longer each time (one try per wait, reported once)', async () => {
    const f = flaky(10);
    startWithRetry('position', f.run);
    await flush();
    // the last wait repeats
    for (const [i, ms] of [...BACKGROUND_RETRY_MS, BACKGROUND_RETRY_MS[BACKGROUND_RETRY_MS.length - 1]].entries()) {
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(f.calls).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.calls).toHaveLength(i + 2);
    }
    expect(reports).toEqual(['start:position']);
  });
});

describe('a background start that failed with no signal', () => {
  it('is not reported and is tried again when the signal is back', async () => {
    online = false;
    const f = flaky(1);
    startWithRetry('position', f.run);
    await flush();
    expect(reports).toEqual([]);
    online = true;
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(f.calls).toHaveLength(2);
    expect(reports).toEqual([]);
  });
});

describe('startBackground', () => {
  it('starts the position, the locator, the trip refresh and the roads sweep once; a start that failed is run again (it used to stay off)', async () => {
    positionFails = 1;
    roadsFails = 1;
    startBackground();
    startBackground(); // the frame drawn again: nothing twice
    await flush();
    expect(locatorStarts).toHaveLength(1);
    expect(positionStarts).toHaveLength(1);
    expect(tripStarts).toHaveLength(1);
    expect(roadsStarts).toHaveLength(1);
    expect(reports).toEqual(['start:position', 'start:roads']);
    await vi.advanceTimersByTimeAsync(BACKGROUND_RETRY_MS[0]);
    expect(positionStarts).toHaveLength(2);
    expect(roadsStarts).toHaveLength(2);
    expect(locatorStarts).toHaveLength(1);
    expect(tripStarts).toHaveLength(1);
  });
});
