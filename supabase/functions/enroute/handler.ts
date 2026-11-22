// « Je pars »: the job goes en route (through the same rules as the app), a tracking link is made, the route and the
// arrival time are worked out, and the customer gets a text to follow the truck. Also: refresh (new route) and end.
// A refresh only puts a new time on the trip under way: a trip already ended is refused (not_en_route, 409), never made again;
// the trip stays its driver's (another member's refresh: not_allowed, 403); at most one every 4 minutes and 8 a trip (busy, 429).
//   { action: 'start' | 'refresh', job_id, pos?, notify?, resend?, base, driver_id? }
//     The trip belongs to the person who LEAVES: the caller when he has started his day (his phone shares where he is:
//     shared routes, the owner doing a job with another's vehicle), else the truck's named driver (the office, or an owner
//     who is also a mechanic, pressing for him: as on live), else the caller. Having the mechanic role is not enough: the
//     app sends its position and starts the day only for the truck's driver, so a mechanic with no day started and no
//     position would give the customer a text with no arrival time and a map with no truck. « driver_id » names him
//     explicitly (himself — the app under shared routes —, or anyone for the owner and the office). His name is in the text
//     and on the customer's map, his phone's position is the one followed, and the arrival time is worked out from where HE
//     is: the phone's « pos » only when he is the caller, else his last position (under 15 minutes).
//   { action: 'end', job_id }  { action: 'return', pos?, notify?, base, op? }  { action: 'return_end' }
//     « op » (a uuid made by the phone, the same when it tries again): the same « Je pars vers la Centrale » sent twice
//     (a lost answer on a weak signal, then a second tap) makes ONE trip and ONE text; the second answers sms 'already'
//     with the trip already made (the link of the first text keeps working).
import { serve, json, body, fail, env, withTimeout } from '../_shared/http.ts';
import { adminDb, caller, settings, type Caller } from '../_shared/db.ts';
import { claimMessage, finishMessage, dropMessage } from '../_shared/once.ts';
import { newToken, sha256hex } from '../_shared/tokens.ts';
import { baseOf, trackLink } from '../_shared/links.ts';
import { sendSms } from '../_shared/ghl.ts';
import { clock, fill, first, localMinute, type Lang } from '../_shared/texts.ts';
import { tomtomRouteUrl, readTomtomRoad, thin, type Road } from '../_shared/tomtom.ts';

interface Pt { lat: number; lng: number }
const okPt = (p: unknown): p is Pt => !!p && typeof (p as Pt).lat === 'number' && typeof (p as Pt).lng === 'number' && Math.abs((p as Pt).lat) <= 90 && Math.abs((p as Pt).lng) <= 180;
/** the road route with the traffic of now (TomTom, when the function has the secret TOMTOM_KEY); else, or when TomTom does
    not answer, OSRM (its time + 20 % for the traffic it does not know). null when neither answers: the trip then has no
    arrival time and no road, and the text is the one without a time (`en_route_no_eta`), exactly as when the phone has no
    position. Never a straight-line estimate (Hassan's rule, 2026-11-19: a real road time, or none). */
export async function route(a: Pt, b: Pt): Promise<Road | null> {
  const key = env('TOMTOM_KEY');
  if (key) {
    try {
      const r = await withTimeout(fetch(tomtomRouteUrl(env('TOMTOM_BASE', 'https://api.tomtom.com'), a, b, key)), 8000, 'calcul de trajet');
      const road = r.ok ? readTomtomRoad(await r.json()) : null;
      if (road) return road;
    } catch { /* OSRM below */ }
  }
  try {
    const u = `${env('OSRM_BASE', 'https://router.project-osrm.org')}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`;
    const r = await withTimeout(fetch(u, { headers: { 'User-Agent': 'his-garage-app' } }), 8000, 'calcul de trajet');
    const d = await r.json();
    const rt = d?.routes?.[0];
    if (!rt) throw new Error('no route');
    const line = thin((rt.geometry?.coordinates || []).map(([x, y]: [number, number]) => [Math.round(y * 1e5) / 1e5, Math.round(x * 1e5) / 1e5] as [number, number]));
    return { km: Math.round(rt.distance / 100) / 10, minutes: Math.max(1, Math.round((rt.duration / 60) * 1.2)), line, source: 'osrm' };
  } catch {
    return null;
  }
}

