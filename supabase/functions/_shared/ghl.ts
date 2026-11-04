// Texts and emails to customers and team members, through the garage's GoHighLevel account.
import { env, withTimeout } from './http.ts';
import { secret } from './db.ts';

const base = () => env('GHL_API_BASE', 'https://services.leadconnectorhq.com');
export type SendStatus = 'sent' | 'off' | 'no_phone' | 'no_email' | 'error';
export interface Person { first?: string | null; last?: string | null; phone?: string | null; email?: string | null }

export function e164(phone?: string | null): string | null {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? `+1${d}` : null;
}
async function call(path: string, version: string, token: string, payload: unknown) {
  const r = await withTimeout(fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Version: version, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  }), 15000, 'service de textos');
  const text = await r.text();
  let data: any = null; try { data = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw new Error(`GoHighLevel ${r.status}: ${(data && (data.message || data.error)) || text.slice(0, 160)}`);
  return data;
}
export async function ghlReady(): Promise<{ token: string; location: string } | null> {
  const token = await secret('ghl_token'), location = await secret('ghl_location');
  return token && location ? { token, location } : null;
}
async function contactId(cfg: { token: string; location: string }, p: Person, tag: string): Promise<string> {
  const up = await call('/contacts/upsert', '2021-07-28', cfg.token, {
    locationId: cfg.location, firstName: p.first || undefined, lastName: p.last || undefined,
    phone: e164(p.phone) || undefined, email: p.email || undefined, tags: [tag], source: 'Mécanique Mobile H.I.S'
  });
  const id = up?.contact?.id || up?.id;
  if (!id) throw new Error('GoHighLevel: contact sans numéro');
  return id;
}
export async function sendSms(p: Person, message: string, tag = 'garage-mobile'): Promise<{ status: SendStatus; id?: string; error?: string }> {
  const cfg = await ghlReady();
  if (!cfg) return { status: 'off' };
  if (!e164(p.phone)) return { status: 'no_phone' };
  try {
    const cid = await contactId(cfg, p, tag);
    const sent = await call('/conversations/messages', '2021-04-15', cfg.token, { type: 'SMS', contactId: cid, message });
    return { status: 'sent', id: sent?.messageId || sent?.id };
  } catch (e) { return { status: 'error', error: String((e as Error).message || e).slice(0, 300) }; }
}
export async function sendEmail(p: Person, subject: string, html: string, text: string, tag = 'garage-mobile'): Promise<{ status: SendStatus; id?: string; error?: string }> {
  const cfg = await ghlReady();
  if (!cfg) return { status: 'off' };
  if (!p.email) return { status: 'no_email' };
  try {
    const cid = await contactId(cfg, p, tag);
    const sent = await call('/conversations/messages', '2021-04-15', cfg.token, { type: 'Email', contactId: cid, subject, html, message: text });
    return { status: 'sent', id: sent?.messageId || sent?.id };
  } catch (e) { return { status: 'error', error: String((e as Error).message || e).slice(0, 300) }; }
}
