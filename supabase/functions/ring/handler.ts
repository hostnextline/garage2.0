// « Appel entrant » from GoHighLevel: a call that comes in on the garage's number shows in the owner's app.
//   POST ?k=<key>  (GoHighLevel's automation « inbound call → webhook »; its usual body: phone, full_name, first_name, last_name…)
//                  → the call is noted in « incoming_calls » (the owner's app shows it). The key is in the address, made here.
//   POST ?k=<key>&t=sms  (GoHighLevel's automation « customer replied → webhook »; the same body with message: { body })
//                  → the text is noted in « incoming_texts » (the owner's app opens the conversation bubble).
//   { action: 'link', renew? }  (the owner, signed in) → { url, text_url }: the addresses to paste in GoHighLevel (a new key with renew)
//   { action: 'test', kind? }   (the owner) → a pretend call, to see the banner (kind 'text': a pretend text, to see the bubble)
import { serve, json, body, fail, env } from '../_shared/http.ts';
import { caller, secret, adminDb, setSecrets } from '../_shared/db.ts';
import { newToken, safeEqual } from '../_shared/tokens.ts';
import { e164 } from '../_shared/ghl.ts';

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
    if (!c.access.owner) fail('not_allowed', 'Seul le propriétaire branche les appels entrants.', 403);
    if (b.action === 'link') {
      let key = await secret('call_hook');
      if (!key || b.renew === true) { key = newToken(24); await setSecrets({ call_hook: key }, c.id); }
      const url = `${env('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/ring?k=${key}`;
      return json({ ok: true, url, text_url: `${url}&t=sms` });
    }
    if (b.action === 'test') {
      if (b.kind === 'text') await noteText('+15145550100', 'Client TEST', 'Bonjour, avez-vous une place demain matin pour un changement d’huile ?');
      else await note('+15145550100', 'Client TEST');
      return json({ ok: true });
    }
    fail('action', 'Action inconnue.');
  }
  const want = await secret('call_hook');
  if (!want || !safeEqual(k!, want)) fail('bad_key', 'Cette adresse n’est plus la bonne.', 403);
  if (!(await brake(isText ? 'ring:text' : 'ring', 60, isText ? 60 : 30))) fail('busy', isText ? 'Trop de textos à la fois.' : 'Trop d’appels à la fois.', 429);
  const call = callOf(b);
  if (!call.phone) fail('no_phone', isText ? 'Aucun numéro dans ce texto.' : 'Aucun numéro dans cet appel.');
  if (isText) await noteText(call.phone!, call.name, wordsOf(b));
  else await note(call.phone!, call.name);
  return json({ ok: true });
});
