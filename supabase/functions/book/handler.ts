// « Réserver en ligne » (client.html#reserver): one public link, no account.
//   info   the garage, whether online booking is open, the services offered, the blocks
//   slots  the best blocks for an address and the services chosen (where a truck already goes nearby, soonest); with
//          « Vraies routes » on, the address's trips are measured first (measureFirst: TomTom within the page's own
//          brakes, 30 addresses an hour and booking.roads_web_tx transactions a month; past them OSRM)
//          « Plages d’arrivée » (settings.booking.windows_on): each slot is a day with its 4-hour window (block 'day',
//          win_start, win_end); the customer books that window, or « flexible » (free all day: win_flex, the window is
//          confirmed the day before). A window that can no longer be kept is refused with `window_full`.
//   book   books one of them: the customer (found by phone, else created), the car, the job and its link in one
//          transaction (web_book); then the usual confirmation text. A failure after the booking never hides it:
//          the page still gets « ok » and the link (text: 'error'); the same booking sent again gets the same job.
// Brakes (Part 24, rate_hit): « slots » 20 per 10 min per visitor and 150 an hour in all; « book » 12 tries an hour per visitor.
// Part 28: the confirmation goes under the appointment's lease (tell_take, as notify's texts and the day's button: never
// two texts at once) and, once sent (or « peut-être parti »), writes what the customer was told (tell_done, by nobody).
import { serve, json, body, fail } from '../_shared/http.ts';
import { adminDb, settings, secret } from '../_shared/db.ts';
import { sha256hex, newToken } from '../_shared/tokens.ts';
import { sumLines } from '../_shared/money.ts';
import { visitorMark } from '../_shared/visitor.ts';
import { baseOf, clientLink } from '../_shared/links.ts';
import { sendSms } from '../_shared/ghl.ts';
import { money, fill, first, type Lang, servicesList, subtotalWords, whenText, jobWindow } from '../_shared/texts.ts';
import { warmPoint, tableClaims, monthAllowance } from '../_shared/roads.ts';

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const BUSY = 'Trop de demandes en même temps. Réessayez dans quelques minutes ou appelez le garage.';

