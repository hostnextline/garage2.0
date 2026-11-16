// GitHub's short signed ticket (OIDC): how the nightly job of the garage's PRIVATE backup repository proves who it is,
// with no password stored anywhere. Used by « backup » (the data, the heartbeat) and « recon » (the nightly
// reconciliation). The ticket is checked before anything else: GitHub's signature, for us (audience), recent, from the
// backup repository — by its name AND by its numbers.
import { fail, env } from './http.ts';
import { secret, setSecrets } from './db.ts';

export const ISSUER = 'https://token.actions.githubusercontent.com';
export const AUDIENCE = 'garage2.0-backup';

function b64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
let jwksCache: { at: number; keys: JsonWebKey[] } | null = null;
/** GitHub's public keys: kept 10 minutes; a ticket signed with an unknown key asks for a fresh look, at most once a minute
    (a flood of forged tickets must not become a flood of requests to GitHub); 10 seconds to answer */
async function jwks(force = false): Promise<(JsonWebKey & { kid?: string })[]> {
  if (jwksCache && Date.now() - jwksCache.at < (force ? 60000 : 10 * 60000)) return jwksCache.keys;
  let r: Response, d: { keys?: JsonWebKey[] } | null = null;
  try {
    r = await fetch(env('GITHUB_OIDC_JWKS', `${ISSUER}/.well-known/jwks`), { signal: AbortSignal.timeout(10000) });
    if (r.ok) d = await r.json();
  } catch { fail('github', 'GitHub ne répond pas.', 502); }
  if (!r!.ok || !d) fail('github', 'GitHub ne répond pas.', 502);
  jwksCache = { at: Date.now(), keys: d!.keys || [] };
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
    try {
      const key = await crypto.subtle.importKey('jwk', { ...jwk, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), signed);
    } catch { return false; }
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
  const repo = String(claims!.repository || '').toLowerCase();
  if (!allowed.includes(repo)) fail('not_allowed', 'Ce dépôt GitHub n’est pas celui des sauvegardes.', 403);
  // A NAME can be taken again by somebody else once a repository (or its organisation) is renamed or deleted; its numbers
  // never change hands. The numbers of the first good ticket are kept (secrets « backup_repo:<name> » = repository id
  // « : » owner id); from then on a ticket with the right name and other numbers is refused. To accept a repository made
  // again on purpose: delete that one row of « secrets » (the next good ticket is kept in its place).
  const ids = `${claims!.repository_id ?? ''}:${claims!.repository_owner_id ?? ''}`;
  const pin = await secret(`backup_repo:${repo}`);
  if (pin) {
    if (pin !== ids) fail('not_allowed', 'Ce dépôt GitHub porte le bon nom, mais ce n’est plus le même dépôt (ses numéros ont changé).', 403);
  } else if (/^\d+:\d+$/.test(ids)) {
    await setSecrets({ [`backup_repo:${repo}`]: ids }, null);
  }
  return claims!;
}
