// Texts and emails to customers and team members, through the garage's GoHighLevel account.
// Time: one send (or one read of a conversation) is several calls to GoHighLevel, all inside the time its caller has
// (`until`, a moment in ms; BUDGET_MS from the start when the caller does not say: the app gives up on a conversation
// after 20 s; « notify », that the app waits 40 s for, gives 35 s).
//   - a call that reads, or files the contact, is stopped for real (the connection closed) past CALL_MS or past the time
//     left: nothing reaches the customer through it;
//   - the text itself (the message call) starts only while SEND_MS are still left, and once started it is NEVER cut:
//     GoHighLevel sends a text it received whatever happens to the connection, so cutting it would only make the team
//     read « not sent » for a text that went (sent again: the customer gets two). Its answer is awaited until `until`;
//     one that has not come by then is said in words (« peut-être parti »).
// A failure is always an answer (status 'error'), never a throw: the caller has often written its own rows already.
import { env, Fail } from './http.ts';
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
/** CALL_MS: the most one read / contact call gets; SEND_MS: the time that must be left to start a text; BUDGET_MS: a send
    or a read whose caller gives no time */
const CALL_MS = 15000, SEND_MS = 10000, BUDGET_MS = 17000;
/** what the caller may say: `until`, the moment its answer must be ready by (Date.now() + BUDGET_MS when not said) */
export interface SendTime { until?: number }
const endOf = (t?: SendTime) => (t && Number.isFinite(t.until) ? Math.min(Number(t.until), Date.now() + 60000) : Date.now() + BUDGET_MS);
const SLOW = 'Le service de textos ne répond pas.';
const NOT_SENT = 'Le service de textos ne répond pas : le texto n’est pas parti. Réessayez dans un instant.';
const MAYBE = 'Le service de textos n’a pas répondu à temps : le texto est peut-être parti. Regardez la conversation avant de le renvoyer.';
const NO_SETTINGS = 'Les réglages des textos n’ont pas pu être lus. Réessayez dans un instant.';
/** one request to GoHighLevel. A read or a contact (`keep` false): stopped for real (the connection closed) past CALL_MS or
    `until`. A text (`keep` true): never stopped once started; past `until` its answer is no longer awaited (no_answer). */
async function request(path: string, init: RequestInit, until: number, keep = false): Promise<{ status: number; ok: boolean; text: string }> {
  const left = until - Date.now();
  const ms = keep ? left : Math.min(CALL_MS, left);
  if (ms < 250) throw new Fail('timeout', SLOW, 504);
  const stop = keep ? null : new AbortController();
  const go = fetch(`${base()}${path}`, stop ? { ...init, signal: stop.signal } : init)
    .then(async (r) => ({ status: r.status, ok: r.ok, text: await r.text() }));
  let t: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, no) => {
    t = setTimeout(() => { stop?.abort(); no(keep ? new Fail('no_answer', MAYBE, 504) : new Fail('timeout', SLOW, 504)); }, ms);
  });
  // (race listens to both: a text whose answer comes after `until` ends by itself, its rejection is never unhandled)
  try { return await Promise.race([go, late]); }
  catch (e) { if (stop?.signal.aborted) throw new Fail('timeout', SLOW, 504); throw e; }
  finally { clearTimeout(t); }
}
async function call(path: string, version: string, token: string, payload: unknown, until: number, keep = false) {
  const r = await request(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Version: version, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  }, until, keep);
  const text = r.text;
  let data: any = null; try { data = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw new Error(`GoHighLevel ${r.status}: ${(data && (data.message || data.error)) || text.slice(0, 160)}`);
  return data;
}
export async function ghlReady(): Promise<{ token: string; location: string } | null> {
  const token = await secret('ghl_token'), location = await secret('ghl_location');
  return token && location ? { token, location } : null;
}
/** the settings of the texts, read inside the send: the database not answering is an answer (status 'error', never
    « off », never a throw after the caller's own writes) */
async function ready(): Promise<{ token: string; location: string } | null> {
  try { return await ghlReady(); }
  catch (e) {
    console.error('ghl: the settings of the texts could not be read', String((e as { message?: string })?.message || e).slice(0, 200));
    throw new Error(NO_SETTINGS);
  }
}
/** a send that did not go: its words. `maybe` = GoHighLevel took the text but its answer came too late (no_answer): the
    text may have gone, so a caller never sends it again by itself (Part 28: counted told, « peut-être parti ») */
const failed = (e: unknown, words?: string) => ({ status: 'error' as const, error: (words || String((e as Error)?.message || e)).slice(0, 300),
  ...(e instanceof Fail && e.code === 'no_answer' ? { maybe: true as const } : {}) });
async function contactId(cfg: { token: string; location: string }, p: Person, tag: string, until: number): Promise<string> {
  const up = await call('/contacts/upsert', '2021-07-28', cfg.token, {
    locationId: cfg.location, firstName: p.first || undefined, lastName: p.last || undefined,
    phone: e164(p.phone) || undefined, email: p.email || undefined, tags: [tag], source: 'Mécanique Mobile H.I.S'
  }, until);
  const id = up?.contact?.id || up?.id;
  if (!id) throw new Error('GoHighLevel: contact sans numéro');
  return id;
}
/** the customer's file in GoHighLevel: made when the number is new there, else completed (the name on a number it already
    had); nothing is sent to the customer */
