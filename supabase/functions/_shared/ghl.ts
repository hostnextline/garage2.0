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

/* ---------- reading a customer's conversation (the texts both ways) ---------- */
async function get(path: string, version: string, token: string) {
  const r = await withTimeout(fetch(`${base()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Version: version, Accept: 'application/json' }
  }), 15000, 'service de textos');
  const text = await r.text();
  let data: any = null; try { data = JSON.parse(text); } catch { /* not json */ }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GoHighLevel ${r.status}: ${(data && (data.message || data.error)) || text.slice(0, 160)}`);
  return data;
}
export interface ChatMessage { id: string; at: string | null; dir: 'in' | 'out'; body: string; kind: string; status: string | null }
/** the last messages with this person (oldest first): none when GoHighLevel does not know the number yet */
export async function readConversation(p: Person, limit = 60): Promise<{ status: 'ok' | 'off' | 'no_phone' | 'error'; messages?: ChatMessage[]; error?: string }> {
  const cfg = await ghlReady();
  if (!cfg) return { status: 'off' };
  const phone = e164(p.phone);
  if (!phone) return { status: 'no_phone' };
  try {
    const q = new URLSearchParams({ locationId: cfg.location, number: phone });
    const found = await get(`/contacts/search/duplicate?${q}`, '2021-07-28', cfg.token);
    const cid = found?.contact?.id;
    if (!cid) return { status: 'ok', messages: [] };
    const cv = await get(`/conversations/search?${new URLSearchParams({ locationId: cfg.location, contactId: cid })}`, '2021-04-15', cfg.token);
    const conv = (cv?.conversations || [])[0];
    if (!conv?.id) return { status: 'ok', messages: [] };
    const m = await get(`/conversations/${encodeURIComponent(conv.id)}/messages?limit=${Math.min(100, Math.max(1, limit))}`, '2021-04-15', cfg.token);
    const list: any[] = Array.isArray(m?.messages) ? m.messages : Array.isArray(m?.messages?.messages) ? m.messages.messages : [];
    const messages = list
      .map((x) => ({ id: String(x.id ?? ''), at: x.dateAdded ? String(x.dateAdded) : null, dir: (x.direction === 'inbound' ? 'in' : 'out') as 'in' | 'out',
        body: String(x.body ?? x.message ?? '').slice(0, 4000), kind: String(x.messageType ?? x.type ?? 'SMS'), status: x.status ? String(x.status) : null }))
      .filter((x) => x.body.trim())
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return { status: 'ok', messages };
  } catch (e) { return { status: 'error', error: String((e as Error).message || e).slice(0, 300) }; }
}
