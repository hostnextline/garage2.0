// Makes up the keys of the local test copy of Supabase (never the garage's real keys).
// Usage: node keys.mjs > keys.json
import { createHmac, randomBytes } from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
export function sign(payload, secret) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const secret = randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const long = now + 10 * 365 * 24 * 3600;
  const anon = sign({ iss: 'supabase-local', role: 'anon', iat: now, exp: long }, secret);
  const service = sign({ iss: 'supabase-local', role: 'service_role', iat: now, exp: long }, secret);
  process.stdout.write(JSON.stringify({ secret, anon, service }, null, 2) + '\n');
}
