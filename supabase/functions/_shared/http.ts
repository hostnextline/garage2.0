// Answers of the garage's server functions: JSON, open to the app's pages (CORS), errors with a plain message.
export const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, stripe-signature',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-max-age': '86400'
};
export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS, ...extra } });
}
/** a refusal of ours: a code, a sentence for the person, the HTTP status; `data` = more fields for the answer
    (the new amount with `changed`…), never able to replace ok, code or error */
export class Fail extends Error {
  constructor(public code: string, message: string, public status = 400, public data?: Record<string, unknown>) { super(message); }
}
export function fail(code: string, message: string, status = 400, data?: Record<string, unknown>): never { throw new Fail(code, message, status, data); }
export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}
/** the commit this code was deployed from: CODE_COMMIT when the deploy sets it; else read in the address of this very
    file (functions deployed as raw GitHub files pinned to a commit: …/garage2.0/<commit>/supabase/functions/_shared/http.ts);
    'local' anywhere else */
export function codeCommit(url: string = import.meta.url): string {
  const set = env('CODE_COMMIT').trim();
  if (/^[0-9a-f]{7,40}$/.test(set)) return set;
  const m = /githubusercontent\.com\/[^/]+\/[^/]+\/([0-9a-f]{7,40})\//.exec(url);
  return m ? m[1] : 'local';
}
/** « which version are you? »: GET …/<function>?version, or POST { "action": "version" } (a body of a few bytes: a real
    request is never read here) */
async function versionAsked(req: Request): Promise<boolean> {
  try {
    if (req.method === 'GET') return new URL(req.url).searchParams.has('version');
    if (req.method !== 'POST') return false;
    const len = Number(req.headers.get('content-length') ?? NaN);
    if (!(len > 0 && len <= 64)) return false;
    const b = await req.clone().json();
    return !!b && typeof b === 'object' && (b as Record<string, unknown>).action === 'version';
  } catch { return false; }
}
/** a short reference written in the log and given to the person: « dis-nous le code k3f9x2 » finds the real error */
export function errorRef(): string { return Math.random().toString(36).slice(2, 8).padEnd(6, '0'); }
/** runs a handler: CORS preflight, the version asked, JSON errors. Only our own refusals leave as text: a Fail, or a
    refusal raised by the database's public.fail() (errcode P0001, its code in the hint). Anything else (a wrong column,
    a bad cast, an outside service…) is a server problem: the real words stay in the log under a short reference, never
    a stack trace or the database's own words to the outside */
export function serve(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (await versionAsked(req)) return json({ ok: true, commit: codeCommit() });
    try { return await fn(req); }
    catch (e) {
      if (e instanceof Fail) return json({ ...(e.data || {}), ok: false, code: e.code, error: e.message }, e.status);
      const err = e as { message?: string; hint?: string; code?: string };
      if (err?.code === 'P0001' && err?.hint) return json({ ok: false, code: err.hint, error: err.message }, 400);
      const ref = errorRef();
      console.error(`[${ref}]`, err?.code || '', String(err?.message || e).slice(0, 300));
      return json({ ok: false, code: 'server', error: 'Le serveur a eu un problème. Réessaie dans un instant.', ref }, 500);
    }
  };
}
/** a refusal of the database (public.fail): its code, else null (any other error) */
export function refusalOf(e: unknown): string | null {
  const err = e as { hint?: string; code?: string } | null;
  return err && err.code === 'P0001' && err.hint ? String(err.hint) : null;
}
export function env(name: string, fallback = ''): string { return Deno.env.get(name) ?? fallback; }
export async function withTimeout<T>(p: Promise<T>, ms: number, what = 'service'): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Fail('timeout', `Le ${what} ne répond pas.`, 504)), ms); })]);
  } finally { clearTimeout(t); }
}
