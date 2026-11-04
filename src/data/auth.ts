/* Who is using the app, and what they may do.
   - The rights always come from the server (my_access); the screen only reads them.
   - The session and the rights are kept on the device, so the app opens without signal for someone who signed in before.
   - « Voir l'app comme… » (owner): the screens follow another person's rights, and nothing can be changed meanwhile. */
import { signal, computed } from '@preact/signals';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../lib/config';
import type { Access, Right } from './types';
import { startSync, stopSync, resetScreen, pendingCount, isNetworkError, onRemoteChange } from './sync';
import { closeLocal } from './local';

export const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce', storageKey: 'his.auth' },
  realtime: { params: { eventsPerSecond: 10 } }
});

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

const ACCESS_KEY = (uid: string) => `his.access.${uid}`;
function cacheAccess(a: Access) { try { localStorage.setItem(ACCESS_KEY(a.id), JSON.stringify(a)); localStorage.setItem('his.lastuid', a.id); } catch { /* ignore */ } }
function cachedAccess(uid: string): Access | null { try { const s = localStorage.getItem(ACCESS_KEY(uid)); return s ? (JSON.parse(s) as Access) : null; } catch { return null; } }

function timeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms); Promise.resolve(p).then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });
}

/** reads the invitation link (#invite=…) without losing it on reload */
function readInvite(): string | null {
  const m = /[#&]invite=([A-Za-z0-9_-]{20,80})/.exec(location.hash);
  if (m) { try { sessionStorage.setItem('his.invite', m[1]); } catch { /* ignore */ } return m[1]; }
  try { return sessionStorage.getItem('his.invite'); } catch { return null; }
}
export function clearInvite() {
  inviteToken.value = null;
  try { sessionStorage.removeItem('his.invite'); } catch { /* ignore */ }
  if (/invite=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#/');
}

export async function loadAccess(): Promise<Access | null> {
  const { data, error } = await timeout(sb.rpc('my_access'), 12000);
  if (error) throw error;
  return (data as Access | null) ?? null;
}

let started = false;
export async function startAuth() {
  if (started) return;
  started = true;
  sb.auth.onAuthStateChange((event, s) => {
    session.value = s;
    if (event === 'SIGNED_OUT') { void afterSignOut(); }
  });
  const inv = readInvite();
  if (inv) { inviteToken.value = inv; authState.value = 'invite'; }
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
    const uid = (() => { try { return localStorage.getItem('his.lastuid'); } catch { return null; } })();
    const stored = (() => { try { return JSON.parse(localStorage.getItem('his.auth') || 'null'); } catch { return null; } })();
    const cached = uid ? cachedAccess(uid) : null;
    if (cached && stored?.user?.id === uid && (unreachable || !navigator.onLine)) {
      access.value = cached; await startSync(sb, uid!); if (!inv) authState.value = 'ready';
      // when the signal comes back, the session is checked again
      window.addEventListener('online', () => { void sb.auth.getSession().then(({ data }) => { if (data.session) { session.value = data.session; void refreshAccess(); } }); }, { once: true });
      return;
    }
    if (!inv) authState.value = 'signed_out';
    return;
  }
  await enter(s.user.id);
}

/* the owner changed my roles, my rights, the role table or my truck while my app is open: my rights follow */
let rightsTimer: ReturnType<typeof setTimeout> | null = null;
onRemoteChange((t, rows) => {
  const a = access.value;
  if (!a || viewAs.value) return;
  const mine = t === 'settings' || (t === 'staff' && rows.some((r) => r.id === a.id)) || (t === 'trucks' && rows.some((r) => r.driver_id === a.id || a.trucks.includes(String(r.id))));
  if (!mine) return;
  if (rightsTimer) clearTimeout(rightsTimer);
  rightsTimer = setTimeout(() => { void refreshAccess(); }, 800);
});

/** after sign-in: what this person may do, then their copy of the data */
async function enter(uid: string) {
  try {
    const a = await loadAccess();
    if (!a) { access.value = null; authState.value = 'no_access'; return; }
    access.value = a;
    cacheAccess(a);
  } catch (e) {
    const cached = cachedAccess(uid);
    if (cached && isNetworkError(e)) access.value = cached;   // no signal: the rights known from last time
    else { authState.value = 'no_access'; return; }
  }
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
  try { const a = await loadAccess(); if (a) { access.value = a; cacheAccess(a); } else authState.value = 'no_access'; } catch { /* keep what we know */ }
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    if (/invalid login|invalid credentials/i.test(error.message)) return 'auth.wrong';
    if (/banned|disabled/i.test(error.message)) return 'auth.blocked';
    if (isNetworkError(error)) return 'common.networkError';
    return error.message;
  }
  try { localStorage.setItem('his.email', email.trim()); } catch { /* ignore */ }
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
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error || !data.session) return false;
  await enter(data.session.user.id);
  return true;
}

export async function signOut(force = false): Promise<'pending' | 'done'> {
  if (!force && (await pendingCount()) > 0) return 'pending';
  await sb.auth.signOut().catch(() => undefined);
  await afterSignOut();
  return 'done';
}
async function afterSignOut() {
  stopSync();
  resetScreen();
  await closeLocal();
  access.value = null; viewAs.value = null;
  authState.value = 'signed_out';
}

/** calls one of the garage's server functions as the signed-in person */
export async function callFn<T = Record<string, unknown>>(name: string, body: Record<string, unknown>, ms = 40000): Promise<T & { ok: boolean; code?: string; error?: string }> {
  const s = (await sb.auth.getSession()).data.session;
  const r = await timeout(fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${s?.access_token || SUPABASE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }), ms);
  let d: Record<string, unknown> = {};
  try { d = await r.json(); } catch { d = { ok: false, code: 'server', error: `HTTP ${r.status}` }; }
  if (!r.ok && d.ok === undefined) d.ok = false;
  return d as T & { ok: boolean; code?: string; error?: string };
}

/** owner: see the app as someone else (read-only) */
export async function startPreview(staffId: string): Promise<boolean> {
  const { data, error } = await sb.rpc('access_of', { p_staff: staffId });
  if (error || !data) return false;
  const a = data as Partial<Access>;
  viewAs.value = { ...(access.value as Access), ...a, owner: false, prefs: {}, lang: access.value?.lang || 'fr' } as Access;
  return true;
}
export function stopPreview() { viewAs.value = null; }
