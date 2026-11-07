// « Réserver en ligne » (client.html#reserver): one public link, no account.
//   info   the garage, whether online booking is open, the services offered, the blocks
//   slots  the best blocks for an address and the services chosen (where a truck already goes nearby, soonest)
//   book   books one of them: the customer (found by phone, else created), the car, the job; then the usual
//          confirmation text with the link to the customer's own page
import { serve, json, body, fail } from '../_shared/http.ts';
import { adminDb, settings, secret } from '../_shared/db.ts';
import { sha256hex } from '../_shared/tokens.ts';
import { baseOf, clientLink } from '../_shared/links.ts';
import { newToken } from '../_shared/tokens.ts';
import { sendSms } from '../_shared/ghl.ts';
import { money, clock, longDay, fill, first, blockWords, payNowWords, type Lang } from '../_shared/texts.ts';

type Row = Record<string, any>;
const LINK_DAYS = 90;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

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
/** who is asking, as a fingerprint (never the address itself) */
async function ipOf(req: Request): Promise<string | null> {
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || '').split(',')[0].trim();
  return ip ? (await sha256hex(`web-book:${ip}`)).slice(0, 24) : null;
}
function taxed(lines: Row[], s: Row): number {
  let sub = 0, tx = 0;
  for (const l of lines) { const t = Math.round(Number(l.qty || 1) * Number(l.unit_cents || 0)); sub += t; if (l.taxable !== false) tx += t; }
  const on = s.taxes?.enabled !== false && tx > 0;
  return sub + (on ? Math.round(tx * (s.taxes?.tps ?? 0.05)) + Math.round(tx * (s.taxes?.tvq ?? 0.09975)) : 0);
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

async function slots(b: Row) {
  const lat = num(b.lat), lng = num(b.lng);
  const ids = services(b.services);
  if (lat === null || lng === null) fail('far', 'Choisissez votre adresse dans la liste.');
  if (!ids.length) fail('no_service', 'Choisissez au moins un service.');
  const from = typeof b.from === 'string' && DAY.test(b.from) ? b.from : null;
  const days = Math.max(1, Math.min(28, Number(b.days) || 14));
  const list = await rpc('web_suggest', { p_lat: lat, p_lng: lng, p_services: ids, p_from: from, p_days: days, p_limit: 6 }) as Row[];
  // the customer sees the day, the block and whether a truck is already nearby; never the trucks or the minutes
  return { ok: true, from, days, slots: (list || []).map((x) => ({ day: x.day, block: x.block, near: Number(x.near) > 0 })) };
}

async function book(req: Request, b: Row) {
  // a field no person sees (robots fill it): pretend it worked, keep nothing
  if (typeof b.website === 'string' && b.website.trim()) return { ok: true, link: null, day: b.day, block: b.block, text: 'skipped' };
  const lang: Lang = b.lang === 'en' ? 'en' : 'fr';
  const res = await rpc('web_book', { p: {
    first_name: b.first_name, last_name: b.last_name, phone: b.phone, email: b.email, lang,
    address: b.address, unit: b.unit, city: b.city, postal_code: b.postal_code, lat: num(b.lat), lng: num(b.lng),
    vehicle: { year: b.vehicle?.year ?? null, make: b.vehicle?.make ?? null, model: b.vehicle?.model ?? null },
    services: services(b.services), day: b.day, block: b.block, problem: b.problem, ip: await ipOf(req)
  } }) as Row;
  const db = adminDb();
  const s = await settings();
  const jobId = String(res.job_id);
  // the link to the customer's own page (the estimate to sign, pay, follow the truck)
  const token = newToken(24);
  await db.from('public_links').insert({ token_hash: await sha256hex(token), job_id: jobId, quote_id: null,
    expires_at: new Date(Date.now() + LINK_DAYS * 86400000).toISOString(), created_by: null });
  const link = clientLink(baseOf(b.base), token, lang);

  // the usual confirmation text
  const { data: cust } = await db.from('customers').select('*').eq('id', res.customer_id).maybeSingle();
  const cu = (cust || {}) as Row;
  const tpl = String(s.messages?.[lang]?.booking || s.messages?.fr?.booking || '');
  let text: string = 'off';
  if (tpl) {
    const blk = ((s.booking?.blocks || []) as Row[]).find((x) => x.key === res.block) || { start: 480, end: 720 };
    const { data: items } = await db.from('job_items').select('qty, unit_cents, taxable, status').eq('job_id', jobId).is('deleted_at', null);
    const cardOn = !!(await secret('stripe_key'));
    const message = fill(tpl, {
      prenom: first(cu.first_name || b.first_name) || '', garage: s.company?.name || 'Mécanique Mobile H.I.S', telephone: s.company?.phone || '',
      jour: longDay(String(res.day), lang), debut: clock(blk.start, lang), fin: clock(blk.end, lang), bloc: blockWords(String(res.block), lang),
      payer: payNowWords(cardOn, lang), total: money(taxed((items || []) as Row[], s), lang), lien: link
    });
    const quiet = cu.sms_ok === false || s.messages?.on?.booking === false;
    const r = quiet ? { status: 'quiet' as const } : await sendSms({ first: cu.first_name, last: cu.last_name, phone: cu.phone, email: cu.email }, message);
    text = r.status;
    await db.from('messages').insert({ job_id: jobId, customer_id: cu.id || null, staff_id: null, kind: 'booking', channel: 'sms', to_addr: cu.phone || null,
      body: message, status: r.status === 'sent' ? 'sent' : r.status === 'error' ? 'failed' : 'skipped', provider_ref: (r as { id?: string }).id || null,
      error: (r as { error?: string }).error || r.status, created_by: null });
    if (r.status === 'sent') await db.from('jobs').update({ confirm_sent_at: new Date().toISOString() }).eq('id', jobId);
  }
  return { ok: true, link, day: res.day, block: res.block, text };
}

export const handler = serve(async (req) => {
  const b = await body<Row>(req);
  const action = String(b.action || 'info');
  if (action === 'info') return json(await info());
  if (action === 'slots') return json(await slots(b));
  if (action === 'book') return json(await book(req, b));
  fail('action', 'Action inconnue.');
});
