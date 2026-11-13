// « Appel entrant » from GoHighLevel: a call that comes in on the garage's number shows in the app of the one account that answers them (`staff.sees_calls`, my_access « calls »).
//   POST ?k=<key>  (GoHighLevel's automation « inbound call → webhook »; its usual body: phone, full_name, first_name, last_name…)
//                  → the call is noted in « incoming_calls » (the owner's app shows it). The key is in the address, made here.
//   POST ?k=<key>&t=sms  (GoHighLevel's automation « customer replied → webhook »; the same body with message: { body })
//                  → the text is noted in « incoming_texts » (the owner's app opens the conversation bubble).
//   { action: 'link', renew? }  (the owner, signed in) → { url, text_url }: the addresses to paste in GoHighLevel (a new key with renew)
//   { action: 'test', kind? }   (the owner) → a pretend call, to see the banner (kind 'text': a pretend text, to see the bubble)
//   { action: 'push-key' }      (the owner) → { key }: the garage's public key a device needs to ask for the alert while the
//                  app is closed. A text is then also sent as a notification to the devices (« push_subs ») of the owners who
//                  take the texts (staff.prefs.texts): the name (ours when the number is on file) and the words.
import { serve, json, body, fail, env } from '../_shared/http.ts';
import { caller, secret, adminDb, setSecrets } from '../_shared/db.ts';
import { newToken, safeEqual } from '../_shared/tokens.ts';
import { e164 } from '../_shared/ghl.ts';
import { makeVapid, sendPush, type Vapid } from '../_shared/webpush.ts';
import { DEFAULT_BASES } from '../_shared/links.ts';

