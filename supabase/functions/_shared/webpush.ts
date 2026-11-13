// A notification to a phone or a computer while the app is closed (Web Push): the message is encrypted for that device
// (RFC 8291, aes128gcm) and signed as coming from the garage (VAPID, RFC 8292). Only the platform's own crypto: no
// package, so the same file runs on the server (Deno) and in the app's tests (src/features/conversation/webpush.test.ts).

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;
export function b64u(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s: string): Bytes {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function cat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, len: number): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

/** the garage's signing keys (made once, kept in « secrets »): the public one goes to the devices */
export interface Vapid { publicKey: string; privateJwk: string }
export async function makeVapid(): Promise<Vapid> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { publicKey: b64u(pub), privateJwk: JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey)) };
}
/** the « Authorization » of a push: a short ticket signed by the garage for this push service */
export async function vapidAuth(endpoint: string, v: Vapid, subject: string, now = Date.now()): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', JSON.parse(v.privateJwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${v.publicKey}`;
}
/** the message, readable by that device only (its keys: p256dh and auth, as the browser gave them) */
export async function encryptPush(payload: string, p256dh: string, auth: string): Promise<Bytes> {
  const uaPub = unb64u(p256dh), secret = unb64u(auth);
  const mine = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const myPub = new Uint8Array(await crypto.subtle.exportKey('raw', mine.publicKey));
  const theirs = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, mine.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(secret, shared, cat(enc.encode('WebPush: info\0'), uaPub, myPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // one record: the words, then the « last record » mark
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(payload), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([myPub.length]), myPub, sealed);
}
export interface PushSub { endpoint: string; p256dh: string; auth: string }
/** sends one notification; the answer's status (201 = taken; 404 or 410 = that device no longer wants them) */
export async function sendPush(sub: PushSub, payload: string, v: Vapid, subject: string, timeoutMs = 8000): Promise<number> {
  const body = await encryptPush(payload, sub.p256dh, sub.auth);
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), timeoutMs);
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST', signal: stop.signal, body,
      headers: { Authorization: await vapidAuth(sub.endpoint, v, subject), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' }
    });
    await r.arrayBuffer().catch(() => undefined);
    return r.status;
  } finally { clearTimeout(timer); }
}
