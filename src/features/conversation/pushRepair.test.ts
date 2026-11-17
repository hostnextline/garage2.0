/* The alert while the app is closed: the server gets this device's address back when it lost it (comms-guide-08). */
import { describe, it, expect } from 'vitest';
import { repairPush, type RepairWorld } from './pushRepair';

const sub = (endpoint = 'https://push.example/abc') => ({ endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'P', auth: 'A' } }) });
function world(o: Partial<{ permission: string | null; sub: ReturnType<typeof sub> | null; known: boolean }> = {}) {
  const added: unknown[] = [];
  const w: RepairWorld = {
    permission: () => (o.permission === undefined ? 'granted' : o.permission),
    subscription: async () => (o.sub === undefined ? sub() : o.sub),
    known: async () => o.known ?? false,
    add: async (row) => { added.push(row); }
  };
  return { w, added };
}

describe('the alert repaired by itself', () => {
  it('the device still has its address, the server lost it (a new address, a row dropped): the row is given back', async () => {
    const { w, added } = world();
    expect(await repairPush(w)).toBe('put back');
    expect(added).toEqual([{ endpoint: 'https://push.example/abc', p256dh: 'P', auth: 'A' }]);
  });
  it('the server knows it: nothing written', async () => {
    const { w, added } = world({ known: true });
    expect(await repairPush(w)).toBe('kept');
    expect(added).toEqual([]);
  });
  it('switched off here (no address on the device), or no permission: nothing asked, nothing written', async () => {
    for (const o of [{ sub: null }, { permission: 'default' }, { permission: 'denied' }, { permission: null }]) {
      const { w, added } = world(o);
      expect(await repairPush(w)).toBe('nothing');
      expect(added).toEqual([]);
    }
  });
});
