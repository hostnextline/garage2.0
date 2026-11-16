/* Who is using the app, and what they may do.
   - The rights always come from the server (my_access); the screen only reads them.
   - The session and the rights are kept on the device: someone who signed in before on this device opens the app on
     their copy at once, with or without signal; the session and the rights are checked behind (core-data-10).
   - « Ton compte n'a pas accès » only when the server answers that this account is not on the team (then this
     account's copy leaves the device; its waiting changes stay); a server hiccup keeps the rights known.
   - Signing out signs out this device only, and the session never stays behind on the device.
   - The server ending the session (signed out elsewhere, account blocked) keeps the waiting changes on the phone:
     they leave when the same person signs in again here (`net.session` = 'lost' meanwhile).
   - « Voir l'app comme… » (owner): the screens follow another person's rights, and nothing can be changed meanwhile. */
import { signal, computed } from '@preact/signals';
import type { Session } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../lib/config';
import { t } from '../lib/i18n';
import { Refused, classify } from '../lib/errors';
import type { Access, Right } from './types';
import { sb, guardedFetch } from './client';
import { startSync, stopSync, resetScreen, pendingCount, isNetworkError, onRemoteChange, applyRows, accessHooks, sessionLost, reconcile, flush, net } from './sync';
import { openLocal } from './local';
import { getRow } from './store';
import { sameValue } from './merge';
export { sb };

export type AuthState = 'loading' | 'signed_out' | 'no_access' | 'ready' | 'invite';
export const authState = signal<AuthState>('loading');
export const session = signal<Session | null>(null);
export const access = signal<Access | null>(null);
export const viewAs = signal<Access | null>(null);
/** what the screens follow: the person previewed, or me */
export const me = computed<Access | null>(() => viewAs.value || access.value);
export const preview = computed(() => !!viewAs.value);
export const inviteToken = signal<string | null>(null);

export function can(r: Right): boolean {
  const a = me.value;
  return !!a && (a.owner || !!a.rights?.[r]);
}
export function hasRole(role: Access['roles'][number]): boolean {
  return !!me.value?.roles?.includes(role);
}
export function isOwner(): boolean { return !!me.value?.owner; }
export function myTrucks(): string[] { return me.value?.trucks || []; }

/* the write lock of « Voir l'app comme… » lives in the data layer's primitives, not in each caller (core-data-36);
   a mechanic without « Agenda » sees only his truck's jobs: the engine watches those that leave */
accessHooks.guard = () => { if (preview.value) throw new Refused('preview', t('errors.preview')); };
accessHooks.narrow = () => { const a = access.value; return !a || (!a.owner && !a.rights?.agenda); };

const ACCESS_KEY = (uid: string) => `his.access.${uid}`;
function cacheAccess(a: Access) { try { localStorage.setItem(ACCESS_KEY(a.id), JSON.stringify(a)); localStorage.setItem('his.lastuid', a.id); } catch { /* the browser keeps nothing: the rights are asked again next time */ } }
function cachedAccess(uid: string): Access | null { try { const s = localStorage.getItem(ACCESS_KEY(uid)); return s ? (JSON.parse(s) as Access) : null; } catch { return null; } }
function forgetAccess(uid: string) { try { localStorage.removeItem(ACCESS_KEY(uid)); } catch { /* nothing kept */ } }
function storedUser(): string | null {
  try { const s = JSON.parse(localStorage.getItem('his.auth') || 'null') as { user?: { id?: string } } | null; return s?.user?.id ?? null; } catch { return null; }
}
function lastUid(): string | null { try { return localStorage.getItem('his.lastuid'); } catch { return null; } }

function timeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => { const tm = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms); Promise.resolve(p).then((v) => { clearTimeout(tm); res(v); }, (e) => { clearTimeout(tm); rej(e); }); });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** reads the invitation link (#invite=…) without losing it on reload */
function readInvite(): string | null {
  const m = /[#&]invite=([A-Za-z0-9_-]{20,80})/.exec(location.hash);
  if (m) { try { sessionStorage.setItem('his.invite', m[1]); } catch { /* kept in the address only */ } return m[1]; }
  try { return sessionStorage.getItem('his.invite'); } catch { return null; }
}
export function clearInvite() {
  inviteToken.value = null;
  try { sessionStorage.removeItem('his.invite'); } catch { /* nothing kept */ }
  if (/invite=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#/');
}

async function loadAccess(): Promise<Access | null> {
  const { data, error, status } = await timeout(sb.rpc('my_access'), 12000);
  if (error) throw classify(error, status);
  return (data as Access | null) ?? null;
}
/** the rights are assigned only when they changed (every pull used to redraw every screen); a change of what the person
    may see re-checks which rows the device should hold (core-data-03) */
function setAccess(a: Access) {
  const before = access.value;
  if (before && sameValue(before, a)) return;
  access.value = a;
  cacheAccess(a);
  if (before && before.id === a.id && !(sameValue(before.rights, a.rights) && sameValue(before.trucks, a.trucks) && sameValue(before.roles, a.roles))) void reconcile();
}

/* ---------- the session's events ---------- */
let listening = false;
let signingOut = false;
/** registered once, on every way in (also the return from Google: core-data-17) */
function listen() {
  if (listening) return;
  listening = true;
  sb.auth.onAuthStateChange((event, s) => {
    session.value = s;
    // outside the auth library's own lock: the work below makes requests
    setTimeout(() => {
      if (event === 'SIGNED_OUT' && !signingOut && authState.value !== 'signed_out') { sessionLost(); void afterSignOut(); }
      else if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && s && net.value.session !== 'ok' && access.value?.id === s.user.id) void flush();
    }, 0);
  });
}

let started = false;
export async function startAuth() {
  if (started) return;
  started = true;
  listen();
  const inv = readInvite();
  if (inv) { inviteToken.value = inv; authState.value = 'invite'; }
  // this device knows the account: its copy opens at once, the session and the rights are checked behind
  const uid = lastUid();
  const cached = uid ? cachedAccess(uid) : null;
  if (uid && cached && storedUser() === uid) {
    access.value = cached;
    await startSync(sb, uid);
    if (!inv) authState.value = 'ready';
    void checkBehind(uid);
    return;
  }
  let s: Session | null = null;
  let unreachable = false;
  try {
    const r = await timeout(sb.auth.getSession(), 6000);
    s = r.data.session;
    if (!s && r.error && isNetworkError(r.error)) unreachable = true;
  } catch { s = null; unreachable = true; }
  session.value = s;
  if (!s) {
    // no signal (or the server can't be reached) with an earlier sign-in on this device: the copy on the phone opens
    if (cached && storedUser() === uid && (unreachable || !navigator.onLine)) {
      access.value = cached; await startSync(sb, uid!); if (!inv) authState.value = 'ready';
      window.addEventListener('online', () => { void checkBehind(uid!); }, { once: true });
      return;
    }
    if (!inv) authState.value = 'signed_out';
    return;
  }
  await enter(s.user.id);
}

/** opened from the device: is the session still good, and what may this person do now? */
async function checkBehind(uid: string) {
  let s: Session | null = null;
  let reachable = true;
  try {
    const r = await timeout(sb.auth.getSession(), 30000);
    s = r.data.session;
    if (!s && r.error && isNetworkError(r.error)) reachable = false;
  } catch { reachable = false; }
  if (s) {
    session.value = s;
    if (s.user.id === uid) { await refreshAccess(); void sb.rpc('update_me', { p_patch: {} }).then(() => undefined, () => undefined); }
    else { stopSync(); resetScreen(); await enter(s.user.id); }
    return;
  }
  if (!reachable || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    // no signal: the copy stays; asked again when the signal comes back
    window.addEventListener('online', () => { void checkBehind(uid); }, { once: true });
    return;
  }
  // the server has no session for this device any more: back to the sign-in, the waiting changes stay here
  if (authState.value === 'signed_out') return;
  sessionLost();
  await afterSignOut();
}

/* the owner changed my roles, my rights, the role table or my truck while my app is open: my rights follow */
let rightsTimer: ReturnType<typeof setTimeout> | null = null;
onRemoteChange((tb, rows) => {
  const a = access.value;
  if (!a || viewAs.value) return;
  const mine = tb === 'settings' || (tb === 'staff' && rows.some((r) => r.id === a.id)) || (tb === 'trucks' && rows.some((r) => r.driver_id === a.id || a.trucks.includes(String(r.id))));
  if (!mine) return;
  if (rightsTimer) clearTimeout(rightsTimer);
  rightsTimer = setTimeout(() => { void refreshAccess(); }, 800);
});

/** this account is not on the team (a clean answer of the server): its copy leaves the device, its waiting changes stay */
async function noAccess(uid: string) {
  stopSync();
  resetScreen();
  forgetAccess(uid);
  access.value = null;
  authState.value = 'no_access';
  const db = openLocal(uid);
  try { await db.wipeRows(); } catch { /* the copy could not be erased now: it is never opened without the rights */ }
  finally { db.close(); }
}

/** after sign-in: what this person may do, then their copy of the data */
async function enter(uid: string) {
  let a: Access | null | undefined;
  for (let i = 0; ; i++) {
    try { a = await loadAccess(); break; }
    catch (e) {
      const cached = cachedAccess(uid);
      // the server did not answer « not a member »: the rights known from last time
      if (cached) { access.value = cached; a = undefined; break; }
      // first sign-in on this device during a hiccup: a few more tries before saying anything
      if (classify(e).kind !== 'network' || i >= 2) { authState.value = 'no_access'; return; }
      await sleep(i === 0 ? 2000 : 5000);
    }
  }
  if (a === null) { await noAccess(uid); return; }
  if (a) setAccess(a);
  await startSync(sb, uid);
  if (authState.value !== 'invite') authState.value = 'ready';
  void sb.rpc('update_me', { p_patch: {} }).then(() => undefined, () => undefined);   // « dernière connexion »
}

/** « Vérifier encore »: the owner may have just added this account */
export async function retryAccess() {
  const s = session.value;
  if (!s) { authState.value = 'signed_out'; return; }
  authState.value = 'loading';
  await enter(s.user.id);
}
export async function refreshAccess() {
  const uid = access.value?.id ?? session.value?.user.id;
  let a: Access | null;
  try { a = await loadAccess(); } catch { return; }   // keep what we know
  if (a) setAccess(a);
  else if (uid) await noAccess(uid);
}

export async function signIn(email: string, password: string): Promise<string | null> {
  listen();
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    if (/invalid login|invalid credentials/i.test(error.message)) return 'auth.wrong';
    if (/banned|disabled/i.test(error.message)) return 'auth.blocked';
    if (isNetworkError(error)) return 'common.networkError';
    return error.message;
  }
  try { localStorage.setItem('his.email', email.trim()); } catch { /* the e-mail is typed again next time */ }
  session.value = data.session;
  await enter(data.user.id);
  return null;
}
export async function googleEnabled(): Promise<boolean> {
  try {
    const r = await timeout(fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } }), 5000);
    const d = await r.json();
    return !!d?.external?.google;
  } catch { return false; }
}
export async function signInGoogle() {
  await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } });
}
/** back from Google (?code=…) */
export async function finishOAuth(): Promise<boolean> {
  const code = new URLSearchParams(location.search).get('code');
  if (!code) return false;
  history.replaceState(null, '', location.pathname + location.hash);
  listen();
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error || !data.session) return false;
  started = true;
  session.value = data.session;
  await enter(data.session.user.id);
  return true;
}

