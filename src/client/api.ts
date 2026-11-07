/* What the customer's page asks the garage's server: the « client » function (the secret link in the text is the key)
   and the public tracking answer (public_track). No account, no data layer: plain fetch with the public key. */
import { SUPABASE_URL, SUPABASE_KEY, appBase } from '../lib/config';

export interface Garage {
  name?: string | null; phone?: string | null; email?: string | null; address?: string | null;
  tps_no?: string | null; tvq_no?: string | null; footer_fr?: string | null; footer_en?: string | null;
}
export interface Sums { subtotal: number; tps: number; tvq: number; total: number }
export type JobStatus = 'booked' | 'en_route' | 'on_site' | 'done' | 'cancelled' | 'no_show';
export interface JobItemV { id: string; description: string; qty: number; unit_cents: number; status: 'planned' | 'done' | 'approved' | string }
export interface ExtraV { id: string; description: string; qty: number; unit_cents: number; total_cents: number; status: 'proposed' | 'approved' | 'declined' | string; note: string | null; answered_via: string | null }
export interface InvoiceLineV { description: string; qty: number; unit_cents: number; taxable?: boolean; total_cents?: number; kind?: string }
export interface InvoiceV {
  number: string; issued_at: string | null; due_on: string | null; status: 'issued' | 'paid' | string; lines: InvoiceLineV[];
  subtotal_cents: number; tps_cents: number; tvq_cents: number; total_cents: number; paid_cents: number; notes: string | null;
}
export interface JobView {
  ok: true; kind: 'job'; garage: Garage; lang: string;
  customer: { first: string };
  job: { number: number; day: string; day_label_fr?: string; day_label_en?: string; block: 'am' | 'pm' | 'eve' | string; start: number | null; end: number | null;
    status: JobStatus; tracking: boolean; vehicle: string | null; waiver_signed: boolean };
  items: JobItemV[]; extras: ExtraV[]; expected: Sums; prepaid_cents: number; invoice: InvoiceV | null;
  /** the estimate the customer signs (with the conditions of the work) */
  estimate?: { signed_at: string | null; signer: string | null; cents: number | null; changed: boolean; can_sign: boolean };
  conditions?: string | null;
  /** the invoice being made while the mechanic is there (to pay during the work) */
  bill?: { lines: InvoiceLineV[]; subtotal_cents: number; tps_cents: number; tvq_cents: number; total_cents: number } | null;
  pay: { available: boolean; amount_cents: number; kind: 'invoice' | 'prepay'; pending: boolean };
}
export interface QuoteView {
  ok: true; kind: 'quote'; garage: Garage; lang: string; number: number; vehicle: string | null;
  items: { description: string; qty: number; unit_cents: number }[]; totals: Sums; valid_until: string | null;
}
export type View = JobView | QuoteView;

export interface TrackAnswer {
  status: string;
  garage?: { name?: string | null; phone?: string | null } | null;
  mechanic?: string | null; customer?: string | null; lang?: string | null;
  dest?: { lat: number; lng: number } | null; route?: [number, number][] | null;
  km?: number | null; minutes?: number | null; eta_at?: string | null; ended_at?: string | null; now?: string | null;
  pos?: { lat: number; lng: number; at: string } | null;
}

/** a refusal or a failure, with a short code the page turns into plain words */
export class ClientError extends Error {
  constructor(public code: string, message: string, public garage?: Garage | null) { super(message); }
}

const TIMEOUT = 15000;
async function post(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl?.signal
    });
    let data: Record<string, unknown> | null = null;
    try { data = (await r.json()) as Record<string, unknown> | null; } catch { data = null; }
    return { status: r.status, data };
  } catch (e) {
    throw new ClientError('network', String((e as Error)?.message || e));
  } finally {
    clearTimeout(timer);
  }
}

const KNOWN = new Set(['bad_link', 'expired', 'gone', 'network', 'confirm', 'nothing', 'no_stripe', 'action', 'timeout', 'signed', 'signer', 'signature']);
/** the « client » server function: view | sign | answer | pay | check */
export async function callClient<T = View>(action: 'view' | 'sign' | 'answer' | 'pay' | 'check', token: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { status, data } = await post(`${SUPABASE_URL}/functions/v1/client`, { action, token, base: appBase(), ...extra });
  if (!data || data.ok === false || status >= 400) {
    const code = String(data?.code || '');
    throw new ClientError(KNOWN.has(code) ? code : 'server', String(data?.error || `HTTP ${status}`), (data?.garage as Garage | undefined) ?? null);
  }
  return data as unknown as T;
}

/** the tracking page's answer (open to the public; the token is the key) */
export async function callTrack(token: string): Promise<TrackAnswer> {
  const { status, data } = await post(`${SUPABASE_URL}/rest/v1/rpc/public_track`, { p_token: token });
  if (status >= 400 || !data || typeof data !== 'object' || typeof (data as { status?: unknown }).status !== 'string') {
    throw new ClientError('server', `HTTP ${status}`);
  }
  return data as unknown as TrackAnswer;
}

/** the « book » server function (« Réserver en ligne »: open to everyone, no token) */
export async function callBook<T>(action: 'info' | 'slots' | 'book', extra: Record<string, unknown> = {}): Promise<T> {
  const { status, data } = await post(`${SUPABASE_URL}/functions/v1/book`, { action, base: appBase(), ...extra });
  if (!data || data.ok === false || status >= 400) {
    throw new ClientError(String(data?.code || 'server'), String(data?.error || `HTTP ${status}`), null);
  }
  return data as unknown as T;
}
