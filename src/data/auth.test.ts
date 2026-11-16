/* Who is signed in, on this device: each case loads the modules afresh (their state is per page). */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeServer, jwt } from './testkit';
import type { Access } from './types';

let srv: FakeServer;
let n = 0;
const nextUid = () => `00000000-0000-4000-a000-${String(++n).padStart(12, '0')}`;
const who = (id: string): Access => ({ id, full_name: 'Saleh', short_name: 'Saleh', email: 's@x', phone: null, roles: ['mechanic'], owner: false, lang: 'fr', prefs: {}, color: null,
  rights: { clients: true } as Access['rights'], trucks: ['t1'] });
/** this device signed in before: session, rights and last account kept */
function signedBefore(uid: string) {
  const session = { access_token: jwt(uid), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: uid, aud: 'authenticated', email: 's@x', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' } };
  localStorage.setItem('his.auth', JSON.stringify(session));
  localStorage.setItem('his.lastuid', uid);
  localStorage.setItem(`his.access.${uid}`, JSON.stringify(who(uid)));
}
async function fresh() {
  vi.resetModules();
  (globalThis as { fetch: unknown }).fetch = srv.fetch;
  const auth = await import('./auth');
  const sync = await import('./sync');
  const local = await import('./local');
  const store = await import('./store');
  const client = await import('./client');
  sync.syncOptions.realtime = false;
  return { auth, sync, local, store, client };
}
async function until(ok: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}

beforeEach(() => { srv = new FakeServer(); localStorage.clear(); });

describe('start', () => {
  it('a device that knows the account opens on its copy at once, while the server says nothing (core-data-10)', async () => {
    const uid = nextUid();
    signedBefore(uid);
    const m = await fresh();
    const db = m.local.openLocal(uid);
    await db.commit({ rows: [{ table: 'jobs', put: [{ id: 'j1', status: 'booked', updated_at: '2026-11-15T10:00:00Z' }], del: [] }] });
    db.close();
    srv.hold();   // the server never answers
    const t0 = Date.now();
    await m.auth.startAuth();
    expect(m.auth.authState.value).toBe('ready');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(m.store.getRow('jobs', 'j1')).toBeTruthy();
    expect(m.auth.access.value?.id).toBe(uid);
    m.sync.stopSync();
  });

  it('« pas accès » only when the server answers that this account is not on the team; its copy then leaves (x-errors-06, core-data-42)', async () => {
    const uid = nextUid();
    signedBefore(uid);
    srv.rpc('my_access', () => null);
    const m = await fresh();
    const db = m.local.openLocal(uid);
    await db.commit({ rows: [{ table: 'customers', put: [{ id: 'c1' }], del: [] }] });
    await db.addEntry({ op: 'keep', kind: 'rpc', rpc: 'job_step', args: {}, at: 'x', tries: 0, state: 'pending' });
    db.close();
    await m.auth.startAuth();
    await until(() => m.auth.authState.value === 'no_access');
    expect(localStorage.getItem(`his.access.${uid}`)).toBeNull();
    expect(m.store.getRow('customers', 'c1')).toBeUndefined();
    const again = m.local.openLocal(uid);
    const l = await again.loadAll();
    again.close();
    expect(l.rows.customers).toEqual([]);
    expect(l.outbox.map((e) => e.op)).toEqual(['keep']);
  });

  it('a server hiccup keeps the rights known (no « pas accès » on a 503)', async () => {
    const uid = nextUid();
    signedBefore(uid);
    srv.failNext((c) => c.table === 'rpc/my_access', 500, { code: 'PGRST002', message: 'schema cache' }, 5);
    const m = await fresh();
    await m.auth.startAuth();
    await new Promise((r) => setTimeout(r, 300));
    expect(m.auth.authState.value).toBe('ready');
    expect(m.auth.access.value?.id).toBe(uid);
    m.sync.stopSync();
  });

  it('new rights are assigned only when they changed (every pull used to redraw every screen: core-data-39)', async () => {
    const uid = nextUid();
    signedBefore(uid);
    srv.rpc('my_access', () => ({ ...who(uid), trucks: ['t1', 't2'] }));
    const m = await fresh();
    await m.auth.startAuth();
    await until(() => (m.auth.access.value?.trucks.length ?? 0) === 2);
    const a = m.auth.access.value;
    await m.auth.refreshAccess();
    expect(m.auth.access.value).toBe(a);
    m.sync.stopSync();
  });
});

describe('sign-out', () => {
  it('this device only, and the session never stays behind, even when the library fails offline (core-data-16, core-data-27)', async () => {
    const uid = nextUid();
    signedBefore(uid);
    srv.hold();
    const m = await fresh();
    await m.auth.startAuth();
    const out = vi.fn(async () => ({ error: new Error('offline') }));
    (m.client.sb.auth as unknown as { signOut: unknown }).signOut = out;
    expect(await m.auth.signOut()).toBe('done');
    expect(out).toHaveBeenCalledWith({ scope: 'local' });
    expect(localStorage.getItem('his.auth')).toBeNull();
    expect(m.auth.authState.value).toBe('signed_out');
  });

  it('with changes waiting: « pending » unless forced; forced keeps them on the device for next time', async () => {
    const uid = nextUid();
    signedBefore(uid);
    srv.offline = true;
    const m = await fresh();
    await m.auth.startAuth();
    m.sync.net.value = { ...m.sync.net.value, online: false };
    await m.sync.insertRow('customers', { id: 'c1', first_name: 'A' });
    (m.client.sb.auth as unknown as { signOut: unknown }).signOut = async () => ({ error: null });
    expect(await m.auth.signOut()).toBe('pending');
    expect(await m.auth.signOut(true)).toBe('done');
    const db = m.local.openLocal(uid);
    expect((await db.listEntries()).length).toBe(1);
    db.close();
  });

  it('the server ending the session keeps the waiting changes and says « session lost » (core-data-09, x-errors-11)', async () => {
    const uid = nextUid();
    signedBefore(uid);
    srv.offline = true;
    const m = await fresh();
    let fire: ((event: string, s: null) => void) | null = null;
    (m.client.sb.auth as unknown as { onAuthStateChange: unknown }).onAuthStateChange = (cb: (event: string, s: null) => void) => { fire = cb; return { data: { subscription: { unsubscribe() {} } } }; };
    await m.auth.startAuth();
    await m.sync.insertRow('customers', { id: 'c1', first_name: 'A' });
    fire!('SIGNED_OUT', null);
    await until(() => m.auth.authState.value === 'signed_out');
    expect(m.sync.net.value.session).toBe('lost');
    const db = m.local.openLocal(uid);
    expect((await db.listEntries()).map((e) => e.state)).toEqual(['pending']);
    db.close();
  });
});

describe('back from Google (core-data-17)', () => {
  it('the session events are heard and the session is known', async () => {
    const uid = nextUid();
    srv.rpc('my_access', () => who(uid));
    const m = await fresh();
    const listen = vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } }));
    (m.client.sb.auth as unknown as { onAuthStateChange: unknown }).onAuthStateChange = listen;
    const session = { access_token: jwt(uid), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: uid, aud: 'authenticated', email: 'g@x', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' } };
    // the library keeps the session it got for the code (as it does for real)
    (m.client.sb.auth as unknown as { exchangeCodeForSession: unknown }).exchangeCodeForSession = async () => { localStorage.setItem('his.auth', JSON.stringify(session)); return { data: { session }, error: null }; };
    history.replaceState(null, '', '/?code=abc#/');
    expect(await m.auth.finishOAuth()).toBe(true);
    expect(listen).toHaveBeenCalledTimes(1);
    expect(m.auth.session.value?.user.id).toBe(uid);
    expect(m.auth.authState.value).toBe('ready');
    m.sync.stopSync();
    history.replaceState(null, '', '/');
  });
});

