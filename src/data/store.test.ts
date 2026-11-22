import { describe, it, expect, beforeEach } from 'vitest';
import { effect } from '@preact/signals';
import { bindStore, unbindStore, getRow, rowsOf, tableSignal, upsertLocal, replaceLocal, patchLocal, removeLocal, clearAll, baseRow, type Waiting } from './store';
import { waitingOf } from './overlay';
import type { OutboxEntry } from './local';
import { net, setNet, noteTraffic, browserOffline } from './net';

const T1 = '2026-11-15T10:00:00.1+00:00';
const T2 = '2026-11-15T10:00:00.123456+00:00';
const T0 = '2026-11-15T10:00:00.099999+00:00';

beforeEach(() => clearAll());

describe('server rows (not-older rule)', () => {
  it('an older copy is ignored; a newer one applied; the same one changes nothing', () => {
    upsertLocal('jobs', [{ id: 'j', status: 'booked', updated_at: T1 }]);
    upsertLocal('jobs', [{ id: 'j', status: 'old', updated_at: T0 }]);
    expect(getRow('jobs', 'j')?.status).toBe('booked');
    // .123456 is later than .1 (string order says the opposite)
    upsertLocal('jobs', [{ id: 'j', status: 'on_site', updated_at: T2 }]);
    expect(getRow('jobs', 'j')?.status).toBe('on_site');
  });
  it('nothing new: the table\'s signal is not written, rows keep their object (core-data-39, x-reactivity-05)', () => {
    upsertLocal('customers', [{ id: 'a', first_name: 'A', updated_at: T1 }, { id: 'b', first_name: 'B', updated_at: T1 }]);
    const before = tableSignal('customers').value;
    const a = getRow('customers', 'a');
    let draws = 0;
    const stop = effect(() => { void tableSignal('customers').value; draws++; });
    draws = 0;
    const r = upsertLocal('customers', [{ id: 'a', first_name: 'A', updated_at: T1 }]);
    expect(r.put).toEqual([]);
    expect(tableSignal('customers').value).toBe(before);
    expect(getRow('customers', 'a')).toBe(a);
    expect(draws).toBe(0);
    upsertLocal('customers', [{ id: 'a', first_name: 'A2', updated_at: T2 }, { id: 'b', first_name: 'B2', updated_at: T2 }]);
    expect(draws).toBe(1);
    stop();
  });
  it('the same stamp with other content: the server wins (a local edit baked in by the previous version)', () => {
    replaceLocal('jobs', [{ id: 'j', notes: 'local', updated_at: T1 }]);
    upsertLocal('jobs', [{ id: 'j', notes: 'server', updated_at: T1 }]);
    expect(getRow('jobs', 'j')?.notes).toBe('server');
  });
  it('a deleted row leaves; a row with deleted_at is never shown', () => {
    upsertLocal('jobs', [{ id: 'j', updated_at: T1 }]);
    upsertLocal('jobs', [{ id: 'j', updated_at: T2, deleted_at: T2 }]);
    expect(getRow('jobs', 'j')).toBeUndefined();
    replaceLocal('jobs', [{ id: 'k', deleted_at: T1 }]);
    expect(rowsOf('jobs')).toEqual([]);
  });
});

