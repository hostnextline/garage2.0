import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
let pushHangs = false;
vi.mock('../../services/push', () => ({ pushOff: () => { calls.push('pushOff'); return pushHangs ? new Promise(() => undefined) : Promise.resolve(); } }));
vi.mock('../../data/auth', () => ({ signOut: async (force: boolean) => { calls.push(`signOut:${force}`); return 'done'; } }));
vi.mock('../../data/sync', () => ({ pendingCount: async () => 0 }));
import { signOutNow } from './signOut';

beforeEach(() => { calls.length = 0; pushHangs = false; });

describe('signing out', () => {
  it('removes this device’s push address before the session goes (old logic: the next person kept getting the texts)', async () => {
    await signOutNow();
    expect(calls).toEqual(['pushOff', 'signOut:true']);
  });
  it('no signal: the push removal never holds the sign-out more than a few seconds', async () => {
    vi.useFakeTimers();
    try {
      pushHangs = true;
      const p = signOutNow();
      await vi.advanceTimersByTimeAsync(4000);
      await p;
      expect(calls).toEqual(['pushOff', 'signOut:true']);
    } finally { vi.useRealTimers(); }
  });
});