describe('« Voir l\'app comme… »', () => {
  it('nothing can be changed, from any door (core-data-36)', async () => {
    const uid = nextUid();
    signedBefore(uid);
    srv.hold();
    const m = await fresh();
    await m.auth.startAuth();
    m.auth.viewAs.value = who('other');
    await expect(m.sync.insertRow('customers', { id: 'c1' })).rejects.toMatchObject({ hint: 'preview' });
    await expect(m.sync.updateRow('customers', 'c1', { first_name: 'x' })).rejects.toMatchObject({ hint: 'preview' });
    await expect(m.sync.callRpc('job_step', { p_job: 'j' })).rejects.toMatchObject({ hint: 'preview' });
    m.auth.viewAs.value = null;
    m.sync.stopSync();
  });
  it('a co-owner is previewed as an owner, with their own name (app-shell-27, x-rights-18)', async () => {
    const uid = nextUid();
    signedBefore(uid);
    srv.rpc('access_of', () => ({ id: 'o2', full_name: 'Ibrahim', roles: ['owner', 'treasurer'], rights: {}, trucks: [] }));
    const m = await fresh();
    m.store.replaceLocal('staff', [{ id: 'o2', short_name: 'Ibra', full_name: 'Ibrahim' }]);
    m.auth.access.value = { ...who(uid), owner: true, roles: ['owner'] };
    (m.client.sb as unknown as { rpc: unknown }).rpc = async () => ({ data: { id: 'o2', full_name: 'Ibrahim', roles: ['owner', 'treasurer'], rights: {}, trucks: [] }, error: null });
    expect(await m.auth.startPreview('o2')).toBe(true);
    expect(m.auth.viewAs.value?.owner).toBe(true);
    expect(m.auth.viewAs.value?.short_name).toBe('Ibra');
  });
});
