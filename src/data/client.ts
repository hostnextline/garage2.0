/* The one Supabase client of the team app, and the door every request goes through.
   - A database request (/rest/v1/) never leaves with the public key in place of a person's session: when the session
     is missing (it expired and could not be renewed, or the person signed out meanwhile) supabase-js would send the
     public key, the server would answer « permission denied », and the waiting changes would be taken for refusals
     (core-data-09). The request is answered here with 401 « no session » instead, which the engine reads as « wait ».
   - A request carrying another account's session than the one whose changes are being sent is stopped the same way.
   - Every answer, or its absence, tells `net` whether the server can be reached.
   - `ask` gives a request a time limit that really cancels it (AbortController), and the HTTP status to classify. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../lib/config';
import { AppError, NO_SESSION, OTHER_ACCOUNT, classify } from '../lib/errors';
import { noteTraffic } from './net';

let expected: { uid: string; requireSession: boolean } | null = null;
/** whose changes are sent from now on (null: nobody, every database request needs a session) */
export function expectAccount(uid: string | null, requireSession = true) { expected = uid ? { uid, requireSession } : null; }

function headerOf(input: RequestInfo | URL, init: RequestInit | undefined, name: string): string | null {
  const h = init?.headers;
  if (h) {
    if (h instanceof Headers) return h.get(name);
    if (Array.isArray(h)) { const f = h.find(([k]) => k.toLowerCase() === name.toLowerCase()); return f ? f[1] : null; }
    for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === name.toLowerCase()) return String(v);
  }
  return typeof Request !== 'undefined' && input instanceof Request ? input.headers.get(name) : null;
}
/** the account a session token belongs to (its `sub`), null for the public key or anything unreadable */
export function tokenAccount(token: string | null): string | null {
  const part = token?.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return json && typeof json.sub === 'string' && json.role !== 'anon' ? json.sub : null;
  } catch { return null; }
}
const refusedHere = (code: string, message: string) =>
  new Response(JSON.stringify({ code, message, hint: null, details: null }), { status: 401, headers: { 'content-type': 'application/json' } });

export async function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/rest/v1/') && (!expected || expected.requireSession)) {
    const token = (headerOf(input, init, 'authorization') || '').replace(/^Bearer\s+/i, '');
    const who = token && token !== SUPABASE_KEY ? tokenAccount(token) : null;
    if (!who) return refusedHere(NO_SESSION, 'no session: not sent');
    if (expected && who !== expected.uid) return refusedHere(OTHER_ACCOUNT, 'another account\'s session: not sent');
  }
  try {
    const r = await globalThis.fetch(input, init);
    noteTraffic(true);
    return r;
  } catch (e) {
    // a request we cancelled ourselves (sign-out) says nothing about the network
    if (!(init?.signal?.aborted && init.signal.reason === STOP)) noteTraffic(false);
    throw e;
  }
}
/** the reason given when an engine stops: its requests are cancelled, not failed */
export const STOP = 'his-engine-stopped';

export const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce', storageKey: 'his.auth' },
  realtime: { params: { eventsPerSecond: 10 } },
  global: { fetch: guardedFetch }
});

type Answer = { data: unknown; error: unknown; status?: number };
/** one request with a time limit that cancels it; throws a classified AppError (with the HTTP status) */
export async function ask<T>(build: (signal: AbortSignal) => PromiseLike<Answer>, ms: number, outer?: AbortSignal): Promise<T> {
  const ctl = new AbortController();
  let late = false;
  const tm = setTimeout(() => { late = true; ctl.abort('timeout'); }, ms);
  const stop = () => ctl.abort(STOP);
  if (outer) { if (outer.aborted) stop(); else outer.addEventListener('abort', stop, { once: true }); }
  try {
    const r = await build(ctl.signal);
    if (late) throw new AppError('network', 'timeout', 'timeout', { code: 'timeout' });
    if (ctl.signal.aborted) throw new AppError('network', 'timeout', 'stopped', { code: 'timeout' });
    if (r.error) throw classify(r.error, r.status);
    return r.data as T;
  } catch (e) {
    if (late) throw new AppError('network', 'timeout', 'timeout', { code: 'timeout' });
    throw classify(e);
  } finally {
    clearTimeout(tm);
    outer?.removeEventListener('abort', stop);
  }
}