function garageOf(s: Row) {
  return { name: s.company?.name || 'Mécanique Mobile H.I.S', phone: s.company?.phone || null, email: s.company?.email || null,
    address: s.company?.address || null };
}
/** a real day of the calendar written YYYY-MM-DD (never « 2026-02-31 ») */
function realDay(x: unknown): boolean {
  if (typeof x !== 'string' || !DAY.test(x)) return false;
  const [y, m, d] = x.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
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
/** who is asking, as a fingerprint for the day (never the address itself; made with a secret of the server, so the
    address cannot be found back from it) */
const ipOf = (req: Request): Promise<string | null> => visitorMark(req, 'web-book', true);
/** the brake: false when this visitor (or everyone) asked too often */
async function allowed(key: string, windowSec: number, max: number): Promise<boolean> {
  return (await rpc('rate_hit', { p_key: key, p_window_sec: windowSec, p_max: max })) === true;
}
/** a submission that is not a person's (the hidden field was filled): nothing kept, but the office can see it happened */
async function robot(ip: string | null, reason: string) {
  try { await adminDb().from('activity').insert({ entity: 'web', entity_id: null, action: 'web_robot', data: { reason, ip } }); } catch { /* a log only */ }
}
/** « Vraies routes » on: the address's usual-hours trips of those days are measured before the moments are asked
    (web_suggest offers online only moments whose trips are all measured), the same « warm » as the team's screens
    (_shared/roads.ts). Only with the switch on (off, the planner does not read them: no TomTom spent for nothing), only
    for an address inside the garage's area (a far one is refused by web_suggest anyway), at most 8 s (TomTom 3.5 s, then
    OSRM 2.5 s: a TomTom that does not answer still leaves OSRM the time); whatever happens here (TomTom and OSRM both
    down, the month's ceiling), the moments are still asked: a moment not measured is then just not offered, and the page
    never breaks. Anyone may call this page, so it has its own brakes: 30 addresses measured an hour (`drive:web`, counted
    by EVERY call that measures, OSRM included: final-security F2, the rows a robot would leave are bounded; past it the
    address is not measured, its moments are not offered and the page says it cannot offer one now) and a TomTom allowance
    of the month (booking.roads_web_tx transactions, 1 000 when not set; past it OSRM measures: the moments are still offered
    and the team keeps its month) */
async function measureFirst(lat: number, lng: number, from: string | null, days: number) {
  try {
    if ((await rpc('roads_on', {})) !== true) return;
    if ((await rpc('web_in_area', { p_lat: lat, p_lng: lng })) !== true) return;
    // something to measure for that address? (a call that measures nothing counts nothing)
    const w = await rpc('drive_wanted', { p_point: { lat, lng }, p_from: from, p_days: days });
    if (!(Array.isArray(w?.pairs) && w.pairs.some((p: unknown[]) => Array.isArray(p) && p[5] === true && p[4] === 0))) return;
    if (!(await allowed('drive:web', 3600, 30))) return;
    const cap = Number((await settings()).booking?.roads_web_tx ?? 1000);
    const db = adminDb(), claims = tableClaims(db);
    const month = monthAllowance(db, claims, Number.isFinite(cap) ? cap : 1000);
    const gate = (cost: number) => month(cost);
    await warmPoint(rpc, { lat, lng }, from, days, true, { ms: 8000, requests: 6, tomtomMs: 3500, osrmMs: 2500 }, { claims, gate });
  } catch (e) {
    console.error('book: measuring the address', String((e as Error)?.message || e).slice(0, 200));
  }
}
/** the total of lines, the same way everywhere (a discount counts negative): _shared/money.ts */
const taxed = (lines: Row[], s: Row): number => sumLines(lines, s).total;
/** Part 28: the day and the hours the confirmation tells (a 'day' booking its window, none = flexible; a block booking its
    block's hours: the settings', else the garage's three, as blocks_set() of the database) */
const DEFAULT_BLOCKS = [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }];
function toldOf(j: Row, s: Row): { day: string; start: number | null; end: number | null } {
  if (j.block === 'day') { const w = jobWindow(j as never); return { day: String(j.day), start: w ? w[0] : null, end: w ? w[1] : null }; }
  const b = ((Array.isArray(s.booking?.blocks) ? s.booking.blocks : DEFAULT_BLOCKS) as Row[]).find((x) => x.key === j.block);
  return { day: String(j.day), start: b && Number.isFinite(Number(b.start)) ? Number(b.start) : null, end: b && Number.isFinite(Number(b.end)) ? Number(b.end) : null };
}
/** the lease's number: tell_done / tell_release drop exactly the lease this booking took */
const leaseToken = () => 1 + Math.floor(Math.random() * 2147483646);