describe('waiting changes on top (the overlay, core-data-43)', () => {
  const pending = (p: Partial<OutboxEntry>): OutboxEntry => ({ op: String(Math.random()), at: T1, tries: 0, state: 'pending', kind: 'update', ...p } as OutboxEntry);
  it('a waiting edit survives a newer server copy, and the server\'s other fields show', () => {
    const w = bindStore({});
    w.loadAll({ jobs: [{ id: 'j', notes: null, duration_min: 60, updated_at: T1 }] }, waitingOf([{ e: pending({ table: 'jobs', id: 'j', values: { notes: 'Code 4521' } }), kept: true }]));
    expect(getRow('jobs', 'j')?.notes).toBe('Code 4521');
    w.apply('jobs', [{ id: 'j', notes: null, duration_min: 90, updated_at: T2 }]);
    expect(getRow('jobs', 'j')).toMatchObject({ notes: 'Code 4521', duration_min: 90 });
    expect(baseRow('jobs', 'j')?.notes).toBeNull();
  });
  it('a refused (or dismissed) change: the row is exactly the server\'s again', () => {
    const w = bindStore({});
    const e = pending({ table: 'customers', id: 'c', values: { first_name: 'Faux' } });
    w.loadAll({ customers: [{ id: 'c', first_name: 'Vrai', updated_at: T1 }] }, waitingOf([{ e, kept: true }]));
    expect(getRow('customers', 'c')?.first_name).toBe('Faux');
    w.setWaiting(waitingOf([{ e: { ...e, state: 'failed' }, kept: true }]));
    expect(getRow('customers', 'c')?.first_name).toBe('Vrai');
  });
  it('a new row waits on screen; a soft delete hides it; a kept job step shows its status', () => {
    const w = bindStore({});
    const waiting: Waiting = waitingOf([
      { e: pending({ kind: 'insert', table: 'customers', id: 'n', values: { id: 'n', first_name: 'Nouveau' } }), kept: true },
      { e: pending({ table: 'vehicles', id: 'v', values: { deleted_at: T2 } }), kept: true },
      { e: pending({ kind: 'rpc', rpc: 'job_step', args: { p_job: 'j', p_action: 'arrive' } }), kept: true },
      { e: pending({ kind: 'rpc', rpc: 'job_step', args: { p_job: 'k', p_action: 'leave' } }), kept: false }
    ]);
    w.loadAll({ vehicles: [{ id: 'v', updated_at: T1 }], jobs: [{ id: 'j', status: 'en_route', updated_at: T1 }, { id: 'k', status: 'booked', updated_at: T1 }] }, waiting);
    expect(getRow('customers', 'n')?.first_name).toBe('Nouveau');
    expect(getRow('vehicles', 'v')).toBeUndefined();
    expect(getRow('jobs', 'j')?.status).toBe('on_site');
    // still waited for by the screen: nothing ahead (the red button never changes under a finger)
    expect(getRow('jobs', 'k')?.status).toBe('booked');
  });
  it('a late answer of an engine that lost the screen is dropped (core-data-07)', () => {
    const old = {};
    const a = bindStore(old);
    const b = bindStore({});
    a.apply('customers', [{ id: 'of-A', updated_at: T1 }]);
    expect(getRow('customers', 'of-A')).toBeUndefined();
    b.apply('customers', [{ id: 'of-B', updated_at: T1 }]);
    expect(getRow('customers', 'of-B')).toBeTruthy();
    unbindStore(old);
    expect(b.live).toBe(true);
  });
});

describe('direct doors kept for features and tests', () => {
  it('patchLocal shows a value ahead until the server sends that row again', () => {
    upsertLocal('inventory_items', [{ id: 'i', qty: 2, updated_at: T1 }]);
    expect(patchLocal('inventory_items', 'i', { qty: 5 })?.qty).toBe(5);
    expect(getRow('inventory_items', 'i')?.qty).toBe(5);
    upsertLocal('inventory_items', [{ id: 'i', qty: 4, updated_at: T2 }]);
    expect(getRow('inventory_items', 'i')?.qty).toBe(4);
    expect(patchLocal('inventory_items', 'nope', { qty: 1 })).toBeUndefined();
  });
  it('patchLocal on a row that only waits to be created still shows', () => {
    const w = bindStore({});
    w.loadAll({}, waitingOf([{ e: { op: 'x', at: T1, tries: 0, state: 'pending', kind: 'insert', table: 'inventory_items', id: 'new', values: { id: 'new', qty: 0 } }, kept: true }]));
    expect(patchLocal('inventory_items', 'new', { qty: 3 })?.qty).toBe(3);
  });
  it('removeLocal and replaceLocal', () => {
    replaceLocal('trucks', [{ id: 't1' }, { id: 't2' }]);
    removeLocal('trucks', ['t1']);
    expect(rowsOf('trucks').map((r) => r.id)).toEqual(['t2']);
  });
});

describe('net: online without flapping (x-errors-10, x-reactivity-13)', () => {
  beforeEach(() => setNet({ online: true }));
  it('one lost request does not say « hors ligne »; two do; any answer says online again', () => {
    noteTraffic(false);
    expect(net.value.online).toBe(true);
    noteTraffic(false);
    expect(net.value.online).toBe(false);
    noteTraffic(true);
    expect(net.value.online).toBe(true);
  });
  it('the browser saying offline is believed at once', () => {
    browserOffline();
    expect(net.value.online).toBe(false);
  });
  it('setNet with nothing new does not write the signal', () => {
    const v = net.value;
    setNet({ online: v.online, failed: [...v.failed] });
    expect(net.value).toBe(v);
  });
});