export async function signOut(force = false): Promise<'pending' | 'done'> {
  // what still waits gets a chance to leave first (8 s at most)
  if (net.value.online && (await pendingCount()) > 0) await Promise.race([flush(), sleep(8000)]);
  if (!force && (await pendingCount()) > 0) return 'pending';
  signingOut = true;
  try {
    // nothing leaves any more with a session that is going away
    stopSync();
    // this device only (the default would sign the person out of every phone within the hour: core-data-16)
    await sb.auth.signOut({ scope: 'local' }).catch(() => undefined);
    // without signal and with an expired token the library keeps the session: it must not stay (core-data-27)
    try { localStorage.removeItem('his.auth'); } catch { /* nothing kept */ }
    await afterSignOut();
  } finally { signingOut = false; }
  return 'done';
}
async function afterSignOut() {
  stopSync();
  resetScreen();
  access.value = null; viewAs.value = null; session.value = null;
  authState.value = 'signed_out';
}

/** calls one of the garage's server functions as the signed-in person */
export async function callFn<T = Record<string, unknown>>(name: string, body: Record<string, unknown>, ms = 40000): Promise<T & { ok: boolean; code?: string; error?: string }> {
  const s = (await timeout(sb.auth.getSession(), 10000).catch(() => ({ data: { session: null } }))).data.session;
  const ctl = new AbortController();
  // the request really stops at the limit (it used to keep running after the screen gave up)
  const tm = setTimeout(() => ctl.abort('timeout'), ms);
  let r: Response;
  try {
    r = await guardedFetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${s?.access_token || SUPABASE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
  } catch (e) {
    if (ctl.signal.aborted) throw Object.assign(new Error('timeout'), { code: 'timeout' });
    throw e;
  } finally { clearTimeout(tm); }
  let d: Record<string, unknown> = {};
  try { d = await r.json(); } catch { d = { ok: false, code: 'server', error: `HTTP ${r.status}` }; }
  if (!r.ok && d.ok === undefined) d.ok = false;
  if (d.rows) applyRows(d);
  return d as T & { ok: boolean; code?: string; error?: string };
}

/** owner: see the app as someone else (read-only) */
export async function startPreview(staffId: string): Promise<boolean> {
  const { data, error } = await sb.rpc('access_of', { p_staff: staffId });
  if (error || !data) return false;
  const a = data as Partial<Access>;
  // access_of says the person's roles and rights; their names and colour are on their team row
  const row = getRow<{ id: string; short_name?: string | null; email?: string | null; phone?: string | null; color?: string | null }>('staff', staffId);
  viewAs.value = {
    ...(access.value as Access), ...a,
    short_name: row?.short_name ?? null, email: row?.email ?? null, phone: row?.phone ?? null, color: row?.color ?? null,
    // a co-owner is previewed as an owner (nothing can be changed anyway)
    owner: Array.isArray(a.roles) && a.roles.includes('owner'),
    prefs: {}, lang: access.value?.lang || 'fr'
  } as Access;
  return true;
}
export function stopPreview() { viewAs.value = null; }
