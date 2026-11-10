// Off-site backups with no password stored anywhere: a scheduled job of the garage's PRIVATE GitHub repository asks
// GitHub for a short signed ticket (OIDC) and calls this function with it. The function checks GitHub's signature,
// the audience and the repository, then hands out the data table by table, page by page (no 1000-row ceiling).
// The keys of the outside services (table « secrets ») are never part of a backup.
import { serve, json, body, fail, env } from '../_shared/http.ts';
import { adminDb } from '../_shared/db.ts';

const ISSUER = 'https://token.actions.githubusercontent.com';
const AUDIENCE = 'garage2.0-backup';
/** what a backup holds, in the order a restore would load it */
export const TABLES = [
  'settings', 'counters', 'staff', 'trucks', 'truck_week', 'truck_days', 'services', 'inventory_items', 'service_parts', 'engine_specs',
  'customers', 'customer_notes', 'vehicles', 'quotes', 'jobs', 'job_items', 'invoices', 'payments', 'expenses', 'inventory_moves',
  'shifts', 'trips', 'messages', 'public_links', 'invitations', 'activity', 'attachments',
  'coffre', 'positions', 'position_log', 'op_log', 'stripe_events', 'hermes_questions'
] as const;
// never backed up: secrets (the keys of the texting and card services), rate_limits (a brake, worthless the next day)
export const NOT_BACKED_UP = ['secrets', 'rate_limits'] as const;
const KEY: Record<string, string> = { counters: 'name', op_log: 'op' };
const PAGE: Record<string, number> = { attachments: 100 };

function b64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
let jwksCache: { at: number; keys: JsonWebKey[] } | null = null;
async function jwks(force = false): Promise<(JsonWebKey & { kid?: string })[]> {
  if (!force && jwksCache && Date.now() - jwksCache.at < 10 * 60000) return jwksCache.keys;
  const r = await fetch(env('GITHUB_OIDC_JWKS', `${ISSUER}/.well-known/jwks`));
  if (!r.ok) fail('github', 'GitHub ne répond pas.', 502);
  jwksCache = { at: Date.now(), keys: ((await r.json()) as { keys: JsonWebKey[] }).keys || [] };
  return jwksCache.keys;
}
/** the GitHub ticket: signed by GitHub, for us, recent, from an allowed repository */
export async function verifyGithub(token: string): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) fail('signin', 'Ticket GitHub manquant.', 401);
  let header: { alg?: string; kid?: string }, claims: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch { fail('signin', 'Ticket GitHub illisible.', 401); }
  if (header!.alg !== 'RS256') fail('signin', 'Ticket GitHub refusé.', 401);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const check = async (keys: JsonWebKey[]) => {
    const jwk = keys.find((k) => (k as { kid?: string }).kid === header!.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', { ...jwk, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), signed);
  };
  // GitHub changes its keys from time to time: one fresh look at them before saying no
  if (!(await check(await jwks())) && !(await check(await jwks(true)))) fail('signin', 'Ticket GitHub refusé (signature).', 401);
  const now = Math.floor(Date.now() / 1000);
  const aud = claims!.aud;
  if (claims!.iss !== ISSUER) fail('signin', 'Ticket GitHub refusé (émetteur).', 401);
  if (!(aud === AUDIENCE || (Array.isArray(aud) && aud.includes(AUDIENCE)))) fail('signin', 'Ticket GitHub refusé (destinataire).', 401);
  if (typeof claims!.exp !== 'number' || (claims!.exp as number) < now - 30) fail('signin', 'Ticket GitHub expiré.', 401);
  if (typeof claims!.nbf === 'number' && (claims!.nbf as number) > now + 60) fail('signin', 'Ticket GitHub pas encore valide.', 401);
  const allowed = env('BACKUP_REPOS', 'hostnextline/garage2.0-sauvegardes').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(String(claims!.repository || '').toLowerCase())) fail('not_allowed', 'Ce dépôt GitHub n’est pas celui des sauvegardes.', 403);
  return claims!;
}

export const handler = serve(async (req) => {
  const ticket = req.headers.get('x-github-oidc') || '';
  await verifyGithub(ticket);
  const b = await body(req);
  const db = adminDb();
  const action = String(b.action || 'tables');
  if (action === 'tables') {
    const out: { name: string; count: number }[] = [];
    for (const t of TABLES) {
      const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
      if (error) throw error;
      out.push({ name: t, count: count || 0 });
    }
    return json({ ok: true, at: new Date().toISOString(), tables: out });
  }
  if (action === 'rows') {
    const t = String(b.table || '');
    if (!(TABLES as readonly string[]).includes(t)) fail('table', 'Table inconnue.');
    const limit = Math.min(Number(b.limit) || PAGE[t] || 1000, PAGE[t] || 1000);
    const from = Math.max(0, Number(b.from) || 0);
    const { data, error } = await db.from(t).select('*').order(KEY[t] || 'id', { ascending: true }).range(from, from + limit - 1);
    if (error) throw error;
    const rows = data || [];
    return json({ ok: true, table: t, from, rows, next: rows.length === limit ? from + limit : null });
  }
  fail('action', 'Action inconnue.');
});
