// « Réserver en ligne » (client.html#reserver): one public link, no account.
//   info   the garage, whether online booking is open, the services offered, the blocks
//   slots  the best blocks for an address and the services chosen (where a truck already goes nearby, soonest)
//   book   books one of them: the customer (found by phone, else created), the car, the job and its link in one
//          transaction (web_book); then the usual confirmation text. A failure after the booking never hides it:
//          the page still gets « ok » and the link (text: 'error'); the same booking sent again gets the same job.
// Brakes (Part 24, rate_hit): « slots » 20 per 10 min per visitor and 150 an hour in all; « book » 12 tries an hour per visitor.
import { serve, json, body, fail, env } from '../_shared/http.ts';
import { adminDb, settings, secret } from '../_shared/db.ts';
import { sha256hex, hmacHex, newToken } from '../_shared/tokens.ts';
import { sumLines } from '../_shared/money.ts';
import { baseOf, clientLink } from '../_shared/links.ts';
import { sendSms } from '../_shared/ghl.ts';
import { money, clock, longDay, fill, first, blockWords, payNowWords, type Lang, servicesList, subtotalWords } from '../_shared/texts.ts';

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const BUSY = 'Trop de demandes en même temps. Réessayez dans quelques minutes ou appelez le garage.';

function garageOf(s: Row) {
  return { name: s.company?.name || 'Mécanique Mobile H.I.S', phone: s.company?.phone || null, email: s.company?.email || null,
    address: s.company?.address || null };
}
function num(x: unknown): number | null { const n = Number(x); return x === null || x === undefined || x === '' || !Number.isFinite(n) ? null : n; }
function services(x: unknown): string[] {
  return Array.isArray(x) ? [...new Set(x.map(String).filter((v) => UUID.test(v)))].slice(0, 10) : [];
}
async function rpc(name: string, args: Row) {
  const { data, error } = await adminDb().rpc(name, args);
  if (error) throw error;
  return data;
}
/** who is asking, as a fingerprint for the day: keyed with a secret, so the address cannot be found back from it */
async function ipOf(req: Request): Promise<string | null> {
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (!ip) return null;
  const day = new Date().toISOString().slice(0, 10);
  return (await hmacHex(env('SUPABASE_SERVICE_ROLE_KEY', 'web-book'), `web:${day}:${ip}`)).slice(0, 24);
}
/** the brake: false when this visitor (or everyone) asked too often */
async function allowed(key: string, windowSec: number, max: number): Promise<boolean> {
  return (await rpc('rate_hit', { p_key: key, p_window_sec: windowSec, p_max: max })) === true;
}
/** a submission that is not a person's (the hidden field was filled): nothing kept, but the office can see it happened */
async function robot(ip: string | null, reason: string) {
  try { await adminDb().from('activity').insert({ entity: 'web', entity_id: null, action: 'web_robot', data: { reason, ip } }); } catch { /* a log only */ }
}
/** the {total} of the text: the fixed part, and a word when some of the work is by the hour (never « 0,00 $ ») */
function totalWords(fixedCents: number, hourly: boolean, lang: Lang): string {
  if (!hourly) return money(fixedCents, lang);
  if (fixedCents <= 0) return lang === 'en' ? 'as per the work on site' : 'selon le travail sur place';
  return `${money(fixedCents, lang)} ${lang === 'en' ? '+ work by the hour' : '+ travaux à l’heure'}`;
}

async function info() {
  const s = await settings();
  const on = s.booking?.web?.on === true;
  const blocks = ((s.booking?.blocks?.length ? s.booking.blocks : [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }]) as Row[])
    .map((b) => ({ key: b.key, start: b.start, end: b.end }));
  const tx = s.taxes?.enabled !== false;
  return { ok: true, garage: garageOf(s), on, services: on ? await rpc('web_services', {}) : [], blocks, taxes: tx,
    horizon_days: Number(s.booking?.horizon_days || 120) };
}

async function slots(req: Request, b: Row) {
  const lat = num(b.lat), lng = num(b.lng);
  const ids = services(b.services);
  if (lat === null || lng === null) fail('far', 'Choisissez votre adresse dans la liste.');
  if (!ids.length) fail('no_service', 'Choisissez au moins un service.');
  const who = (await ipOf(req)) || 'noip';
  if (!(await allowed(`slots:${who}`, 600, 20)) || !(await allowed('slots:all', 3600, 150))) fail('busy', BUSY, 429);
  const from = typeof b.from === 'string' && DAY.test(b.from) ? b.from : null;
  const days = Math.max(1, Math.min(14, Number(b.days) || 14));
  const list = await rpc('web_suggest', { p_lat: lat, p_lng: lng, p_services: ids, p_from: from, p_days: days, p_limit: 6 }) as Row[];
  // the customer sees the day, the block and whether a truck is already nearby; never the trucks or the minutes
  return { ok: true, from, days, slots: (list || []).map((x) => ({ day: x.day, block: x.block, near: Number(x.near) > 0 })) };
}

