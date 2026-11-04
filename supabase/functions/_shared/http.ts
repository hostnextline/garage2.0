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
export class Fail extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function fail(code: string, message: string, status = 400): never { throw new Fail(code, message, status); }
export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}
/** runs a handler: CORS preflight, JSON errors, never a stack trace to the outside */
export function serve(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try { return await fn(req); }
    catch (e) {
      if (e instanceof Fail) return json({ ok: false, code: e.code, error: e.message }, e.status);
      const err = e as { message?: string; hint?: string; code?: string };
      if (err?.hint) return json({ ok: false, code: err.hint, error: err.message }, 400);
      console.error(e);
      return json({ ok: false, code: 'server', error: 'Le serveur a eu un problème. Réessaie dans un instant.' }, 500);
    }
  };
}
export function env(name: string, fallback = ''): string { return Deno.env.get(name) ?? fallback; }
export async function withTimeout<T>(p: Promise<T>, ms: number, what = 'service'): Promise<T> {
  let t: number | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Fail('timeout', `Le ${what} ne répond pas.`, 504)), ms); })]);
  } finally { clearTimeout(t); }
}
