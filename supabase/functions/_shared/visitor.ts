// Who is asking a public function (the customer's page, online booking): never the address itself, only a fingerprint
// made with a secret of the server (HMAC), so the address cannot be found back by trying every address.
import { env } from './http.ts';
import { hmacHex } from './tokens.ts';

/** the visitor's address as the platform gives it (the header the platform writes itself first) */
export function visitorIp(req: Request): string | null {
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return ip ? ip.slice(0, 64) : null;
}
/** the fingerprint of the visitor for one use (`scope`). `daily`: it changes every day (the brakes: nothing to follow
    a visitor with); without it the same visitor keeps the same one (the proof of an electronic signature) */
export async function visitorMark(req: Request, scope: string, daily = false): Promise<string | null> {
  const ip = visitorIp(req);
  if (!ip) return null;
  const day = daily ? `${new Date().toISOString().slice(0, 10)}:` : '';
  return (await hmacHex(env('SUPABASE_SERVICE_ROLE_KEY') || 'garage', `${scope}:${day}${ip}`)).slice(0, 24);
}
