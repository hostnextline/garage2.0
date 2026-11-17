/* The alert while the app is closed: the server gets a working address of this device back when it lost it (comms-guide-08). */
import { describe, it, expect } from 'vitest';
import { repairPush, repairPushOnce, type RepairWorld } from './pushRepair';
import { t } from '../../lib/i18n';

const sub = (endpoint = 'https://push.example/abc', p256dh = 'P', auth = 'A') => ({ endpoint, toJSON: () => ({ endpoint, keys: { p256dh, auth } }) });
function world(o: Partial<{ permission: string | null; sub: ReturnType<typeof sub> | null; known: boolean; key: () => Promise<string>; renew: () => Promise<ReturnType<typeof sub>> }> = {}) {
  const added: unknown[] = [], renewed: string[] = [];
  const w: RepairWorld = {
    permission: () => (o.permission === undefined ? 'granted' : o.permission),
    subscription: async () => (o.sub === undefined ? sub() : o.sub),
    known: async () => o.known ?? false,
    key: o.key || (async () => 'KEY'),
    renew: async (key) => { renewed.push(key); return o.renew ? o.renew() : sub('https://push.example/new', 'P2', 'A2'); },
    add: async (row) => { added.push(row); }
  };
  return { w, added, renewed };
}

describe('the alert repaired by itself', () => {
  it('the server dropped the row (the old address answered 410): a NEW address with the garage key, never the dead one again', async () => {
    const { w, added, renewed } = world();
    expect(await repairPush(w)).toBe('renewed');
    expect(renewed).toEqual(['KEY']);
    expect(added).toEqual([{ endpoint: 'https://push.example/new', p256dh: 'P2', auth: 'A2' }]);
  });
  it('the server knows it: nothing renewed, nothing written', async () => {
    const { w, added, renewed } = world({ known: true });
    expect(await repairPush(w)).toBe('kept');
    expect(renewed).toEqual([]);
    expect(added).toEqual([]);
  });
  it('no key (no signal, the server in trouble): the device keeps its address, nothing written, the next start tries again', async () => {
    const { w, added, renewed } = world({ key: async () => { throw new Error('push-key'); } });
    await expect(repairPush(w)).rejects.toThrow('push-key');
    expect(renewed).toEqual([]);
    expect(added).toEqual([]);
  });
  it('the device refuses a new address: « lost », nothing written', async () => {
    const { w, added } = world({ renew: async () => { throw new Error('AbortError'); } });
    expect(await repairPush(w)).toBe('lost');
    expect(added).toEqual([]);
  });
  it('switched off here (no address on the device), or no permission: nothing asked, nothing written', async () => {
    for (const o of [{ sub: null }, { permission: 'default' }, { permission: 'denied' }, { permission: null }]) {
      const { w, added, renewed } = world(o);
      expect(await repairPush(w)).toBe('nothing');
      expect(renewed).toEqual([]);
      expect(added).toEqual([]);
    }
  });
});

describe('a lost alert is said once', () => {
  it('lost: one line for the person; once per person and page', async () => {
    const said: string[] = [];
    const { w } = world({ renew: async () => { throw new Error('refused'); } });
    await repairPushOnce('owner-lost', w, (x) => said.push(x));
    await repairPushOnce('owner-lost', w, (x) => said.push(x));
    expect(said).toEqual([t('conversation.alertLost')]);
  });
  it('renewed or kept: nothing said', async () => {
    const said: string[] = [];
    await repairPushOnce('owner-renewed', world().w, (x) => said.push(x));
    await repairPushOnce('owner-kept', world({ known: true }).w, (x) => said.push(x));
    expect(said).toEqual([]);
  });
});