async function brake(key: string, windowSec: number, max: number): Promise<boolean> {
  const { data, error } = await adminDb().rpc('rate_hit', { p_key: key, p_window_sec: windowSec, p_max: max });
  if (error) throw error;
  return data === true;
}
const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
/** the caller's number and name, wherever GoHighLevel put them */
export function callOf(b: Record<string, any>): { phone: string | null; name: string | null } {
  const c = (b.contact && typeof b.contact === 'object' ? b.contact : {}) as Record<string, any>;
  const d = (b.customData && typeof b.customData === 'object' ? b.customData : {}) as Record<string, any>;
  const phone = [d.phone, b.phone, c.phone, b.from, b.caller, b.contact_phone].map((x) => e164(text(x))).find(Boolean) || null;
  const full = [d.name, b.full_name, c.name, c.full_name, b.name, b.contact_name].map(text).find(Boolean)
    || [text(b.first_name || c.first_name), text(b.last_name || c.last_name)].filter(Boolean).join(' ');
  return { phone, name: full ? full.slice(0, 120) : null };
}
/** the words of a text, wherever GoHighLevel put them (none is fine: the app reads the conversation itself) */
export function wordsOf(b: Record<string, any>): string {
  const d = (b.customData && typeof b.customData === 'object' ? b.customData : {}) as Record<string, any>;
  const m = b.message && typeof b.message === 'object' ? (b.message as Record<string, any>).body : b.message;
  return ([d.message, d.body, m, b.body, b.text, b.sms].map(text).find(Boolean) || '').slice(0, 2000);
}
async function noteText(phone: string, name: string | null, words: string) {
  const db = adminDb();
  const { error } = await db.from('incoming_texts').insert({ phone, name, body: words });
  if (error) throw error;
  // the conversation itself stays in GoHighLevel: a week here is plenty
  await db.from('incoming_texts').delete().lt('at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
}
/** the garage's signing keys for notifications: made the first time, kept in « secrets » */
async function vapid(by: string | null): Promise<Vapid> {
  const publicKey = await secret('vapid_public'), privateJwk = await secret('vapid_private');
  if (publicKey && privateJwk) return { publicKey, privateJwk };
  const v = await makeVapid();
  await setSecrets({ vapid_public: v.publicKey, vapid_private: v.privateJwk }, by);
  return v;
}
const nicePhone = (p: string) => { const d = p.replace(/\D/g, '').slice(-10); return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6)}` : p; };
/** the alert while the app is closed, on the devices of the owners who take the texts. Never an error for the caller:
    the text is already noted, the bubble shows anyway. */
async function alertText(phone: string, name: string | null, words: string): Promise<number> {
  try {
    const db = adminDb();
    const { data: people } = await db.from('staff').select('id').contains('roles', ['owner']).eq('active', true).is('deleted_at', null).eq('prefs->>texts', 'true');
    const ids = ((people || []) as { id: string }[]).map((x) => x.id);
    if (!ids.length) return 0;
    const { data: subs } = await db.from('push_subs').select('id, endpoint, p256dh, auth').in('staff_id', ids);
    const list = (subs || []) as { id: string; endpoint: string; p256dh: string; auth: string }[];
    if (!list.length) return 0;
    const { data: known } = await db.from('customers').select('first_name, last_name').eq('phone_digits', phone.replace(/\D/g, '').slice(-10)).is('deleted_at', null).limit(1);
    const k = ((known || []) as { first_name: string | null; last_name: string | null }[])[0];
    const who = (k ? [k.first_name, k.last_name].filter(Boolean).join(' ') : '') || name || nicePhone(phone);
    const payload = JSON.stringify({ title: who, body: words.slice(0, 300) || 'Nouveau texto', tag: `texto-${phone}` });
    const v = await vapid(null);
    const gone: string[] = [];
    let sent = 0;
    await Promise.all(list.map(async (s) => {
      try {
        const status = await sendPush(s, payload, v, DEFAULT_BASES[0]);
        if (status === 404 || status === 410) gone.push(s.id); else if (status >= 200 && status < 300) sent++;
      } catch { /* that device's service did not answer: the next text tries again */ }
    }));
    if (gone.length) await db.from('push_subs').delete().in('id', gone);
    return sent;
  } catch { return 0; }
}
async function note(phone: string, name: string | null) {
  const db = adminDb();
  const { error } = await db.from('incoming_calls').insert({ phone, name });
  if (error) throw error;
  // yesterday's calls are worth nothing
  await db.from('incoming_calls').delete().lt('at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
}

export const handler = serve(async (req) => {
  const at = new URL(req.url).searchParams;
  const k = at.get('k'), isText = at.get('t') === 'sms';
  const b = await body<Record<string, any>>(req);
  if (!k) {
    const c = await caller(req);
    // the calls: the one account marked for them (staff.sees_calls, my_access « calls »); the texts: the owners
    const calls = c.access.calls === true, owner = c.access.owner === true;
    const noCalls = () => fail('not_allowed', 'Les appels entrants ne sont pas branchés sur ton compte.', 403);
    const noTexts = () => fail('not_allowed', 'Seul le propriétaire branche les textos entrants.', 403);
    if (!calls && !owner) noCalls();
    if (b.action === 'link') {
      let key = await secret('call_hook');
      if (!key || b.renew === true) { key = newToken(24); await setSecrets({ call_hook: key }, c.id); }
      const url = `${env('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/ring?k=${key}`;
      return json({ ok: true, ...(calls ? { url } : {}), ...(owner ? { text_url: `${url}&t=sms` } : {}) });
    }
    if (b.action === 'test') {
      if (b.kind === 'text') {
        if (!owner) noTexts();
        const words = 'Bonjour, avez-vous une place demain matin pour un changement d’huile ?';
        await noteText('+15145550100', 'Client TEST', words);
        return json({ ok: true, alerted: await alertText('+15145550100', 'Client TEST', words) });
      }
      if (!calls) noCalls();
      await note('+15145550100', 'Client TEST');
      return json({ ok: true });
    }
    if (b.action === 'push-key') { if (!owner) noTexts(); return json({ ok: true, key: (await vapid(c.id)).publicKey }); }
    fail('action', 'Action inconnue.');
  }
  const want = await secret('call_hook');
  if (!want || !safeEqual(k!, want)) fail('bad_key', 'Cette adresse n’est plus la bonne.', 403);
  if (!(await brake(isText ? 'ring:text' : 'ring', 60, isText ? 60 : 30))) fail('busy', isText ? 'Trop de textos à la fois.' : 'Trop d’appels à la fois.', 429);
  const call = callOf(b);
  if (!call.phone) fail('no_phone', isText ? 'Aucun numéro dans ce texto.' : 'Aucun numéro dans cet appel.');
  if (isText) { const words = wordsOf(b); await noteText(call.phone!, call.name, words); await alertText(call.phone!, call.name, words); }
  else await note(call.phone!, call.name);
  return json({ ok: true });
});
