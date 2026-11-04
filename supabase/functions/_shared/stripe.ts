// Card payments through the garage's Stripe account: a checkout page for the customer, and Stripe's signed notice
// when a payment is done (checked before anything is written).
import { env, withTimeout, fail } from './http.ts';
import { hmacHex, safeEqual } from './tokens.ts';

const base = () => env('STRIPE_API_BASE', 'https://api.stripe.com');
export const STRIPE_VERSION = '2024-06-20';
function form(entries: [string, string | number][]): string {
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}
export async function stripeCall(key: string, method: 'GET' | 'POST' | 'DELETE', path: string, entries: [string, string | number][] = [], idem?: string) {
  const r = await withTimeout(fetch(`${base()}/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_VERSION, ...(idem ? { 'Idempotency-Key': idem } : {}) },
    body: method === 'GET' || method === 'DELETE' ? undefined : form(entries)
  }), 20000, 'service de paiement');
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${data?.error?.message || 'erreur'}`);
  return data;
}
/** Stripe-Signature: t=…,v1=… (HMAC-SHA256 of "t.body" with the endpoint secret), at most 5 min old */
export async function verifyStripe(raw: string, header: string | null, whsec: string, toleranceS = 300) {
  if (!header) fail('signature', 'Signature manquante.', 400);
  const parts = Object.fromEntries(header.split(',').map((x) => x.trim().split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v])) as Record<string, string>;
  const t = Number(parts.t);
  const v1s = header.split(',').map((x) => x.trim()).filter((x) => x.startsWith('v1=')).map((x) => x.slice(3));
  if (!t || !v1s.length) fail('signature', 'Signature invalide.', 400);
  if (Math.abs(Date.now() / 1000 - t) > toleranceS) fail('signature', 'Avis trop vieux.', 400);
  const want = await hmacHex(whsec, `${t}.${raw}`);
  if (!v1s.some((v) => safeEqual(v, want))) fail('signature', 'Signature invalide.', 400);
  return JSON.parse(raw);
}
