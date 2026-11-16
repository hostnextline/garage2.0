// The conversation with a customer (the texts both ways, through the garage's GoHighLevel number):
//   { action: 'get', customer_id }            → { status: ok|off|no_phone|error, messages: [{ id, at, dir: in|out, body, kind, status, files: [the web addresses of its pictures and documents] }] }
//   { action: 'send', customer_id, message }  → { status: sent|off|no_phone|error } (sent from the garage's number, kept in « messages »)
//   { action: 'contact', customer_id }        → { status: ok|off|no_phone|error }: the customer's name and number go to their GoHighLevel
//     contact (made when the number is new there, completed when it was there without the name); the app asks it when a file is
//     made or its name / number change. Nothing is sent to the customer.
//   { action: 'get' | 'send', phone }         → the same with a number that has no file yet (somebody new who texted the garage):
//     the owner only (the « Texto entrant » bubble).
// Only for a person who sees this customer through the normal rules. The mechanic needs no GoHighLevel app on his phone.
// « send » may carry « op » (a uuid made by the phone, the same when it tries again after a lost answer): the text leaves
// once; the same op again answers { ok: true, status: 'sent', again: true } when it went, { ok: false, status: 'pending' }
// while it is still going, and is tried again when it had failed (_shared/once.ts).
// The pretend number of « Essayer » (+1 514 555-0100, « Client TEST ») is never texted: nobody is behind it.
import { serve, json, body, fail } from '../_shared/http.ts';
import { adminDb, caller } from '../_shared/db.ts';
import { readConversation, sendSms, syncContact, e164 } from '../_shared/ghl.ts';
import { claimMessage, finishMessage, dropMessage } from '../_shared/once.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEST_PHONE = '+15145550100';
type Row = { customer_id: string | null; staff_id: string; kind: 'chat'; channel: 'sms'; to_addr: string | null; body: string; created_by: string };
/** one text of the conversation: sent, written in « messages », once per op */
async function sendOnce(op: unknown, row: Row, send: () => Promise<{ status: string; id?: string; error?: string }>): Promise<Response> {
  const id = op == null || op === '' ? null : String(op);
  if (id != null) {
    const once = await claimMessage(id, row);
    if (!once.claimed) {
      if (once.row.status === 'sent') return json({ ok: true, status: 'sent', again: true });
      if (once.row.status === 'skipped') return json({ ok: false, status: 'off', again: true });
      return json({ ok: false, status: 'pending', again: true, error: 'Ce message est en train de partir.' });
    }
  }
  let r: { status: string; id?: string; error?: string };
  try { r = await send(); } catch (e) { if (id != null) await dropMessage(id, String((e as Error)?.message || e)); throw e; }
  const done = { ...row, status: r.status === 'sent' ? 'sent' : r.status === 'error' ? 'failed' : 'skipped', provider_ref: r.id || null, error: r.error || null };
  if (id != null) await finishMessage(id, done);
  else await adminDb().from('messages').insert(done);
  return json({ ok: r.status === 'sent', status: r.status, error: r.error });
}

export const handler = serve(async (req) => {
  const b = await body(req);
  const action = String(b.action || '');
  if (action !== 'get' && action !== 'send' && action !== 'contact') fail('action', 'Action inconnue.');
  const c = await caller(req);
  if (!b.customer_id && b.phone != null) {
    // a number with no file yet: the owner's « Texto entrant » bubble
    if (!c.access.owner) fail('not_allowed', 'Seul le propriétaire répond à un numéro sans fiche.', 403);
    if (action === 'contact') fail('action', 'Action inconnue.');
    const phone = e164(String(b.phone));
    if (!phone) fail('no_phone', 'Ce numéro n’est pas complet.');
    if (action === 'get') return json({ ok: true, ...(await readConversation({ phone })) });
    const words = String(b.message ?? '').trim();
    if (!words) fail('empty', 'Écris le message.');
    if (words.length > 1000) fail('too_long', 'Ce message est trop long (1000 caractères au plus).');
    if (phone === TEST_PHONE) fail('test_number', 'C’est le numéro de l’essai : personne ne recevrait ce texto.');
    return sendOnce(b.op, { customer_id: null, staff_id: c.id, kind: 'chat', channel: 'sms', to_addr: phone, body: words, created_by: c.id }, () => sendSms({ phone }, words));
  }
  const id = String(b.customer_id || '');
  if (!UUID.test(id)) fail('not_found', 'Ce client n’existe plus.', 404);
  // the person must see the customer through the normal rules (a mechanic: the customers of his jobs)
  const { data: cust, error } = await c.db.from('customers').select('id, first_name, last_name, phone, email, sms_ok').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw error;
  if (!cust) fail('not_found', 'Ce client n’existe plus (ou tu n’y as pas accès).', 404);
  const cu = cust as Record<string, any>;
  const person = { first: cu.first_name, last: cu.last_name, phone: cu.phone, email: cu.email };

  if (action === 'get') return json({ ok: true, ...(await readConversation(person)) });
  if (action === 'contact') { const r = await syncContact(person); return json({ ok: r.status === 'ok', status: r.status, error: r.error }); }

  const message = String(b.message ?? '').trim();
  if (!message) fail('empty', 'Écris le message.');
  if (message.length > 1000) fail('too_long', 'Ce message est trop long (1000 caractères au plus).');
  if (cu.sms_ok === false) fail('sms_off', 'Ce client ne veut pas de textos.');
  return sendOnce(b.op, { customer_id: id, staff_id: c.id, kind: 'chat', channel: 'sms', to_addr: cu.phone || null, body: message, created_by: c.id }, () => sendSms(person, message));
});
