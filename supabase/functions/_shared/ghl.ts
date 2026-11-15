// Texts and emails to customers and team members, through the garage's GoHighLevel account.
import { env, withTimeout } from './http.ts';
import { secret } from './db.ts';
import { filesOf } from './files.ts';
export { filesOf };

const base = () => env('GHL_API_BASE', 'https://services.leadconnectorhq.com');
export type SendStatus = 'sent' | 'off' | 'no_phone' | 'no_email' | 'error';
export interface Person { first?: string | null; last?: string | null; phone?: string | null; email?: string | null }

export function e164(phone?: string | null): string | null {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? `+1${d}` : null;
}
const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
/** the caller's number and name in what a GoHighLevel automation posts, wherever GoHighLevel put them */
export function callOf(b: Record<string, any>): { phone: string | null; name: string | null } {
  const c = (b.contact && typeof b.contact === 'object' ? b.contact : {}) as Record<string, any>;
  const d = (b.customData && typeof b.customData === 'object' ? b.customData : {}) as Record<string, any>;
  const phone = [d.phone, b.phone, c.phone, b.from, b.caller, b.contact_phone].map((x) => e164(text(x))).find(Boolean) || null;
  const full = [d.name, b.full_name, c.name, c.full_name, b.name, b.contact_name].map(text).find(Boolean)
    || [text(b.first_name || c.first_name), text(b.last_name || c.last_name)].filter(Boolean).join(' ');
  return { phone, name: full ? full.slice(0, 120) : null };
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
/** the customer's file in GoHighLevel: made when the number is new there, else completed (the name on a number it already
    had); nothing is sent to the customer */
export async function syncContact(p: Person, tag = 'garage-mobile'): Promise<{ status: 'ok' | 'off' | 'no_phone' | 'error'; id?: string; error?: string }> {
  const cfg = await ghlReady();
  if (!cfg) return { status: 'off' };
  if (!e164(p.phone)) return { status: 'no_phone' };
  try { return { status: 'ok', id: await contactId(cfg, p, tag) }; }
  catch (e) { return { status: 'error', error: String((e as Error).message || e).slice(0, 300) }; }
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
export async function ghlGet(path: string, version: string, token: string) {
  const r = await withTimeout(fetch(`${base()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Version: version, Accept: 'application/json' }
  }), 15000, 'service de textos');
  const text = await r.text();
  let data: any = null; try { data = JSON.parse(text); } catch { /* not json */ }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GoHighLevel ${r.status}: ${(data && (data.message || data.error)) || text.slice(0, 160)}`);
  return data;
}
export interface Ghl { token: string; location: string }
/** a person's conversation in GoHighLevel, by their contact id or their number: null when GoHighLevel does not know them yet */
export async function conversationOf(cfg: Ghl, who: { contactId?: string | null; phone?: string | null }): Promise<{ contactId: string; conversationId: string; phone: string | null } | null> {
  let cid = who.contactId || null;
  if (!cid) {
    const phone = e164(who.phone);
    if (!phone) return null;
    const found = await ghlGet(`/contacts/search/duplicate?${new URLSearchParams({ locationId: cfg.location, number: phone })}`, '2021-07-28', cfg.token);
    cid = found?.contact?.id || null;
  }
  if (!cid) return null;
  const cv = await ghlGet(`/conversations/search?${new URLSearchParams({ locationId: cfg.location, contactId: cid })}`, '2021-04-15', cfg.token);
  const conv = (cv?.conversations || [])[0];
  if (!conv?.id) return null;
  return { contactId: String(cid), conversationId: String(conv.id), phone: e164(who.phone) || e164(conv.phone) };
}
/** the last messages of a conversation, as GoHighLevel gives them (texts, calls, e-mails…) */
export async function rawMessages(cfg: Ghl, conversationId: string, limit = 60): Promise<any[]> {
  const m = await ghlGet(`/conversations/${encodeURIComponent(conversationId)}/messages?limit=${Math.min(100, Math.max(1, limit))}`, '2021-04-15', cfg.token);
  return Array.isArray(m?.messages) ? m.messages : Array.isArray(m?.messages?.messages) ? m.messages.messages : [];
}
/** the recording of a call (GoHighLevel keeps it): its bytes, 'none' when there is none (yet), 'big' above `max` bytes */
export async function recordingOf(cfg: Ghl, messageId: string, max: number): Promise<{ bytes: Uint8Array; type: string } | 'none' | 'big'> {
  const head = { Authorization: `Bearer ${cfg.token}`, Version: '2021-04-15' };
  let r = await fetch(`${base()}/conversations/messages/${encodeURIComponent(messageId)}/locations/${encodeURIComponent(cfg.location)}/recording`, { headers: head, signal: AbortSignal.timeout(30000) });
  let type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (r.ok && type === 'application/json') {
    // not the sound itself but where it is
    let d: any = null; try { d = await r.json(); } catch { /* not json */ }
    const url = String(d?.url || d?.recordingUrl || d?.recording_url || '');
    if (!/^https:\/\//i.test(url)) return 'none';
    r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  }
  if (r.status === 404 || r.status === 204) { await r.body?.cancel(); return 'none'; }
  if (!r.ok) {
    const words = (await r.text()).slice(0, 300);
    if ((r.status === 400 || r.status === 422) && /record/i.test(words) && /not |no /i.test(words)) return 'none';
    let m = ''; try { const d = JSON.parse(words); m = String(d.message || d.error || ''); } catch { /* not json */ }
    throw new Error(`GoHighLevel ${r.status}${m ? ': ' + m.slice(0, 120) : ''}`);
  }
  if (Number(r.headers.get('content-length') || 0) > max) { await r.body?.cancel(); return 'big'; }
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!bytes.length) return 'none';
  if (bytes.length > max) return 'big';
  return { bytes, type: type || 'audio/x-wav' };
}
export interface ChatMessage { id: string; at: string | null; dir: 'in' | 'out'; body: string; kind: string; status: string | null; files: string[] }
/** the last messages with this person (oldest first): none when GoHighLevel does not know the number yet */
export async function readConversation(p: Person, limit = 60): Promise<{ status: 'ok' | 'off' | 'no_phone' | 'error'; messages?: ChatMessage[]; error?: string }> {
  const cfg = await ghlReady();
  if (!cfg) return { status: 'off' };
  const phone = e164(p.phone);
  if (!phone) return { status: 'no_phone' };
  try {
    const conv = await conversationOf(cfg, { phone });
    if (!conv) return { status: 'ok', messages: [] };
    const list = await rawMessages(cfg, conv.conversationId, limit);
    const messages = list
      .map((x) => ({ id: String(x.id ?? ''), at: x.dateAdded ? String(x.dateAdded) : null, dir: (x.direction === 'inbound' ? 'in' : 'out') as 'in' | 'out',
        body: String(x.body ?? x.message ?? '').slice(0, 4000), kind: String(x.messageType ?? x.type ?? 'SMS'), status: x.status ? String(x.status) : null, files: filesOf(x) }))
      // a picture or a document with no words is a message too
      .filter((x) => x.body.trim() || x.files.length)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return { status: 'ok', messages };
  } catch (e) { return { status: 'error', error: String((e as Error).message || e).slice(0, 300) }; }
}
