import { describe, it, expect, vi, beforeEach } from 'vitest';

let answer: unknown;
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), saveSettings: async () => answer }));
import { saveSection, anyQueued } from './save';
import { net } from '../../data/sync';

beforeEach(() => { answer = undefined; net.value = { ...net.value, online: true }; });

describe('one part of the settings saved: does it wait on the phone? (settings-team-11)', () => {
  it('online: sent; offline: waits; a data layer that says « queued » itself is believed', async () => {
    expect(await saveSection('company', {})).toBeUndefined();
    net.value = { ...net.value, online: false };
    expect(await saveSection('company', {})).toEqual({ queued: true });
    net.value = { ...net.value, online: true };
    answer = { queued: true };
    expect(await saveSection('company', {})).toEqual({ queued: true });
  });
  it('several parts: waits when any of them waits', () => {
    expect(anyQueued([undefined, undefined])).toBeUndefined();
    expect(anyQueued([undefined, { queued: true }])).toEqual({ queued: true });
    expect(anyQueued([])).toBeUndefined();
  });
});
