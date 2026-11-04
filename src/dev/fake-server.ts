/* DEV ONLY — a pretend server for the demo (npm run dev, then open /?demo). It answers the app's requests to the
   database (tables, operations) and server functions from data kept in memory, so every screen can be tried and
   photographed without the real server. Nothing here is part of the real app or of the tests of the real server.
   Add the operations your screens need with registerRpc / registerFn (see src/dev/demo-extra/). */
import { SUPABASE_URL } from '../lib/config';

export type DemoRow = Record<string, unknown> & { id: string };
export const db: Record<string, DemoRow[]> = {};
type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>;
const rpcs = new Map<string, Handler>();
const fns = new Map<string, Handler>();
export function registerRpc(name: string, fn: Handler) { rpcs.set(name, fn); }
export function registerFn(name: string, fn: Handler) { fns.set(name, fn); }

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

async function handle(url: URL, init: RequestInit): Promise<Response> {
  const path = url.pathname.replace(/^.*?\/(rest|functions|auth|storage|realtime)\/v1\//, '$1/');
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});
  let body: unknown = undefined;
  try { body = init.body ? JSON.parse(String(init.body)) : undefined; } catch { body = undefined; }
  try {
    if (path.startsWith('rest/rpc/')) {
      const name = path.slice('rest/rpc/'.length);
      const h = rpcs.get(name);
      const out = h ? await h((body || {}) as Record<string, unknown>) : { ok: true };
      return reply(200, out ?? null);
    }
    if (path.startsWith('functions/')) {
      const name = path.slice('functions/'.length);
      const h = fns.get(name);
      const out = h ? await h((body || {}) as Record<string, unknown>) : { ok: false, code: 'demo', error: 'Pas disponible dans la démo.' };
      return reply(200, out);
    }
    if (path.startsWith('auth/')) return reply(200, path.includes('settings') ? { external: { google: false } } : {});
    if (path.startsWith('rest/')) {
      const name = path.slice('rest/'.length);
      const t = table(name);
      const filters = [...url.searchParams.entries()].filter(([k]) => !RESERVED.has(k));
      const pick = () => t.filter((r) => filters.every(([k, v]) => matchFilter(r, k, v)));
      const single = (headers.get('accept') || '').includes('vnd.pgrst.object');
      if (method === 'GET' || method === 'HEAD') {
        let list = pick().slice().sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)) || a.id.localeCompare(b.id));
        const range = headers.get('range');
        if (range) { const [a, z] = range.split('-').map(Number); list = list.slice(a, z + 1); }
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
          if (ignore && it.id && find(name, it.id)) continue;
          out.push(put(name, it));
        }
        return reply(201, single ? out[0] ?? null : out);
      }
      if (method === 'PATCH') {
        const out = pick().map((r) => put(name, { ...(body as object), id: r.id }));
        return reply(200, single ? out[0] ?? null : out);
      }
      if (method === 'DELETE') {
        const gone = pick();
        db[name] = t.filter((r) => !gone.includes(r));
        return reply(200, gone);
      }
    }
    return reply(404, { message: 'demo: unknown ' + path });
  } catch (e) {
    if (e instanceof DemoRefusal) return reply(400, { code: 'P0001', message: e.message, hint: e.code, details: null });
    return reply(500, { message: String((e as Error).message || e) });
  }
}

/** routes the app's calls to the pretend server (other addresses, like map tiles, go out as usual) */
export function installFakeServer() {
  const real = window.fetch.bind(window);
  const base = new URL(SUPABASE_URL).origin;
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== base) return real(input as RequestInfo, init);
    if (input instanceof Request) {
      init = { method: input.method, headers: input.headers, body: input.method === 'GET' ? undefined : await input.clone().text(), ...init };
    }
    await new Promise((r) => setTimeout(r, 60));   // a little delay, like a real network
    return handle(url, init);
  };
}
