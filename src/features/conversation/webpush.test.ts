// @vitest-environment node
/* The notification sent while the app is closed: what the server encrypts, a device can read (the device's side of
   RFC 8291 is written here), and the garage's signature checks out (RFC 8292). */
import { describe, it, expect } from 'vitest';
import { makeVapid, vapidAuth, encryptPush, b64u, unb64u } from '../../../supabase/functions/_shared/webpush';

const enc = new TextEncoder();
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let at = 0; for (const x of p) { o.set(x, at); at += x.length; } return o; };
async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, len: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

describe('the notification while the app is closed', () => {
  it('a device reads what the server encrypted for it, and nobody else', async () => {
    // the device: its key pair and its secret, as a browser gives them with a subscription
    const device = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const devicePub = new Uint8Array(await crypto.subtle.exportKey('raw', device.publicKey));
    const secret = crypto.getRandomValues(new Uint8Array(16));
    const words = JSON.stringify({ title: 'Nadia Roy', body: 'Avez-vous une place demain ? Élève 🚗' });
    const body = await encryptPush(words, b64u(devicePub), b64u(secret));

    // the device's side: header (salt, record size, the server's public key), then the sealed record
    const salt = body.slice(0, 16), size = new DataView(body.buffer).getUint32(16), idLen = body[20];
    expect(size).toBe(4096);
    expect(idLen).toBe(65);
    const serverPub = body.slice(21, 21 + idLen), sealed = body.slice(21 + idLen);
    const theirs = await crypto.subtle.importKey('raw', serverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, device.privateKey, 256));
    const ikm = await hkdf(secret, shared, cat(enc.encode('WebPush: info\0'), devicePub, serverPub), 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed));
    expect(plain[plain.length - 1]).toBe(2);
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe(words);

    // another secret: unreadable
    const wrong = await hkdf(crypto.getRandomValues(new Uint8Array(16)), shared, cat(enc.encode('WebPush: info\0'), devicePub, serverPub), 32);
    const badKey = await crypto.subtle.importKey('raw', await hkdf(salt, wrong, enc.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt']);
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, badKey, sealed)).rejects.toBeTruthy();
  });

  it('the garage’s signature: for that push service only, for half a day, checked with the public key', async () => {
    const v = await makeVapid();
    expect(unb64u(v.publicKey).length).toBe(65);
    const now = Date.parse('2026-11-12T15:00:00Z');
    const h = await vapidAuth('https://web.push.apple.com/abc/def', v, 'https://mecanique-mobile-his.vercel.app/', now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h);
    expect(m).toBeTruthy();
    const [, head, claims, sig, k] = m!;
    expect(k).toBe(v.publicKey);
    expect(JSON.parse(new TextDecoder().decode(unb64u(head)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(new TextDecoder().decode(unb64u(claims)))).toEqual({ aud: 'https://web.push.apple.com', exp: now / 1000 + 12 * 3600, sub: 'https://mecanique-mobile-his.vercel.app/' });
    const pub = await crypto.subtle.importKey('raw', unb64u(v.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(sig), enc.encode(`${head}.${claims}`))).toBe(true);
  });
});