export async function syncContact(p: Person, tag = 'garage-mobile', time?: SendTime): Promise<{ status: 'ok' | 'off' | 'no_phone' | 'error'; id?: string; error?: string }> {
  const until = endOf(time);
  try {
    const cfg = await ready();
    if (!cfg) return { status: 'off' };
    if (!e164(p.phone)) return { status: 'no_phone' };
    return { status: 'ok', id: await contactId(cfg, p, tag, until) };
  } catch (e) { return failed(e); }
}
/** one text or email: the contact first (it leaves the text its SEND_MS), then the message, started only with SEND_MS left
    and never cut once started */
async function deliver(cfg: { token: string; location: string }, p: Person, tag: string, payload: Record<string, unknown>, until: number): Promise<{ status: SendStatus; id?: string; error?: string; maybe?: true }> {
  let cid: string;
  try { cid = await contactId(cfg, p, tag, until - SEND_MS); }
  catch (e) { return failed(e, e instanceof Fail && e.code === 'timeout' ? NOT_SENT : undefined); }
  if (until - Date.now() < SEND_MS) return failed(null, NOT_SENT);
  const sent = await call('/conversations/messages', '2021-04-15', cfg.token, { ...payload, contactId: cid }, until, true);
  return { status: 'sent', id: sent?.messageId || sent?.id };
}
export async function sendSms(p: Person, message: string, tag = 'garage-mobile', time?: SendTime): Promise<{ status: SendStatus; id?: string; error?: string; maybe?: true }> {
  const until = endOf(time);
  try {
    const cfg = await ready();
    if (!cfg) return { status: 'off' };
    if (!e164(p.phone)) return { status: 'no_phone' };
    return await deliver(cfg, p, tag, { type: 'SMS', message }, until);
  } catch (e) { return failed(e); }
}
export async function sendEmail(p: Person, subject: string, html: string, text: string, tag = 'garage-mobile', time?: SendTime): Promise<{ status: SendStatus; id?: string; error?: string; maybe?: true }> {
  const until = endOf(time);
  try {
    const cfg = await ready();
    if (!cfg) return { status: 'off' };
    if (!p.email) return { status: 'no_email' };
    return await deliver(cfg, p, tag, { type: 'Email', subject, html, message: text }, until);
  } catch (e) { return failed(e); }
}

/* ---------- reading a customer's conversation (the texts both ways) ---------- */
async function get(path: string, version: string, token: string, until: number) {
  const r = await request(path, { headers: { Authorization: `Bearer ${token}`, Version: version, Accept: 'application/json' } }, until);
  const text = r.text;
  let data: any = null; try { data = JSON.parse(text); } catch { /* not json */ }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GoHighLevel ${r.status}: ${(data && (data.message || data.error)) || text.slice(0, 160)}`);
  return data;
}
export interface ChatMessage { id: string; at: string | null; dir: 'in' | 'out'; body: string; kind: string; status: string | null; files: string[] }
/** the last messages with this person (oldest first): none when GoHighLevel does not know the number yet */
export async function readConversation(p: Person, limit = 60, time?: SendTime): Promise<{ status: 'ok' | 'off' | 'no_phone' | 'error'; messages?: ChatMessage[]; error?: string }> {
  const until = endOf(time);
  try {
    const cfg = await ready();
    if (!cfg) return { status: 'off' };
    const phone = e164(p.phone);
    if (!phone) return { status: 'no_phone' };
    const q = new URLSearchParams({ locationId: cfg.location, number: phone });
    const found = await get(`/contacts/search/duplicate?${q}`, '2021-07-28', cfg.token, until);
    const cid = found?.contact?.id;
    if (!cid) return { status: 'ok', messages: [] };
    const cv = await get(`/conversations/search?${new URLSearchParams({ locationId: cfg.location, contactId: cid })}`, '2021-04-15', cfg.token, until);
    const conv = (cv?.conversations || [])[0];
    if (!conv?.id) return { status: 'ok', messages: [] };
    const m = await get(`/conversations/${encodeURIComponent(conv.id)}/messages?limit=${Math.min(100, Math.max(1, limit))}`, '2021-04-15', cfg.token, until);
    const list: any[] = Array.isArray(m?.messages) ? m.messages : Array.isArray(m?.messages?.messages) ? m.messages.messages : [];
    const messages = list
      .map((x) => ({ id: String(x.id ?? ''), at: x.dateAdded ? String(x.dateAdded) : null, dir: (x.direction === 'inbound' ? 'in' : 'out') as 'in' | 'out',
        body: String(x.body ?? x.message ?? '').slice(0, 4000), kind: String(x.messageType ?? x.type ?? 'SMS'), status: x.status ? String(x.status) : null, files: filesOf(x) }))
      // a picture or a document with no words is a message too
      .filter((x) => x.body.trim() || x.files.length)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return { status: 'ok', messages };
  } catch (e) { return failed(e); }
}
