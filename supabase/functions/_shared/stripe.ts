// Card payments through the garage's Stripe account: a checkout page for the customer, and Stripe's signed notice
// when a payment is done or given back (checked before anything is written).
import { env, withTimeout, fail } from './http.ts';
import { hmacHex, safeEqual } from './tokens.ts';

const base = () => env('STRIPE_API_BASE', 'https://api.stripe.com');
export const STRIPE_VERSION = '2024-06-20';
function form(entries: [string, string | number][]): string {
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}
/** Stripe answered « no » (or something unreadable): its HTTP status tells a refusal that will never pass (4xx: a wrong
    key, a page already closed…) from a hiccup worth trying again (5xx, 429). The message keeps its old form. */
export class StripeError extends Error {
  constructor(public status: number, message: string, public kind?: string, public reason?: string) { super(message); }
  /** trying again later may work */
  get passing(): boolean { return this.status >= 500 || this.status === 429 || this.status === 409; }
}
export async function stripeCall(key: string, method: 'GET' | 'POST' | 'DELETE', path: string, entries: [string, string | number][] = [], idem?: string) {
  // past the wait the request is really stopped (never a card page made after the garage answered « no answer »)
  const stop = new AbortController();
  const run = async () => {
    const r = await fetch(`${base()}/v1${path}`, {
      method, signal: stop.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_VERSION, ...(idem ? { 'Idempotency-Key': idem } : {}) },
      body: method === 'GET' || method === 'DELETE' ? undefined : form(entries)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new StripeError(r.status, `Stripe ${r.status}: ${data?.error?.message || 'erreur'}`, data?.error?.type, data?.error?.code);
    return data;
  };
  try { return await withTimeout(run(), 20000, 'service de paiement'); }
  catch (e) { stop.abort(); throw e; }
}
/** the notices the garage asks Stripe for: a card page paid (at once, or later for a slow means of payment) and money
    given back from Stripe's own screens (asked, then confirmed or failed) */
export const STRIPE_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'charge.refunded', 'charge.refund.updated'];
/** what to send Stripe to make the garage's notice address (POST /webhook_endpoints): the events above, written in the
    version this code reads (STRIPE_VERSION) whatever the account's own default is */
export function webhookEntries(url: string, description = 'Mécanique Mobile H.I.S (app V2)'): [string, string][] {
  return [['url', url], ...STRIPE_EVENTS.map((e, i) => [`enabled_events[${i}]`, e] as [string, string]), ['api_version', STRIPE_VERSION], ['description', description]];
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