async function book(req: Request, b: Row) {
  const ip = await ipOf(req);
  // a field no person sees (robots fill every field): pretend it worked, keep nothing, note it
  const trap = typeof b.extra === 'string' ? b.extra : typeof b.website === 'string' ? b.website : '';
  if (trap.trim()) {
    await robot(ip, 'hidden_field');
    return { ok: true, link: null, day: typeof b.day === 'string' && DAY.test(b.day) ? b.day : null, block: typeof b.block === 'string' ? b.block.slice(0, 8) : null, text: 'skipped' };
  }
  // a person may fumble a few times (phone, address…); a script making customers by the dozen may not
  if (!(await allowed(`book:${ip || 'noip'}`, 3600, 12))) fail('busy', BUSY, 429);
  const lang: Lang = b.lang === 'en' ? 'en' : 'fr';
  // the customer's link is made with the booking itself (same transaction): a job never exists without it
  const token = newToken(24);
  const res = await rpc('web_book', { p: {
    first_name: b.first_name, last_name: b.last_name, phone: b.phone, email: b.email, lang,
    address: b.address, unit: b.unit, city: b.city, postal_code: b.postal_code, lat: num(b.lat), lng: num(b.lng),
    vehicle: { year: b.vehicle?.year ?? null, make: b.vehicle?.make ?? null, model: b.vehicle?.model ?? null },
    services: services(b.services), day: b.day, block: b.block, problem: b.problem, ip, token_hash: await sha256hex(token)
  } }) as Row;
  const link = clientLink(baseOf(b.base), token, lang);
  const jobId = String(res.job_id);
  const again = res.again === true;
  const db = adminDb();

  // the usual confirmation text; whatever happens here, the booking is made and the page gets its link
  let text = 'off';
  try {
    if (again) {
      const { data: prev } = await db.from('messages').select('id').eq('job_id', jobId).eq('kind', 'booking').eq('status', 'sent').limit(1);
      if (prev?.length) return { ok: true, link, day: res.day, block: res.block, text: 'already', again };
    }
    const s = await settings();
    const { data: cust } = await db.from('customers').select('*').eq('id', res.customer_id).maybeSingle();
    const cu = (cust || {}) as Row;
    const tpl = String(s.messages?.[lang]?.booking || s.messages?.fr?.booking || '');
    if (tpl) {
      const blk = ((s.booking?.blocks || []) as Row[]).find((x) => x.key === res.block) || { start: 480, end: 720 };
      const { data: items } = await db.from('job_items').select('description, kind, qty, unit_cents, taxable, status, sort').eq('job_id', jobId).is('deleted_at', null).order('sort');
      const cardOn = !!(await secret('stripe_key'));
      // work by the hour has no price yet: the text says so instead of « 0,00 $ »
      const offered = (await rpc('web_services', {}) || []) as Row[];
      const chosen = new Set(services(b.services));
      const hourly = offered.some((x) => chosen.has(String(x.id)) && (x.price_cents === null || x.price_cents === undefined));
      const message = fill(tpl, {
        // the person who booked is greeted by the name they typed (a spouse on a shared number is not « Bonjour Marc »)
        prenom: first(typeof b.first_name === 'string' ? b.first_name : '') || first(cu.first_name) || '',
        garage: s.company?.name || 'Mécanique Mobile H.I.S', telephone: s.company?.phone || '',
        jour: longDay(String(res.day), lang), debut: clock(blk.start, lang), fin: clock(blk.end, lang), bloc: blockWords(String(res.block), lang),
        payer: '', total: totalWords(sumLines((items || []) as Row[], s).total, hourly, lang), lien: link,
        services: servicesList((items || []) as never, lang), soustotal: subtotalWords((items || []) as never, lang)
      });
      const quiet = cu.sms_ok === false || s.messages?.on?.booking === false;
      const r = quiet ? { status: 'quiet' as const } : await sendSms({ first: cu.first_name, last: cu.last_name, phone: cu.phone, email: cu.email }, message);
      text = r.status;
      await db.from('messages').insert({ job_id: jobId, customer_id: cu.id || null, staff_id: null, kind: 'booking', channel: 'sms', to_addr: cu.phone || null,
        body: message, status: r.status === 'sent' ? 'sent' : r.status === 'error' ? 'failed' : 'skipped', provider_ref: (r as { id?: string }).id || null,
        error: (r as { error?: string }).error || r.status, created_by: null });
      if (r.status === 'sent') await db.from('jobs').update({ confirm_sent_at: new Date().toISOString() }).eq('id', jobId);
    }
  } catch (e) {
    console.error('book: after the booking', String((e as Error)?.message || e).slice(0, 200));
    text = 'error';
    try {
      await db.from('messages').insert({ job_id: jobId, customer_id: res.customer_id || null, staff_id: null, kind: 'booking', channel: 'sms', to_addr: null,
        body: 'Texto de confirmation non envoyé : erreur du serveur après la réservation.', status: 'failed', error: String((e as Error)?.message || e).slice(0, 200), created_by: null });
    } catch { /* the booking itself is safe */ }
  }
  return { ok: true, link, day: res.day, block: res.block, text, again };
}

export const handler = serve(async (req) => {
  const b = await body<Row>(req);
  const action = String(b.action || 'info');
  if (action === 'info') return json(await info());
  if (action === 'slots') return json(await slots(req, b));
  if (action === 'book') return json(await book(req, b));
  fail('action', 'Action inconnue.');
});
