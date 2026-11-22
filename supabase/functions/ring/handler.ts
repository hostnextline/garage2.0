// « Appel entrant » from GoHighLevel: a call that comes in on the garage's number shows in the app of the owners who switched it on for their account (`staff.prefs.calls`, my_access « calls »).
//   POST ?k=<key>  (GoHighLevel's automation « inbound call → webhook »; its usual body: phone, full_name, first_name, last_name…)
//                  → the call is noted in « incoming_calls » (the owner's app shows it) and sent as a notification to the devices
//                  (« push_subs ») of the owners who take the calls (staff.prefs.calls). The key is in the address, made here.
//   POST ?k=<key>&t=sms  (GoHighLevel's automation « customer replied → webhook »; the same body with message: { body })
//                  → the text is noted in « incoming_texts » (the owner's app opens the conversation bubble). A picture or a
//                  document comes with no words, or with some: the app shows it from GoHighLevel's conversation.
//   { action: 'link' }  (the owner, signed in) → { url, text_url }: the addresses to paste in GoHighLevel. The key is made once;
//                  nobody changes it from the app (Hassan's rule): a new one is made on the server, on request.
//   { action: 'test', kind? }   (the owner) → a pretend call, to see the banner (kind 'text': a pretend text, to see the bubble)
//   { action: 'push-key' }      (the owner) → { key }: the garage's public key a device needs to ask for the alert while the
//                  app is closed. A text is then also sent as a notification to the devices (« push_subs ») of the owners who
//                  take the texts (staff.prefs.texts): the name (ours when the number is on file) and the words.
// The key of the address is checked before anything else is read. The same call or text delivered twice by GoHighLevel
// (a retry, two automations on one event) is noted and announced once: the second answers { ok: true, again: true }.
import { serve, json, body, fail, env } from '../_shared/http.ts';
import { caller, secret, adminDb, setSecrets } from '../_shared/db.ts';
import { newToken, safeEqual, sha256hex } from '../_shared/tokens.ts';
import { e164, filesOf } from '../_shared/ghl.ts';
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
/** a text that carries a picture or a document (the app shows it from GoHighLevel's conversation) */
export function hasFiles(b: Record<string, any>): boolean {
  const d = (b.customData && typeof b.customData === 'object' ? b.customData : {}) as Record<string, any>;
  return [b.message, d, b].some((x) => filesOf(x).length > 0);
}
async function noteText(phone: string, name: string | null, words: string) {
  const db = adminDb();
  const { error } = await db.from('incoming_texts').insert({ phone, name, body: words });
  if (error) throw error;
  // the conversation itself stays in GoHighLevel: a week here is plenty
  await db.from('incoming_texts').delete().lt('at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
}
/** the garage's signing keys for notifications: made the first time, kept in « secrets ». Two devices asking at the same
    instant get the SAME pair (the first one written stays): a device that kept the other key would never be reached. */
async function vapid(by: string | null): Promise<Vapid> {
  // both halves in ONE read: two reads could fall on each side of another request's write and see « half a pair »
  const read = async () => {
    const { data, error } = await adminDb().from('secrets').select('key, value').in('key', ['vapid_public', 'vapid_private']);
    if (error) throw error;
    const v = Object.fromEntries(((data || []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    return { publicKey: v.vapid_public || null, privateJwk: v.vapid_private || null };
  };
  let have = await read();
  if (have.publicKey && have.privateJwk) return have as Vapid;
  const v = await makeVapid();
  if (have.publicKey || have.privateJwk) {
    // half a pair (an old failure): it is worth nothing, a whole new one replaces it
    await setSecrets({ vapid_public: v.publicKey, vapid_private: v.privateJwk }, by);
    return v;
  }
  const at = new Date().toISOString();
  const { error } = await adminDb().from('secrets').upsert([
    { key: 'vapid_public', value: v.publicKey, updated_at: at, updated_by: by },
    { key: 'vapid_private', value: v.privateJwk, updated_at: at, updated_by: by }
  ], { onConflict: 'key', ignoreDuplicates: true });
  if (error) throw error;
  have = await read();
  if (!have.publicKey || !have.privateJwk) throw new Error('vapid keys not kept');
  return have as Vapid;
}
const nicePhone = (p: string) => { const d = p.replace(/\D/g, '').slice(-10); return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6)}` : p; };
/** the alert while the app is closed, on the devices of the owners who take the texts (or the calls: `words` null). Never an
    error for the caller: the text or the call is already noted, the bubble or the banner shows anyway. */
async function alertText(phone: string, name: string | null, words: string | null, files = false): Promise<number> {
  try {
    const db = adminDb();
    const isCall = words == null;
    const { data: people } = await db.from('staff').select('id').contains('roles', ['owner']).eq('active', true).is('deleted_at', null).eq(isCall ? 'prefs->>calls' : 'prefs->>texts', 'true');
    const ids = ((people || []) as { id: string }[]).map((x) => x.id);
    if (!ids.length) return 0;
    const { data: subs } = await db.from('push_subs').select('id, endpoint, p256dh, auth').in('staff_id', ids);
    // a push address is whatever a browser gave: the server only posts to https (and to its own machine, for the tests)
    const list = ((subs || []) as { id: string; endpoint: string; p256dh: string; auth: string }[])
      .filter((s) => /^https:\/\/[^/\s]+\//i.test(s.endpoint) || /^http:\/\/127\.0\.0\.1(:\d+)?\//.test(s.endpoint));
    if (!list.length) return 0;
    const { data: known } = await db.from('customers').select('first_name, last_name').eq('phone_digits', phone.replace(/\D/g, '').slice(-10)).is('deleted_at', null).limit(1);
    const k = ((known || []) as { first_name: string | null; last_name: string | null }[])[0];
    const who = (k ? [k.first_name, k.last_name].filter(Boolean).join(' ') : '') || name || nicePhone(phone);
    const payload = isCall
      ? JSON.stringify({ title: 'Appel entrant', body: who === nicePhone(phone) ? who : `${who}, ${nicePhone(phone)}`, tag: `appel-${phone}` })
      : JSON.stringify({ title: who, body: words!.slice(0, 300) || (files ? '📎 Photo ou document' : 'Nouveau texto'), tag: `texto-${phone}` });
    const v = await vapid(null);
    const gone: string[] = [];
    let sent = 0;
    await Promise.all(list.map(async (s) => {
      try {
        const status = await sendPush(s, payload, v, DEFAULT_BASES[0]);
        if (status === 404 || status === 410) gone.push(s.id); else if (status >= 200 && status < 300) sent++;
        else console.error('ring push refused', status);   // a key that no longer matches, a service in trouble: seen in the logs
      } catch { /* that device's service did not answer: the next text tries again */ }
    }));
    if (gone.length) await db.from('push_subs').delete().in('id', gone);
    return sent;
  } catch { return 0; }
}
/** the same call or the same text delivered a second time within half a minute (GoHighLevel tries again, or two of its
    automations fire on one event): true = already noted, nothing more to do. One atomic count for two deliveries at the very
    same instant, then a look at what is already noted for a retry that falls in the next counting window. Two different
    pictures with no words are two texts (their addresses differ). */
const SAME_SEC = 30;
async function seenAlready(kind: 'call' | 'text', phone: string, words: string, files: string[]): Promise<boolean> {
  const mark = (await sha256hex([kind, phone, words, ...files].join('\n'))).slice(0, 40);
  if (!(await brake(`ring:same:${mark}`, SAME_SEC, 1))) return true;
  if (files.length) return false;
  const since = new Date(Date.now() - SAME_SEC * 1000).toISOString();
  const db = adminDb();
  const { data } = kind === 'call'
    ? await db.from('incoming_calls').select('id').eq('phone', phone).gte('at', since).limit(1)
    : await db.from('incoming_texts').select('id').eq('phone', phone).eq('body', words).gte('at', since).limit(1);
  return ((data || []) as unknown[]).length > 0;
}
/** every address of the pictures and documents of a text, wherever GoHighLevel put them */
function filesIn(b: Record<string, any>): string[] {
  const d = (b.customData && typeof b.customData === 'object' ? b.customData : {}) as Record<string, any>;
  return [...new Set([b.message, d, b].flatMap((x) => filesOf(x)))].sort();
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
  if (k) {
    // GoHighLevel's address: the key first, before the body is even read
    const want = await secret('call_hook');
    if (!want || !safeEqual(k, want)) fail('bad_key', 'Cette adresse n’est plus la bonne.', 403);
    if (!(await brake(isText ? 'ring:text' : 'ring', 60, isText ? 60 : 30))) fail('busy', isText ? 'Trop de textos à la fois.' : 'Trop d’appels à la fois.', 429);
    const b = await body<Record<string, any>>(req);
    const call = callOf(b);
    if (!call.phone) fail('no_phone', isText ? 'Aucun numéro dans ce texto.' : 'Aucun numéro dans cet appel.');
    if (isText) {
      const words = wordsOf(b), files = filesIn(b);
      if (await seenAlready('text', call.phone!, words, files)) return json({ ok: true, again: true });
      await noteText(call.phone!, call.name, words);
      await alertText(call.phone!, call.name, words, files.length > 0);
    } else {
      if (await seenAlready('call', call.phone!, '', [])) return json({ ok: true, again: true });
      await note(call.phone!, call.name);
      await alertText(call.phone!, call.name, null);
    }
    return json({ ok: true });
  }
  const b = await body<Record<string, any>>(req);
  const c = await caller(req);
  // the owners branch the calls and the texts; who SEES them is each owner's own switch (staff.prefs.calls / prefs.texts)
  if (!c.access.owner) fail('not_allowed', 'Seul le propriétaire branche les appels entrants.', 403);
  if (b.action === 'link') {
    let key = await secret('call_hook');
    if (b.renew === true) fail('not_allowed', 'L’adresse ne se change pas depuis l’app.', 403);
    if (!key) { key = newToken(24); await setSecrets({ call_hook: key }, c.id); }
    const url = `${env('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/ring?k=${key}`;
    return json({ ok: true, url, text_url: `${url}&t=sms` });
  }
  if (b.action === 'test') {
    if (b.kind === 'text') {
      const words = 'Bonjour, avez-vous une place demain matin pour un changement d’huile ?';
      await noteText('+15145550100', 'Client TEST', words);
      return json({ ok: true, alerted: await alertText('+15145550100', 'Client TEST', words) });
    }
    await note('+15145550100', 'Client TEST');
    return json({ ok: true, alerted: await alertText('+15145550100', 'Client TEST', null) });
  }
  if (b.action === 'push-key') return json({ ok: true, key: (await vapid(c.id)).publicKey });
  fail('action', 'Action inconnue.');
});
