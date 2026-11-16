/* The change functions every screen uses, through the real façade and engine, against the pretend server. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FakeServer, clientFor } from './testkit';
import { startSync, stopSync, net, flush, syncOptions } from './sync';
import { setNet } from './net';
import { getRow, rowsOf } from './store';
import { addItem, saveSettings, updateMe, saveCustomer, deleteInventoryItem } from './api';
import { itemsOf } from './select';

let srv: FakeServer;
let n = 0;
const nextUid = () => `00000000-0000-4000-b000-${String(++n).padStart(12, '0')}`;
async function until(ok: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}
async function start() {
  const uid = nextUid();
  await startSync(clientFor(srv, uid), uid);
  await until(() => net.value.ready);
}

beforeEach(() => {
  srv = new FakeServer();
  syncOptions.realtime = false;
  setNet({ online: true, session: 'ok', storage: 'ok', stuck: null, pending: 0, failed: [], ready: false, firstPull: 'no' });
});
afterEach(() => stopSync());

describe('work lines added to a job come after its last line (core-data-29, jobs-b-23)', () => {
  it('in the order they were added, whatever the clock says', async () => {
    srv.put('job_items', { id: 'a', job_id: 'j1', sort: 0, description: 'Vidange' });
    srv.put('job_items', { id: 'b', job_id: 'j1', sort: 1, description: 'Filtre' });
    await start();
    srv.offline = true;
    await addItem('j1', { description: 'Essuie-glaces' });
    await addItem('j1', { description: 'Lave-glace' });
    expect(itemsOf('j1').map((i) => i.description)).toEqual(['Vidange', 'Filtre', 'Essuie-glaces', 'Lave-glace']);
  });
});

describe('a settings part saved whole is merged with the server\'s when it is sent (core-data-19, settings-team-15)', () => {
  it('another device\'s change to another key stays', async () => {
    srv.put('settings', { id: '1', booking: { speed_kmh: 35, detour: 1.3, blocks: [] } });
    await start();
    // another device changes the detour meanwhile; this one, offline, changes the speed from what it shows
    srv.offline = true;
    const shown = getRow<{ id: string; booking: Record<string, unknown> }>('settings', '1')!.booking;
    await saveSettings('booking', { ...shown, speed_kmh: 40 });
    srv.put('settings', { id: '1', booking: { speed_kmh: 35, detour: 1.5, blocks: [] } });
    srv.offline = false;
    await flush();
    await until(() => net.value.pending === 0);
    expect(srv.table('settings')[0].booking).toMatchObject({ speed_kmh: 40, detour: 1.5 });
  });
  it('defaults shown before the row arrived are never written over the server\'s values', async () => {
    await start();
    srv.offline = true;
    await saveSettings('booking', { speed_kmh: 40, detour: 1.3, home: { label: 'Vieux départ' } });
    srv.put('settings', { id: '1', booking: { speed_kmh: 35, detour: 1.7, home: { label: 'Centrale' } } });
    srv.offline = false;
    await flush();
    await until(() => net.value.pending === 0);
    const b = srv.table('settings')[0].booking as Record<string, unknown>;
    expect(b.detour).toBe(1.7);
    expect(b.speed_kmh).toBe(40);
  });
});

describe('my own account\'s changes are never lost in silence (core-data-30, app-shell-09, x-errors-12)', () => {
  it('without signal: kept on the phone and sent later', async () => {
    let got: unknown = null;
    srv.rpc('update_me', (a) => { got = a.p_patch; return { ok: true }; });
    await start();
    srv.offline = true;
    await updateMe({ lang: 'en' });
    expect(net.value.pending).toBe(1);
    srv.offline = false;
    await flush();
    await until(() => net.value.pending === 0);
    expect(got).toEqual({ lang: 'en' });
  });
  it('refused: listed in the frame', async () => {
    srv.rpc('update_me', () => { throw Object.assign(new Error('Numéro invalide.'), { code: 'bad_phone' }); });
    await start();
    await updateMe({ phone: '123' });
    expect(net.value.failed.length).toBe(1);
    expect(net.value.failed[0].error).toBe('Numéro invalide.');
  });
});

describe('saving a row this device does not hold (core-data-49)', () => {
  it('what the person set reaches the server; the defaults never overwrite it', async () => {
    await start();
    // the customer exists on the server (with lang 'en') but not on this phone
    srv.put('customers', { id: 'c1', first_name: 'Jean', lang: 'en', phone: null });
    await saveCustomer({ id: 'c1', phone: '5145550000' });
    await until(() => net.value.pending === 0);
    expect(srv.table('customers')[0]).toMatchObject({ phone: '5145550000', lang: 'en', first_name: 'Jean' });
  });
});

describe('an inventory item deleted while the answer waits (core-data-14, second half)', () => {
  it('stays on the phone until the server really deleted it', async () => {
    srv.put('inventory_items', { id: 'it1', name: 'Filtre' });
    srv.put('inventory_moves', { id: 'mv1', item_id: 'it1' });
    srv.rpc('inventory_delete', (a, s) => { s.tables.inventory_items = []; s.tables.inventory_moves = []; return { ok: true, id: a.p_item }; });
    await start();
    srv.offline = true;
    setNet({ online: false });
    const r = await deleteInventoryItem('it1');
    expect(r.queued).toBe(true);
    expect(getRow('inventory_items', 'it1')).toBeTruthy();
    srv.offline = false;
    await flush();
    await until(() => !getRow('inventory_items', 'it1'));
    expect(rowsOf('inventory_moves').length).toBe(0);
  });
  it('refused: the item stays', async () => {
    srv.put('inventory_items', { id: 'it2', name: 'Huile' });
    srv.rpc('inventory_delete', () => { throw Object.assign(new Error('Article utilisé.'), { code: 'used' }); });
    await start();
    await expect(deleteInventoryItem('it2')).rejects.toBeTruthy();
    expect(getRow('inventory_items', 'it2')).toBeTruthy();
  });
});
