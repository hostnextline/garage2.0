/* TESTS ONLY — a pretend PostgREST server in memory, answering the real supabase-js client through `fetch`, with the
   knobs the engine's tests need: no signal, a status to answer, an answer lost after the server committed, a row cap,
   what each account may see, a call log. Stamps are microseconds, written the way Postgres writes them. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../lib/config';
import { guardedFetch } from './client';

export type FakeRow = Record<string, unknown> & { id: string };
type Rpc = (args: Record<string, unknown>, srv: FakeServer) => unknown;
export interface Call { method: string; table: string; url: URL; body: unknown; auth: string | null }

let tick = Date.UTC(2026, 10, 15, 10, 0, 0) * 1000;
/** a Postgres-like stamp, later than every one before (microseconds, trailing zeros trimmed like Postgres) */
export function stamp(): string {
  tick += 1 + Math.floor(Math.random() * 3);
  const ms = Math.floor(tick / 1000), us = tick % 1000;
  const base = new Date(ms).toISOString().replace('Z', '');
  return `${base}${String(us).padStart(3, '0')}`.replace(/\.?0+$/, '') + '+00:00';
}
export const sameStampAll = (): string => stamp();

/** a session token of `uid` (only its account is read by the app) */
export function jwt(uid: string): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: 4102444800 })}.sig`;
}

export class FakeServer {
  tables: Record<string, FakeRow[]> = {};
  rpcs = new Map<string, Rpc>();
  calls: Call[] = [];
  offline = false;
  /** answers the next matching requests with this status and body (then forgets it) */
  failures: { match: (c: Call) => boolean; status: number; body: unknown; times: number }[] = [];
  /** commits the next matching request, then the answer is lost (the phone sees no answer) */
  lost: ((c: Call) => boolean)[] = [];
  /** the most rows one answer gives (PostgREST max-rows) */
  cap = 1000;
  /** what each account sees of a table (RLS); default: everything */
  visible: (table: string, row: FakeRow, uid: string | null) => boolean = () => true;
  /** a delay before each answer (ms) */
  latency = 0;
  /** held answers: requests wait until release() */
  private held: (() => void)[] | null = null;

  table(name: string): FakeRow[] { return (this.tables[name] ||= []); }
  put(name: string, row: Partial<FakeRow> & { id: string }, at = stamp()): FakeRow {
    const t = this.table(name);
    const cur = t.find((r) => r.id === row.id);
    if (cur) { Object.assign(cur, row, { updated_at: at }); return cur; }
    const n = { created_at: at, deleted_at: null, ...row, updated_at: at } as FakeRow;
    t.push(n);
    return n;
  }
  rpc(name: string, fn: Rpc) { this.rpcs.set(name, fn); }
  failNext(match: (c: Call) => boolean, status: number, body: unknown, times = 1) { this.failures.push({ match, status, body, times }); }
  loseNext(match: (c: Call) => boolean) { this.lost.push(match); }
  hold() { this.held = []; }
  release() { const h = this.held || []; this.held = null; for (const f of h) f(); }
  count(match: (c: Call) => boolean) { return this.calls.filter(match).length; }

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init.headers || {});
    const method = (init.method || 'GET').toUpperCase();
    let body: unknown;
    try { body = init.body ? JSON.parse(String(init.body)) : undefined; } catch { body = undefined; }
    const path = url.pathname.replace(/^.*?\/rest\/v1\//, '');
    const call: Call = { method, table: path, url, body, auth: headers.get('authorization') };
    if (this.latency) await new Promise((r) => setTimeout(r, this.latency));
    if (this.held) await new Promise<void>((r) => this.held!.push(r));
    if (init.signal?.aborted) throw Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
    if (this.offline) throw new TypeError('Failed to fetch');
    this.calls.push(call);
    const f = this.failures.find((x) => x.match(call));
    if (f) { if (--f.times <= 0) this.failures.splice(this.failures.indexOf(f), 1); return json(f.status, f.body); }
    const answer = this.handle(call, headers);
    const lose = this.lost.findIndex((m) => m(call));
    if (lose >= 0) { this.lost.splice(lose, 1); throw new TypeError('Failed to fetch'); }
    return answer;
  };

  private uidOf(auth: string | null): string | null {
    const part = auth?.replace(/^Bearer\s+/i, '').split('.')[1];
    if (!part) return null;
    try { return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null; } catch { return null; }
  }

  private handle(c: Call, headers: Headers): Response {
    const uid = this.uidOf(c.auth);
    if (c.table.startsWith('rpc/')) {
      const fn = this.rpcs.get(c.table.slice(4));
      if (!fn) return json(404, { code: 'PGRST202', message: `Could not find the function public.${c.table.slice(4)}` });
      try { return json(200, fn((c.body || {}) as Record<string, unknown>, this) ?? null); }
      catch (e) { const r = e as { code?: string; message?: string }; return json(400, { code: 'P0001', hint: r.code, message: r.message, details: null }); }
    }
    const t = this.table(c.table);
    const filters = [...c.url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict', 'columns'].includes(k));
    const pick = () => t.filter((r) => this.visible(c.table, r, uid) && filters.every(([k, v]) => match(r, k, v)));
    const cols = (c.url.searchParams.get('select') || '*').split(',');
    const shape = (r: FakeRow) => (cols[0] === '*' ? { ...r } : Object.fromEntries(cols.map((k) => [k, r[k]])));
    if (c.method === 'GET') {
      let list = pick();
      const order = (c.url.searchParams.get('order') || '').split(',').filter(Boolean).map((o) => o.split('.')[0]);
      if (order.length) list = list.slice().sort((a, b) => { for (const k of order) { const x = cmp(a[k], b[k]); if (x) return x; } return 0; });
      const limit = Math.min(Number(c.url.searchParams.get('limit') || 1e9), this.cap);
      return json(200, list.slice(0, limit).map(shape));
    }
    if (c.method === 'POST') {
      const items = (Array.isArray(c.body) ? c.body : [c.body]) as FakeRow[];
      const ignore = (headers.get('prefer') || '').includes('ignore-duplicates');
      const out: FakeRow[] = [];
      for (const it of items) {
        if (t.find((r) => r.id === it.id)) { if (ignore) continue; return json(409, { code: '23505', message: 'duplicate key value violates unique constraint' }); }
        out.push(this.put(c.table, it));
      }
      return json(201, out.map(shape));
    }
    if (c.method === 'PATCH') {
      const out = pick().map((r) => this.put(c.table, { ...(c.body as object), id: r.id }));
      return json(200, out.map(shape));
    }
    return json(404, { message: 'unknown' });
  }
}

const cmp = (a: unknown, b: unknown): number => {
  const x = String(a ?? ''), y = String(b ?? '');
  // stamps: compare as instants
  if (/^\d{4}-\d{2}-\d{2}T/.test(x) && /^\d{4}-\d{2}-\d{2}T/.test(y)) return micro(x) - micro(y);
  return x < y ? -1 : x > y ? 1 : 0;
};
const micro = (s: string) => {
  const m = /^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(s);
  if (!m) return 0;
  return Date.parse(m[1] + (m[3] === 'Z' ? 'Z' : m[3])) * 1000 + Number((m[2] || '').padEnd(6, '0').slice(0, 6));
};
function match(r: FakeRow, key: string, expr: string): boolean {
  const v = r[key];
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot), arg = expr.slice(dot + 1);
  switch (op) {
    case 'eq': return cmp(v, arg) === 0 && v != null;
    case 'gt': return v != null && cmp(v, arg) > 0;
    case 'gte': return v != null && cmp(v, arg) >= 0;
    case 'is': return arg === 'null' ? v == null : String(v) === arg;
    case 'in': return arg.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v));
    default: return true;
  }
}
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** a client for `uid` going through the app's guarded door to `srv` */
export function clientFor(srv: FakeServer, uid: string | null): SupabaseClient {
  (globalThis as { fetch: typeof fetch }).fetch = srv.fetch as typeof fetch;
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
    global: { fetch: guardedFetch, headers: uid ? { Authorization: `Bearer ${jwt(uid)}` } : {} }
  });
}
