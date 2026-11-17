/* The change functions every screen uses, through the real façade and engine, against the pretend server. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FakeServer, clientFor } from './testkit';
import { startSync, stopSync, net, flush, syncOptions, outbox, resetScreen } from './sync';
import { setNet } from './net';
import { getRow, rowsOf } from './store';
import { addItem, saveSettings, updateMe, saveCustomer, deleteInventoryItem, addPayment, reopenInvoice, sendChat, sendChatPhone, enroute, decodeVin, moveJob, buyStock, moveStock } from './api';
import { itemsOf } from './select';
import { refusalText } from '../app/netView';
import { money } from '../lib/money';
import { lang, t } from '../lib/i18n';
import { errorMessage } from '../lib/errors';

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

describe('a cash payment refused hours later says how much and for whom (argent-app-03)', () => {
  const seed = () => {
    srv.put('customers', { id: 'c1', first_name: 'Jean', last_name: 'Tremblay' });
    srv.put('jobs', { id: 'j1', customer_id: 'c1', status: 'on_site', day: '2026-11-16' });
    srv.put('invoices', { id: 'v1', job_id: 'j1', customer_id: 'c1', number: 42, status: 'issued', total_cents: 20000 });
  };
  it('the waiting payment and its refusal name the amount, the method, the customer and the invoice', async () => {
    seed();
    srv.rpc('payment_add', () => { throw Object.assign(new Error('Ce paiement dépasse ce qui reste à payer.'), { code: 'too_much' }); });
    await start();
    srv.offline = true;
    setNet({ online: false });
    const r = await addPayment('v1', 20000, 'cash', null, 'j1');
    expect(r.queued).toBe(true);
    const label = outbox.value[0].label!;
    expect(label).toContain(money(20000, lang.value));
    expect(label).toContain('Jean Tremblay');
    expect(label).toContain('F-0042');
    srv.offline = false;
    await flush();
    await until(() => net.value.failed.length === 1);
    const row = refusalText(net.value.failed[0]);
    expect(row).toContain(money(20000, lang.value));
    expect(row).toContain('Jean Tremblay');
  });
  it('« Modifier la facture » never overtakes a payment of that invoice still waiting on the phone', async () => {
    seed();
    const order: string[] = [];
    srv.rpc('payment_add', () => { order.push('payment_add'); return { ok: true }; });
    srv.rpc('invoice_reopen', () => { order.push('invoice_reopen'); return { ok: true, number: 42 }; });
    await start();
    srv.offline = true;
    setNet({ online: false });
    expect((await addPayment('v1', 20000, 'cash', null, 'j1')).queued).toBe(true);
    // still no signal: refused here, nothing reaches the server
    await expect(reopenInvoice('v1')).rejects.toMatchObject({ kind: 'refusal', hint: 'payment_waiting' });
    expect(order).toEqual([]);
    // the signal is back: the payment leaves first, then the invoice is reopened
    srv.offline = false;
    setNet({ online: true });
    await reopenInvoice('v1');
    expect(order).toEqual(['payment_add', 'invoice_reopen']);
  });
  it('without a waiting payment it goes straight to the server, as before', async () => {
    seed();
    srv.rpc('invoice_reopen', () => ({ ok: true, number: 42 }));
    await start();
    const r = await reopenInvoice('v1');
    expect(r.data).toMatchObject({ ok: true });
    expect(srv.count((c) => c.table === 'rpc/payment_add')).toBe(0);
  });
});

describe('a text or a trip carries its operation id when the screen gives one (R28)', () => {
  const bodies = (fn: string) => srv.calls.filter((c) => c.method === 'POST' && c.url.pathname.endsWith(`/functions/v1/${fn}`)).map((c) => c.body as Record<string, unknown>);
  it('sendChat, sendChatPhone and enroute send `op`; without one the body is as before', async () => {
    await start();
    await sendChat('c1', 'Bonjour', 'op-chat');
    await sendChatPhone('5145550000', 'Allô', 'op-phone');
    await enroute('return', null, { pos: { lat: 45.5, lng: -73.6 }, op: 'op-trip' });
    await sendChat('c1', 'Sans id');
    await enroute('start', 'j1', { notify: true });
    const chat = bodies('conversation');
    expect(chat[0]).toMatchObject({ action: 'send', customer_id: 'c1', message: 'Bonjour', op: 'op-chat' });
    expect(chat[1]).toMatchObject({ action: 'send', phone: '5145550000', message: 'Allô', op: 'op-phone' });
    expect('op' in chat[2]).toBe(false);
    const trips = bodies('enroute');
    expect(trips[0]).toMatchObject({ action: 'return', pos: { lat: 45.5, lng: -73.6 }, op: 'op-trip' });
    expect('job_id' in trips[0]).toBe(false);
    expect(trips[1]).toMatchObject({ action: 'start', job_id: 'j1', notify: true });
    expect('op' in trips[1]).toBe(false);
  });
});

describe('a server function\'s refusal says which function gave it (R144)', () => {
  it('the VIN base too slow (504, code timeout): « un service extérieur ne répond pas », not « vérifie Internet »', async () => {
    await start();
    srv.failNext((c) => c.url.pathname.endsWith('/functions/v1/vin'), 504, { ok: false, code: 'timeout', error: 'La base des NIV ne répond pas.' });
    const r = await decodeVin('1HGCM82633A004352');
    expect(r).toMatchObject({ ok: false, code: 'timeout', at: 'vin' });
    expect(errorMessage(r)).toBe(t('errors.timeout'));
  });
  it('while the garage books by arrival windows (settings), the block refusals say « day »', async () => {
    srv.put('settings', { id: '1', booking: { windows_on: true } });
    await start();
    const was = lang.value;
    lang.value = 'en';
    try {
      expect(errorMessage({ code: 'P0001', hint: 'block_closed', message: 'Ce bloc est fermé.' })).toBe(t('errors.day.block_closed'));
      // back to blocks: the block words again
      resetScreen();
      expect(errorMessage({ code: 'P0001', hint: 'block_closed', message: 'Ce bloc est fermé.' })).toBe(t('errors.block_closed'));
    } finally { lang.value = was; }
  });
});

describe('ids and options other packages asked for (R188, R212)', () => {
  it('moveJob with queue: false says at once that it could not be done, instead of « kept »', async () => {
    srv.rpc('move_job', () => ({ ok: true, changed: true }));
    await start();
    srv.offline = true;
    setNet({ online: false });
    await expect(moveJob('j1', '2026-11-17', 'am', null, null, { queue: false })).rejects.toMatchObject({ kind: 'network' });
    expect(net.value.pending).toBe(0);
    // without the option: kept on the phone, as before
    expect((await moveJob('j1', '2026-11-17', 'am')).queued).toBe(true);
    expect(net.value.pending).toBe(1);
  });
  it('buyStock sends the form\'s op; the same purchase sent twice is done once', async () => {
    const ops: string[] = [];
    const done = new Set<string>();
    srv.rpc('inventory_buy', (a) => { ops.push(String(a.p_op)); if (done.has(String(a.p_op))) return { ok: true, op_done: true }; done.add(String(a.p_op)); return { ok: true }; });
    await start();
    await buyStock('it1', 2, 2000, 'treasury', null, null, 'op-form-1');
    await buyStock('it1', 2, 2000, 'treasury', null, null, 'op-form-1');
    expect(ops).toEqual(['op-form-1', 'op-form-1']);
    expect(done.size).toBe(1);
    // without one, each call has its own
    await buyStock('it1', 1, 1000, 'none', null, null);
    expect(ops[2]).not.toBe('op-form-1');
  });
  it('moveStock keeps the id it is given: the same move sent twice is one row', async () => {
    await start();
    expect(await moveStock('it1', 3, 'restock', null, 'mv-form-1')).toBe('mv-form-1');
    await moveStock('it1', 3, 'restock', null, 'mv-form-1');
    await until(() => net.value.pending === 0);
    expect(srv.table('inventory_moves').filter((r) => r.id === 'mv-form-1').length).toBe(1);
  });
});
