/* DEV ONLY — a pretend server for the demo (npm run dev, then open /?demo). It answers the app's requests to the
   database (tables, operations) and server functions from data kept in memory, so every screen can be tried and
   photographed without the real server. Nothing here is part of the real app or of the tests of the real server.
   Add the operations your screens need with registerRpc / registerFn (see src/dev/demo-extra/). */
import { SUPABASE_URL } from '../lib/config';
import { visible, mayWrite } from './demo-rules';

export type DemoRow = Record<string, unknown> & { id: string };
export const db: Record<string, DemoRow[]> = {};
type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>;
const rpcs = new Map<string, Handler>();
const fns = new Map<string, Handler>();
/** a section's own pretend operation wins over the core's (core ones are registered with weak: true) */
export function registerRpc(name: string, fn: Handler, o: { weak?: boolean } = {}) { if (o.weak && rpcs.has(name)) return; rpcs.set(name, fn); }
/** the operation registered under a name right now (to wrap it: src/dev/demo-windows.ts) */
export function rpcOf(name: string): Handler | undefined { return rpcs.get(name); }
export function registerFn(name: string, fn: Handler, o: { weak?: boolean } = {}) { if (o.weak && fns.has(name)) return; fns.set(name, fn); }
/** every operation the pretend server answers right now (the test that holds the demo to the app's calls reads it) */
export function registeredRpcs(): string[] { return [...rpcs.keys()].sort(); }
export function registeredFns(): string[] { return [...fns.keys()].sort(); }
/** the server function registered under a name right now */
export function fnOf(name: string): Handler | undefined { return fns.get(name); }
/* the answer of an operation already done, by its p_op (op_begin / op_done of the database): a change sent again
   because its first answer was lost is not applied twice */
const doneOps = new Map<string, unknown>();
/** forget what earlier demos left in memory (a fresh demo, a test) */
export function resetOps() { doneOps.clear(); }

export const nowIso = () => new Date().toISOString();
export function uuid(): string { return crypto.randomUUID(); }
export function table(name: string): DemoRow[] { return (db[name] ||= []); }
export function find(name: string, id: unknown): DemoRow | undefined { return table(name).find((r) => r.id === String(id)); }
/** insert or change a row (sets updated_at, like the database) and returns it */
export function put(name: string, row: Partial<DemoRow> & { id?: string }): DemoRow {
  const t = table(name);
  const id = String(row.id || uuid());
  const cur = t.find((r) => r.id === id);
  const at = nowIso();
  if (cur) { Object.assign(cur, row, { id, updated_at: at }); return cur; }
  const n = { created_at: at, deleted_at: null, ...row, id, updated_at: at } as DemoRow;
  t.push(n);
  return n;
}
/** what operations return: { ok, rows: { table: [rows] } } so the screen updates at once */
export function rows(map: Record<string, DemoRow[] | DemoRow | undefined>): Record<string, DemoRow[]> {
  const out: Record<string, DemoRow[]> = {};
  for (const [k, v] of Object.entries(map)) if (v) out[k] = Array.isArray(v) ? v : [v];
  return out;
}
export class DemoRefusal extends Error { constructor(public code: string, message: string) { super(message); } }
export function refuse(code: string, message: string): never { throw new DemoRefusal(code, message); }

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function matchFilter(row: DemoRow, key: string, expr: string): boolean {
  const v = row[key];
  const [op, ...rest] = expr.split('.');
  const arg = rest.join('.');
  switch (op) {
    case 'eq': return String(v) === arg;
    case 'neq': return String(v) !== arg;
    case 'is': return arg === 'null' ? v == null : String(v) === arg;
    case 'gte': return String(v ?? '') >= arg;
    case 'lte': return String(v ?? '') <= arg;
    case 'gt': return String(v ?? '') > arg;
    case 'lt': return String(v ?? '') < arg;
    case 'in': return arg.replace(/^\(|\)$/g, '').split(',').includes(String(v));
    default: return true;
  }
}
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
/** PostgREST's `order=col.asc,col2.desc.nullslast` (no order: by updated_at then id, as before) */
function sorter(order: string | null): (a: DemoRow, b: DemoRow) => number {
  const keys = (order || '').split(',').filter(Boolean).map((k) => {
    const [col, ...mods] = k.split('.');
    return { col, desc: mods.includes('desc'), nullsFirst: mods.includes('nullsfirst') ? true : mods.includes('nullslast') ? false : mods.includes('desc') };
  });
  if (!keys.length) return (a, b) => String(a.updated_at).localeCompare(String(b.updated_at)) || a.id.localeCompare(b.id);
  return (a, b) => {
    for (const k of keys) {
      const x = a[k.col], y = b[k.col];
      if (x == null || y == null) { if (x == null && y == null) continue; return (x == null) === k.nullsFirst ? -1 : 1; }
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      if (c) return k.desc ? -c : c;
    }
    return 0;
  };
}
/** what PostgREST answers when a row rule refuses a write */
const rlsRefusal = (name: string) => reply(403, { code: '42501', message: `new row violates row-level security policy for table "${name}"`, hint: null, details: null });

