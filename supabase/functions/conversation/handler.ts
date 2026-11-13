// The conversation with a customer (the texts both ways, through the garage's GoHighLevel number):
//   { action: 'get', customer_id }            → { status: ok|off|no_phone|error, messages: [{ id, at, dir: in|out, body, kind, status }] }
//   { action: 'send', customer_id, message }  → { status: sent|off|no_phone|error } (sent from the garage's number, kept in « messages »)
//   { action: 'contact', customer_id }        → { status: ok|off|no_phone|error }: the customer's name and number go to their GoHighLevel
//     contact (made when the number is new there, completed when it was there without the name); the app asks it when a file is
//     made or its name / number change. Nothing is sent to the customer.
//   { action: 'get' | 'send', phone }         → the same with a number that has no file yet (somebody new who texted the garage):
//     the owner only (the « Texto entrant » bubble).
// Only for a person who sees this customer through the normal rules. The mechanic needs no GoHighLevel app on his phone.
import { serve, json, body, fail } from '../_shared/http.ts';
import { adminDb, caller } from '../_shared/db.ts';
import { readConversation, sendSms, syncContact, e164 } from '../_shared/ghl.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const sent = await sendSms({ phone }, words);
    await adminDb().from('messages').insert({ customer_id: null, staff_id: c.id, kind: 'chat', channel: 'sms', to_addr: phone, body: words,
      status: sent.status === 'sent' ? 'sent' : sent.status === 'error' ? 'failed' : 'skipped', provider_ref: sent.id || null, error: sent.error || null, created_by: c.id });
    return json({ ok: sent.status === 'sent', status: sent.status, error: sent.error });
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
  const r = await sendSms(person, message);
  await adminDb().from('messages').insert({ customer_id: id, staff_id: c.id, kind: 'chat', channel: 'sms', to_addr: cu.phone || null, body: message,
    status: r.status === 'sent' ? 'sent' : r.status === 'error' ? 'failed' : 'skipped', provider_ref: r.id || null, error: r.error || null, created_by: c.id });
  return json({ ok: r.status === 'sent', status: r.status, error: r.error });
});