/** the garage's texts without an arrival time fall back to these (the owner may have erased the template) */
const RETURN_FALLBACK = {
  fr: '{mecano} a fini sa journée et revient vers {lieu}. Suivre le camion en direct : {lien}',
  en: '{mecano} is done for the day and heading back to {lieu}. Follow the truck live: {lien}'
};
/** (final-security F7) « Je pars » and « Je pars vers la Centrale » ask a road (TomTom with the server's key, outside the
    month's ceiling) at most 30 times an hour a person: past it the trip still goes, with no time (the text without a time),
    never refused. A refresh has its own brakes (every 4 minutes, 8 a trip). A brake that cannot be read lets it go */
async function roadAllowed(db: ReturnType<typeof adminDb>, who: string): Promise<boolean> {
  const { data, error } = await db.rpc('rate_hit', { p_key: `enroute:road:${who}`, p_window_sec: 3600, p_max: 30 });
  if (error) { console.error('enroute: brake', String(error.message).slice(0, 200)); return true; }
  return data === true;
}
/** « Retour à la Centrale »: a trip with no job, from where the phone is to the truck's start (or « Départ des camions »);
    the garage's return number gets the arrival time and the live map, like a customer would */
async function returnTrip(c: Caller, db: ReturnType<typeof adminDb>, b: Record<string, any>, action: string): Promise<Response> {
  if (action === 'return_end') {
    const { data } = await db.from('trips').update({ status: 'arrived', ended_at: new Date().toISOString() }).eq('staff_id', c.id).eq('kind', 'return').eq('status', 'active').select('*');
    return json({ ok: true, rows: { trips: data || [] } });
  }
  const s = await settings();
  // where to: the start of the truck this person drives (or their first truck), else the trucks' common start
  const { data: trucks } = c.access.trucks.length ? await db.from('trucks').select('id, driver_id, start').in('id', c.access.trucks) : { data: [] };
  const mineFirst = [...((trucks || []) as { id: string; driver_id: string | null; start: Record<string, any> | null }[])].sort((x, y) => Number(y.driver_id === c.id) - Number(x.driver_id === c.id));
  const own = mineFirst.find((t) => okPt(t.start))?.start || null;
  const home = (own || s.booking?.home || {}) as Record<string, any>;
  if (!okPt(home)) fail('no_home', 'Le départ des camions n’a pas de position : choisis son adresse dans Réglages → Réservations.');
  const dest: Pt = { lat: home.lat, lng: home.lng };
  const label: string = String((home as Record<string, any>).label || s.booking?.home?.label || 'Centrale');
  if (okPt(b.pos)) await c.db.rpc('report_position', { p_lat: b.pos.lat, p_lng: b.pos.lng, p_accuracy: null, p_heading: null, p_speed: null, p_job: null });
  const { data: live } = await db.from('positions').select('lat, lng, at').eq('id', c.id).is('deleted_at', null).maybeSingle();
  const from: Pt | null = okPt(b.pos) ? b.pos : (live && Date.parse((live as any).at) > Date.now() - 15 * 60000 ? { lat: (live as any).lat, lng: (live as any).lng } : null);
  const rt = from && await roadAllowed(db, c.id) ? await route(from, dest) : null;
  const eta = rt ? new Date(Date.now() + rt.minutes * 60000) : null;
  // the same « Je pars » sent again (same op): the trip and the text already made are the answer
  const op = b.op == null ? null : String(b.op);
  if (op != null) {
    const once = await claimMessage(op, { job_id: null, customer_id: null, staff_id: c.id, kind: 'return_trip', channel: 'sms', created_by: c.id });
    if (!once.claimed) {
      const { data: active, error: ea } = await db.from('trips').select('*').eq('staff_id', c.id).eq('kind', 'return').eq('status', 'active').order('created_at', { ascending: false }).limit(1);
      if (ea) throw ea;
      const t = ((active || []) as Record<string, any>[])[0] || null;
      return json({ ok: true, sms: 'already', again: true, link: null, message: once.row.body ?? null, phone: once.row.to_addr ?? null, place: t?.dest_label ?? label,
        eta_at: t?.eta_at ?? null, minutes: t?.minutes ?? null, km: t?.km ?? null, route_source: null, rows: { trips: t ? [t] : [] } });
    }
  }
  try {
    return await returnGo(c, db, b, op, s, { dest, label, rt, eta });
  } catch (e) {
    if (op != null) await dropMessage(op, String((e as Error)?.message || e));   // the next try may send it
    throw e;
  }
}
async function returnGo(c: Caller, db: ReturnType<typeof adminDb>, b: Record<string, any>, op: string | null, s: Record<string, any>,
  w: { dest: Pt; label: string; rt: Awaited<ReturnType<typeof route>> | null; eta: Date | null }): Promise<Response> {
  const { dest, label, rt, eta } = w;
  // one trip back at a time: a second « Je pars » replaces the first (a new link, the old one stops working)
  await db.from('trips').update({ status: 'cancelled', ended_at: new Date().toISOString() }).eq('staff_id', c.id).eq('kind', 'return').eq('status', 'active');
  const token = newToken(18);
  const { data: trip, error } = await db.from('trips').insert({
    job_id: null, kind: 'return', dest_label: label, staff_id: c.id, token_hash: await sha256hex(token), created_by: c.id,
    eta_at: eta?.toISOString() ?? null, km: rt?.km ?? null, minutes: rt?.minutes ?? null, route: rt?.line ?? null,
    dest_lat: dest.lat, dest_lng: dest.lng, expires_at: new Date(Date.now() + 4 * 3600000).toISOString()
  }).select('*').single();
  if (error) throw error;
  // the text, to the garage's return number, in the owner's language
  const { data: owner } = await db.from('staff').select('first_name:full_name, lang').contains('roles', ['owner']).is('deleted_at', null).order('created_at').limit(1).maybeSingle();
  const lang: Lang = (owner as any)?.lang === 'en' ? 'en' : 'fr';
  const link = trackLink(baseOf(b.base), token, lang);
  const { data: drv } = await db.from('staff').select('short_name, full_name').eq('id', c.id).maybeSingle();
  const vars = { mecano: first((drv as any)?.short_name || (drv as any)?.full_name) || (lang === 'en' ? 'The mechanic' : 'Le mécano'), lieu: label,
    garage: s.company?.name || 'Mécanique Mobile H.I.S', heure: eta ? clock(localMinute(eta), lang) : '', minutes: rt ? String(rt.minutes) : '', lien: link };
  const tpl = (rt ? s.messages?.[lang]?.return_trip : null) || RETURN_FALLBACK[lang];
  const message = fill(String(tpl), vars);
  const phone = String(s.booking?.return_phone || '').trim();
  const quiet = b.notify === false || s.messages?.on?.return_trip === false;
  const ownerName = String((owner as any)?.first_name || 'Garage').split(/\s+/);
  const r = !phone ? { status: 'no_phone' as const } : quiet ? { status: 'quiet' as const } : await sendSms({ first: ownerName[0], last: ownerName.slice(1).join(' ') || null, phone, email: null }, message, 'garage-retour');
  await db.from('trips').update({ sms_status: r.status }).eq('id', (trip as any).id);
  const logged = { job_id: null, customer_id: null, staff_id: c.id, kind: 'return_trip', channel: 'sms', to_addr: phone || null,
    body: message, status: r.status === 'sent' ? 'sent' : r.status === 'error' ? 'failed' : 'skipped', error: (r as { error?: string }).error || r.status, created_by: c.id };
  if (op != null) await finishMessage(op, logged);
  else await db.from('messages').insert(logged);
  return json({ ok: true, sms: r.status, error: (r as { error?: string }).error, link, message, phone: phone || null, place: label,
    eta_at: (trip as any)?.eta_at ?? null, minutes: (trip as any)?.minutes ?? null, km: (trip as any)?.km ?? null, route_source: rt?.source ?? null, rows: { trips: [trip] } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fresh = (p: { at?: string } | null) => !!p && Date.parse(String(p.at)) > Date.now() - 15 * 60000;

/** who is leaving for this job (see the top of the file) */
async function whoLeaves(c: Caller, db: ReturnType<typeof adminDb>, j: Record<string, any>, b: Record<string, any>): Promise<string> {
  if (b.driver_id != null && b.driver_id !== '') {
    const want = String(b.driver_id);
    if (!UUID.test(want)) fail('not_found', 'Cette personne n’est pas dans l’équipe.', 404);
    if (want !== c.id && !(c.access.owner || c.access.rights.book)) fail('not_allowed', 'Seuls le propriétaire et le bureau partent au nom d’un autre.', 403);
    if (want !== c.id) {
      const { data, error } = await db.from('staff').select('id').eq('id', want).eq('active', true).is('deleted_at', null).maybeSingle();
      if (error) throw error;
      if (!data) fail('not_found', 'Cette personne n’est pas dans l’équipe.', 404);
    }
    return want;
  }
  const { data: shift, error: es } = await db.from('shifts').select('id').eq('staff_id', c.id).is('ended_at', null).is('deleted_at', null).limit(1);
  if (es) throw es;
  if (((shift || []) as unknown[]).length) return c.id;
  const { data: truck, error: et } = j.truck_id ? await db.from('trucks').select('driver_id').eq('id', j.truck_id).maybeSingle() : { data: null, error: null };
  if (et) throw et;
  return (truck as { driver_id?: string } | null)?.driver_id || c.id;
}

export const handler = serve(async (req) => {
  const b = await body(req);
  const action = String(b.action || 'start');
  const c = await caller(req);
  const db = adminDb();
  if (action === 'return' || action === 'return_end') return returnTrip(c, db, b, action);
  if (action !== 'start' && action !== 'refresh' && action !== 'end') fail('action', 'Action inconnue.');
  if (!UUID.test(String(b.job_id || ''))) fail('not_found', 'Cette job n’existe plus.', 404);
  const { data: job, error: ej } = await c.db.from('jobs').select('*').eq('id', String(b.job_id || '')).maybeSingle();
  if (ej) throw ej;
  if (!job) fail('not_found', 'Cette job n’existe plus (ou tu n’y as pas accès).');
  const j = job as Record<string, any>;
  const mine = c.access.trucks.includes(j.truck_id) || j.created_by === c.id;
  if (!(mine || c.access.rights.book || c.access.owner)) fail('not_allowed', 'Cette job n’est pas à toi.', 403);

  if (action === 'end') {
    await db.from('trips').update({ status: 'cancelled', ended_at: new Date().toISOString() }).eq('job_id', j.id).eq('status', 'active');
    return json({ ok: true });
  }

  // the job moves to « En route » through the normal rule (refused while the job before is unpaid…)
  if (action === 'start' && j.status === 'booked') {
    const { error } = await c.db.rpc('job_step', { p_op: crypto.randomUUID(), p_job: j.id, p_action: 'leave', p_data: {} });
    if (error) throw error;
    j.status = 'en_route';
  }
  // « not on the way »: one status on every path, 409 (the job is not in the state the action needs; the phone reads the code)
  if (j.status !== 'en_route') fail('not_en_route', 'Cette job n’est pas en route.', 409);
  // a refresh only puts a new time on the trip under way: it never makes a trip, a link or a text. A trip that ended
  // (« Terminer ma journée », the night's cleanup, an expired one) stays ended and the customer gets nothing; asked
  // before the road, so an ended trip costs no TomTom request (the driver's phone stops asking for it on this answer:
  // src/services/tripRefresh.ts). Checked again below: it may end while the road is worked out
  const ENDED = 'Ce trajet est terminé : rien n’a été changé ni envoyé.';
  let act: { id: string; staff_id: string | null; updated_at: string } | null = null;
  if (action === 'refresh') {
    const { data, error: ea } = await db.from('trips').select('id, staff_id, updated_at').eq('job_id', j.id).eq('status', 'active').maybeSingle();
    if (ea) throw ea;
    if (!data) fail('not_en_route', ENDED, 409);
    act = data as { id: string; staff_id: string | null; updated_at: string };
  }

  // who is leaving: his position, his name, his trip
  const driver = await whoLeaves(c, db, j, b);
  if (act) {
    // a refresh never hands the trip to whoever sends it (the customer's map follows the phone of the one driving it)
    if (act.staff_id && act.staff_id !== driver) fail('not_allowed', 'Ce trajet est celui d’un autre membre de l’équipe : rien n’a été changé.', 403);
    // each refresh is one TomTom request: at most one every 4 minutes (the phone asks every 5 at most) and 8 a trip,
    // both refused before any road is asked
    if (Date.now() - Date.parse(act.updated_at) < 4 * 60_000) fail('busy', 'Le temps de ce trajet vient d’être calculé. Réessaie dans quelques minutes.', 429);
    const { data: room, error: eh } = await db.rpc('rate_hit', { p_key: `enroute:refresh:${act.id}`, p_window_sec: 2147483647, p_max: 8 });
    if (eh) throw eh;
    if (room !== true) fail('busy', 'Le temps de ce trajet a déjà été recalculé 8 fois.', 429);
  }
  const mePos = okPt(b.pos) && driver === c.id ? (b.pos as Pt) : null;
  if (mePos) {
    await c.db.rpc('report_position', { p_lat: mePos.lat, p_lng: mePos.lng, p_accuracy: null, p_heading: null, p_speed: null, p_job: j.id });
  }
  const { data: live } = mePos ? { data: null } : await db.from('positions').select('lat, lng, at').eq('id', driver).is('deleted_at', null).maybeSingle();
  const from: Pt | null = mePos || (fresh(live as { at?: string } | null) ? { lat: (live as any).lat, lng: (live as any).lng } : null);
  const { data: cust, error: ec } = await db.from('customers').select('*').eq('id', j.customer_id).maybeSingle();
  if (ec) throw ec;
  const cu = (cust || {}) as Record<string, any>;
  const dest: Pt | null = okPt({ lat: j.lat ?? cu.lat, lng: j.lng ?? cu.lng }) ? { lat: j.lat ?? cu.lat, lng: j.lng ?? cu.lng } : null;
  const rt = from && dest && (action === 'refresh' || await roadAllowed(db, c.id)) ? await route(from, dest) : null;
  const eta = rt ? new Date(Date.now() + rt.minutes * 60000) : null;

  // the route took a few seconds: « Je suis arrivé » may have come meanwhile (it ends the trips): no trip, no text then
  const { data: now, error: en } = await db.from('jobs').select('status').eq('id', j.id).maybeSingle();
  if (en) throw en;
  if ((now as { status?: string } | null)?.status !== 'en_route') fail('not_en_route', 'Cette job n’est plus en route.', 409);

  // one active trip per job; a new token each start (the old link stops working)
  const { data: existing, error: ex } = await db.from('trips').select('*').eq('job_id', j.id).eq('status', 'active').maybeSingle();
  if (ex) throw ex;
  const lang: Lang = cu.lang === 'en' ? 'en' : 'fr';
  let token: string | null = null;
  let trip = existing as Record<string, any> | null;
  if (action === 'refresh' && !trip) fail('not_en_route', ENDED, 409);   // ended while the road was worked out
  // a refresh keeps the trip's driver (checked above); « Je pars » gives the trip to the one who leaves
  const patch = { ...(action === 'refresh' ? {} : { staff_id: driver }), eta_at: eta?.toISOString() ?? null, km: rt?.km ?? null, minutes: rt?.minutes ?? null, route: rt?.line ?? null,
    dest_lat: dest?.lat ?? null, dest_lng: dest?.lng ?? null, expires_at: new Date(Date.now() + 4 * 3600000).toISOString() };
  if (!trip || action === 'start' && b.resend) {
    token = newToken(18);
    if (trip) {
      const { data, error } = await db.from('trips').update({ ...patch, token_hash: await sha256hex(token) }).eq('id', trip.id).select('*').single();
      if (error) throw error;
      trip = data;
    } else {
      const { data, error } = await db.from('trips').insert({ job_id: j.id, ...patch, token_hash: await sha256hex(token), created_by: c.id }).select('*').single();
      if (error && error.code === '23505') {
        // two « Je pars » at the same instant (two phones on the same job): the other one made the trip and sends the text
        const { data: other, error: eo } = await db.from('trips').select('*').eq('job_id', j.id).eq('status', 'active').maybeSingle();
        if (eo) throw eo;
        token = null;
        trip = other as Record<string, any> | null;
      } else {
        if (error) throw error;
        trip = data;
      }
    }
  } else if (rt) {
    const { data, error } = await db.from('trips').update(patch).eq('id', trip.id).select('*').single();
    if (error) throw error;
    trip = data;
  }

  // the text (once, unless asked again)
  let sms = { status: 'already' as string, error: undefined as string | undefined };
  let message: string | null = null, link: string | null = null;
  if (token) {
    link = trackLink(baseOf(b.base), token, lang);
    const s = await settings();
    const { data: drv } = await db.from('staff').select('short_name, full_name').eq('id', driver).maybeSingle();
    const vars = { prenom: first(cu.first_name), mecano: first((drv as any)?.short_name || (drv as any)?.full_name) || (lang === 'en' ? 'Your mechanic' : 'Votre mécano'),
      garage: s.company?.name || 'Mécanique Mobile H.I.S', heure: eta ? clock(localMinute(eta), lang) : '',
      minutes: rt ? String(rt.minutes) : '', lien: link };
    message = fill((s.messages?.[lang]?.[rt ? 'en_route' : 'en_route_no_eta'] || s.messages?.fr?.en_route_no_eta || '{lien}') as string, vars);
    const quiet = b.notify === false || cu.sms_ok === false || s.messages?.on?.en_route === false;
    const r = quiet ? { status: 'quiet' } : await sendSms({ first: cu.first_name, last: cu.last_name, phone: cu.phone, email: cu.email }, message);
    sms = { status: r.status, error: (r as { error?: string }).error };
    await db.from('trips').update({ sms_status: r.status }).eq('id', trip!.id);
    await db.from('messages').insert({ job_id: j.id, customer_id: cu.id || null, staff_id: c.id, kind: 'en_route', channel: 'sms', to_addr: cu.phone || null,
      body: message, status: r.status === 'sent' ? 'sent' : r.status === 'error' ? 'failed' : 'skipped', error: (r as { error?: string }).error || r.status, created_by: c.id });
  }
  // the job's rows as they are now (the app puts them in its copy at once). job_payload is kept for the server (Part 13):
  // the person's right to this job was checked above.
  const { data: rows, error: er } = await db.rpc('job_payload', { p_job: j.id });
  if (er) console.error('enroute job_payload', er.message);
  return json({ ok: true, sms: sms.status, error: sms.error, link, message, phone: cu.phone || null,
    eta_at: trip?.eta_at ?? null, minutes: trip?.minutes ?? null, km: trip?.km ?? null, route_source: rt?.source ?? null, rows: rows ?? null });
});