async function info() {
  const s = await settings();
  const on = s.booking?.web?.on === true;
  const blocks = ((s.booking?.blocks?.length ? s.booking.blocks : [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }]) as Row[])
    .map((b) => ({ key: b.key, start: b.start, end: b.end }));
  const tx = s.taxes?.enabled !== false;
  return { ok: true, garage: garageOf(s), on, windows: s.booking?.windows_on === true, services: on ? await rpc('web_services', {}) : [], blocks, taxes: tx,
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
  // (final-security F1) online booking closed: refused BEFORE anything is measured (web_suggest says the same after)
  if ((await rpc('web_on', {})) !== true) fail('web_off', 'La réservation en ligne est fermée pour le moment. Appelez le garage.');
  await measureFirst(lat, lng, from, days);
  const list = await rpc('web_suggest', { p_lat: lat, p_lng: lng, p_services: ids, p_from: from, p_days: days, p_limit: 6 }) as Row[];
  // (final-critic W1) nothing offered because the trips are not measured yet (« Vraies routes » on): the page says it cannot
  // offer a moment for that address right now (call us), never « no moment free »
  let unmeasured = false;
  if (!(list || []).length) {
    try { unmeasured = Number(await rpc('web_unmeasured', { p_lat: lat, p_lng: lng, p_services: ids, p_from: from, p_days: days })) > 0; } catch (e) {
      console.error('book: unmeasured', String((e as Error)?.message || e).slice(0, 200));
    }
  }
  // the customer sees the day, the block and whether a truck is already nearby; never the trucks or the minutes
  // (window mode: the day and its window, « entre 14 h et 18 h »)
  return { ok: true, from, days, ...(unmeasured ? { unmeasured: true } : {}), slots: (list || []).map((x) => ({ day: x.day, block: x.block, near: Number(x.near) > 0,
    ...(x.block === 'day' && num(x.win_start) !== null && num(x.win_end) !== null ? { win_start: Number(x.win_start), win_end: Number(x.win_end) } : {}) })) };
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
  // a day that is not a date never reaches the database (it answered « the server had a problem »)
  if (!realDay(b.day)) fail('bad_block', 'Choisissez une date dans la liste.');
  const lang: Lang = b.lang === 'en' ? 'en' : 'fr';
  // the customer's link is made with the booking itself (same transaction): a job never exists without it
  const token = newToken(24);
  const res = await rpc('web_book', { p: {
    first_name: b.first_name, last_name: b.last_name, phone: b.phone, email: b.email, lang,
    address: b.address, unit: b.unit, city: b.city, postal_code: b.postal_code, lat: num(b.lat), lng: num(b.lng),
    vehicle: { year: b.vehicle?.year ?? null, make: b.vehicle?.make ?? null, model: b.vehicle?.model ?? null },
    services: services(b.services), day: b.day, block: b.block, problem: b.problem, ip, token_hash: await sha256hex(token),
    // the window chosen, or « free all day » (only said for a 'day' booking: a block booking is sent as always)
    ...(b.block === 'day' ? (b.win_flex === true ? { win_flex: true } : num(b.win_start) !== null ? { win_start: num(b.win_start) } : {}) : {})
  } }) as Row;
  const link = clientLink(baseOf(b.base), token, lang);
  const jobId = String(res.job_id);
  const again = res.again === true;
  const db = adminDb();
  // a 'day' booking: what was promised is on the job (the server sets the end of the window; a flexible one has none yet)
  let when: Row = { day: String(res.day), block: String(res.block), win_start: res.win_start ?? null, win_end: res.win_end ?? null, win_flex: res.win_flex === true };
  if (when.block === 'day') {
    try {
      const { data: jb } = await db.from('jobs').select('*').eq('id', jobId).maybeSingle();
      if (jb) when = { day: String((jb as Row).day), block: String((jb as Row).block), win_start: (jb as Row).win_start ?? null, win_end: (jb as Row).win_end ?? null, win_flex: (jb as Row).win_flex === true };
    } catch { /* the answer of web_book is used */ }
  }
  const win = jobWindow(when as never);
  const extra = when.block === 'day' ? { win_start: win ? win[0] : null, win_end: win ? win[1] : null, flex: !win } : {};

  // the usual confirmation text; whatever happens here, the booking is made and the page gets its link
  let text = 'off';
  const lease = leaseToken();
  let leased = false, went = false;
  try {
    if (again) {
      const { data: prev, error: ep } = await db.from('messages').select('id').eq('job_id', jobId).eq('kind', 'booking').eq('status', 'sent').limit(1);
      if (ep) throw ep;
      if (prev?.length) return { ok: true, link, day: res.day, block: res.block, ...extra, text: 'already', again };
    }
    const s = await settings();
    // a read that fails sends no text at all (caught below: « text: error », noted on the job), never a text to nobody
    // or one that says « selon le travail sur place » for priced work
    const { data: cust, error: ec } = await db.from('customers').select('*').eq('id', res.customer_id).maybeSingle();
    if (ec) throw ec;
    const cu = (cust || {}) as Row;
    const tpl = String(s.messages?.[lang]?.booking || s.messages?.fr?.booking || '');
    if (tpl) {
      // the appointment's lease (Part 28): already told, or another send holding him right now → no second text
      const taken = await rpc('tell_take', { p_jobs: [jobId], p_again: null, p_token: lease, p_force: false });
      const mine = (Array.isArray(taken) ? taken as Row[] : []).find((x) => String(x?.id).toLowerCase() === jobId.toLowerCase());
      if (!mine?.take) return { ok: true, link, day: res.day, block: res.block, ...extra, text: 'already', again };
      leased = true;
      const w = whenText(tpl, when as never, s.booking?.blocks, lang);
      const { data: items, error: ei } = await db.from('job_items').select('description, kind, qty, unit_cents, taxable, status, sort').eq('job_id', jobId).is('deleted_at', null).order('sort');
      if (ei) throw ei;
      const cardOn = !!(await secret('stripe_key'));
      const message = fill(w.tpl, {
        // the person who booked is greeted by the name they typed (a spouse on a shared number is not « Bonjour Marc »)
        prenom: first(typeof b.first_name === 'string' ? b.first_name : '') || first(cu.first_name) || '', garage: s.company?.name || 'Mécanique Mobile H.I.S', telephone: s.company?.phone || '',
        ...w.vars,
        payer: '', total: money(taxed((items || []) as Row[], s), lang), lien: link,
        services: servicesList((items || []) as never, lang), soustotal: subtotalWords((items || []) as never, lang)
      });
      const quiet = cu.sms_ok === false || s.messages?.on?.booking === false;
      const r = quiet ? { status: 'quiet' as const } : await sendSms({ first: cu.first_name, last: cu.last_name, phone: cu.phone, email: cu.email }, message);
      text = r.status;
      const maybe = r.status === 'error' && (r as { maybe?: boolean }).maybe === true;
      went = r.status === 'sent' || maybe;
      await db.from('messages').insert({ job_id: jobId, customer_id: cu.id || null, staff_id: null, kind: 'booking', channel: 'sms', to_addr: cu.phone || null,
        body: message, status: r.status === 'sent' ? 'sent' : r.status === 'error' ? 'failed' : 'skipped', provider_ref: (r as { id?: string }).id || null,
        error: (r as { error?: string }).error || r.status, created_by: null });
      // what the text said is what he was told (tell_done writes confirm_sent_at with it); a text that may have gone
      // (« peut-être parti ») too: never a second one by itself; one that did not go drops the lease
      if (went) {
        const told = toldOf(when, s);
        const { error: et } = await db.rpc('tell_done', { p_job: jobId, p_token: lease, p_now: { ...told, rewin: false }, p_how: maybe ? 'maybe' : 'sms', p_by: null, p_kind: 'booking' });
        if (et) console.error('book: tell_done', String(et.message || et).slice(0, 200));
      } else { leased = false; await db.rpc('tell_release', { p_job: jobId, p_token: lease }); }
    }
  } catch (e) {
    if (leased && !went) { try { await adminDb().rpc('tell_release', { p_job: jobId, p_token: lease }); } catch { /* the lease ends by itself in 2 minutes */ } }
    console.error('book: after the booking', String((e as Error)?.message || e).slice(0, 200));
    text = 'error';
    try {
      await db.from('messages').insert({ job_id: jobId, customer_id: res.customer_id || null, staff_id: null, kind: 'booking', channel: 'sms', to_addr: null,
        body: 'Texto de confirmation non envoyé : erreur du serveur après la réservation.', status: 'failed', error: String((e as Error)?.message || e).slice(0, 200), created_by: null });
    } catch { /* the booking itself is safe */ }
  }
  return { ok: true, link, day: res.day, block: res.block, ...extra, text, again };
}

export const handler = serve(async (req) => {
  const b = await body<Row>(req);
  const action = String(b.action || 'info');
  if (action === 'info') return json(await info());
  if (action === 'slots') return json(await slots(req, b));
  if (action === 'book') return json(await book(req, b));
  fail('action', 'Action inconnue.');
});