/** one request to the pretend server, as the app sends it (exported for the tests) */
export async function handle(url: URL, init: RequestInit): Promise<Response> {
  const path = url.pathname.replace(/^.*?\/(rest|functions|auth|storage|realtime)\/v1\//, '$1/');
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});
  let body: unknown = undefined;
  try { body = init.body ? JSON.parse(String(init.body)) : undefined; } catch { body = undefined; }
  try {
    if (path.startsWith('rest/rpc/')) {
      const name = path.slice('rest/rpc/'.length);
      const h = rpcs.get(name);
      // an operation the demo does not know is not « ok »: the same answer as a database without that function (demo-01)
      if (!h) {
        console.warn(`[demo] operation absente de la démo : ${name}`);
        return reply(404, { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache (Pas disponible dans la démo.)`, hint: null, details: null });
      }
      const args = (body || {}) as Record<string, unknown>;
      const op = typeof args.p_op === 'string' && args.p_op ? `${name}:${args.p_op}` : null;
      if (op && doneOps.has(op)) return reply(200, doneOps.get(op) ?? null);
      const out = await h(args);
      if (op) doneOps.set(op, out ?? null);
      return reply(200, out ?? null);
    }
    if (path.startsWith('functions/')) {
      const name = path.slice('functions/'.length);
      const h = fns.get(name);
      const out = h ? await h((body || {}) as Record<string, unknown>) : { ok: false, code: 'demo', error: 'Pas disponible dans la démo.' };
      return reply(200, out);
    }
    if (path.startsWith('auth/')) {
      if (path.includes('settings')) return reply(200, { external: { google: false } });
      // a session kept on this browser (the real app's, same address) is not renewed by the demo, nor thrown away: « try
      // again later » keeps it as it is (an empty answer made supabase-js sign it out)
      if (path.startsWith('auth/token')) return reply(503, { message: 'demo: no session here', code: 'demo' });
      return reply(200, {});
    }
    if (path.startsWith('rest/')) {
      const name = path.slice('rest/'.length);
      const t = table(name);
      const filters = [...url.searchParams.entries()].filter(([k]) => !RESERVED.has(k));
      // the row rules of the database: a person reads (and changes) only the rows they may see (demo-02)
      const pick = () => t.filter((r) => visible(name, r) && filters.every(([k, v]) => matchFilter(r, k, v)));
      const single = (headers.get('accept') || '').includes('vnd.pgrst.object');
      if (method === 'GET' || method === 'HEAD') {
        let list = pick().slice().sort(sorter(url.searchParams.get('order')));
        const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
        if (offset) list = list.slice(offset);
        const limit = Number(url.searchParams.get('limit') || 0);
        if (limit) list = list.slice(0, limit);
        if (single) return list[0] ? reply(200, list[0]) : reply(406, { code: 'PGRST116', message: 'no rows' });
        return reply(200, list, { 'content-range': `0-${Math.max(0, list.length - 1)}/${list.length}` });
      }
      if (method === 'POST') {
        const items = (Array.isArray(body) ? body : [body]) as DemoRow[];
        const ignore = (headers.get('prefer') || '').includes('ignore-duplicates');
        const out: DemoRow[] = [];
        for (const it of items) {
          const cur = it.id ? find(name, it.id) : undefined;
          if (ignore && cur) continue;
          if (!mayWrite(name, { ...(cur || {}), ...it } as DemoRow) || (cur && !visible(name, cur))) return rlsRefusal(name);
        }
        for (const it of items) {
          if (ignore && it.id && find(name, it.id)) continue;
          out.push(put(name, it));
        }
        return reply(201, single ? out[0] ?? null : out);
      }
      if (method === 'PATCH') {
        // the rule's « using » leaves out the rows this person may not change; its « with check » refuses the new values
        const hit = pick().filter((r) => mayWrite(name, r));
        if (hit.some((r) => !mayWrite(name, { ...r, ...(body as object) } as DemoRow))) return rlsRefusal(name);
        const out = hit.map((r) => put(name, { ...(body as object), id: r.id }));
        return reply(200, single ? out[0] ?? null : out);
      }
      if (method === 'DELETE') {
        const gone = pick().filter((r) => mayWrite(name, r));
        db[name] = t.filter((r) => !gone.includes(r));
        return reply(200, gone);
      }
    }
    return reply(404, { message: 'demo: unknown ' + path });
  } catch (e) {
    if (e instanceof DemoRefusal) return reply(400, { code: 'P0001', message: e.message, hint: e.code, details: null });
    /* a mistake inside a pretend operation is a refusal the screen shows, not a 500: the app reads any 5xx as « no
       network » and would send it again for ever, every later change waiting behind it (demo-21) */
    console.error('[demo] erreur dans une opération de la démo', e);
    return reply(400, { code: 'P0001', message: `Erreur de la démo : ${String((e as Error)?.message || e)}`, hint: 'demo_bug', details: null });
  }
}

/** TomTom is never asked from the demo (it would spend the garage's transactions): the demo has no TomTom key
    (config.ts), and should anything still ask, it gets « 503 » here without leaving the page */
export const NEVER_ASKED = /(^|\.)tomtom\.com$/i;
export function neverAsked(url: URL): Response | null {
  return NEVER_ASKED.test(url.hostname) ? reply(503, { error: 'demo: TomTom is never asked from the demo' }) : null;
}

/** routes the app's calls to the pretend server (other addresses, like map tiles, go out as usual; TomTom never) */
export function installFakeServer() {
  const real = window.fetch.bind(window);
  const base = new URL(SUPABASE_URL).origin;
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    const no = neverAsked(url);
    if (no) return no;
    if (url.origin !== base) return real(input as RequestInfo, init);
    if (input instanceof Request) {
      init = { method: input.method, headers: input.headers, body: input.method === 'GET' ? undefined : await input.clone().text(), ...init };
    }
    await new Promise((r) => setTimeout(r, 60));   // a little delay, like a real network
    return handle(url, init);
  };
}
