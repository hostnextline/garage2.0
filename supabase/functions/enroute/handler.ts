// « Je pars »: the job goes en route (through the same rules as the app), a tracking link is made, the route and the
// arrival time are worked out, and the customer gets a text to follow the truck. Also: refresh (new route) and end.
import { serve, json, body, fail, env, withTimeout } from '../_shared/http.ts';
import { adminDb, caller, settings } from '../_shared/db.ts';
import { newToken, sha256hex } from '../_shared/tokens.ts';
import { baseOf, trackLink } from '../_shared/links.ts';
import { sendSms } from '../_shared/ghl.ts';
import { clock, fill, first, localMinute, type Lang } from '../_shared/texts.ts';

interface Pt { lat: number; lng: number }
const okPt = (p: unknown): p is Pt => !!p && typeof (p as Pt).lat === 'number' && typeof (p as Pt).lng === 'number' && Math.abs((p as Pt).lat) <= 90 && Math.abs((p as Pt).lng) <= 180;
function km(a: Pt, b: Pt) {
  const r = (x: number) => (x * Math.PI) / 180, R = 6371;
  const d = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(d)));
}
/** the road route (OSRM), or a straight line estimate when it does not answer */
export async function route(a: Pt, b: Pt): Promise<{ km: number; minutes: number; line: [number, number][]; source: string }> {
  try {
    const u = `${env('OSRM_BASE', 'https://router.project-osrm.org')}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`;
    const r = await withTimeout(fetch(u, { headers: { 'User-Agent': 'his-garage-app' } }), 8000, 'calcul de trajet');
    const d = await r.json();
    const rt = d?.routes?.[0];
    if (!rt) throw new Error('no route');
    let line = (rt.geometry?.coordinates || []).map(([x, y]: [number, number]) => [Math.round(y * 1e5) / 1e5, Math.round(x * 1e5) / 1e5] as [number, number]);
    if (line.length > 250) { const step = Math.ceil(line.length / 250); line = line.filter((_: unknown, i: number) => i % step === 0 || i === line.length - 1); }
    return { km: Math.round(rt.distance / 100) / 10, minutes: Math.max(1, Math.round((rt.duration / 60) * 1.2)), line, source: 'osrm' };
  } catch {
    const d = km(a, b) * 1.35;
    return { km: Math.round(d * 10) / 10, minutes: Math.max(2, Math.round((d / 30) * 60 + 2)), line: [[a.lat, a.lng], [b.lat, b.lng]], source: 'line' };
  }
}

/** the garage's texts without an arrival time fall back to these (the owner may have erased the template) */
const RETURN_FALLBACK = {
  fr: '{mecano} a fini sa journée et revient vers {lieu}. Suivre le camion en direct : {lien}',
  en: '{mecano} is done for the day and heading back to {lieu}. Follow the truck live: {lien}'
};
/** « Retour à la Centrale »: a trip with no job, from where the phone is to the truck's start (or « Départ des camions »);
    the garage's return number gets the arrival time and the live map, like a customer would */
async function returnTrip(c: Awaited<ReturnType<typeof caller>>, db: ReturnType<typeof adminDb>, b: Record<string, any>, action: string): Promise<Response> {
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
  const label: string = String(home.label || s.booking?.home?.label || 'Centrale');
  if (okPt(b.pos)) await c.db.rpc('report_position', { p_lat: b.pos.lat, p_lng: b.pos.lng, p_accuracy: null, p_heading: null, p_speed: null, p_job: null });
  const { data: live } = await db.from('positions').select('lat, lng, at').eq('id', c.id).is('deleted_at', null).maybeSingle();
  const from: Pt | null = okPt(b.pos) ? b.pos : (live && Date.parse((live as any).at) > Date.now() - 15 * 60000 ? { lat: (live as any).lat, lng: (live as any).lng } : null);
  const rt = from ? await route(from, dest) : null;
  const eta = rt ? new Date(Date.now() + rt.minutes * 60000) : null;
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
  await db.from('messages').insert({ job_id: null, customer_id: null, staff_id: c.id, kind: 'return_trip', channel: 'sms', to_addr: phone || null,
    body: message, status: r.status === 'sent' ? 'sent' : r.status === 'error' ? 'failed' : 'skipped', error: (r as { error?: string }).error || r.status, created_by: c.id });
  return json({ ok: true, sms: r.status, error: (r as { error?: string }).error, link, message, phone: phone || null, place: label,
    eta_at: (trip as any)?.eta_at ?? null, minutes: (trip as any)?.minutes ?? null, km: (trip as any)?.km ?? null, route_source: rt?.source ?? null, rows: { trips: [trip] } });
}

export const handler = serve(async (req) => {
  const b = await body(req);
  const action = String(b.action || 'start');
  const c = await caller(req);
  const db = adminDb();
  if (action === 'return' || action === 'return_end') return returnTrip(c, db, b, action);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(b.job_id || ''))) fail('not_found', 'Cette job n’existe plus.', 404);
  const { data: job } = await c.db.from('jobs').select('*').eq('id', String(b.job_id || '')).maybeSingle();
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
  if (j.status !== 'en_route') fail('not_en_route', 'Cette job n’est pas en route.');

  // who is driving: the truck's mechanic (his phone sends the position), else the person who pressed
  const { data: truck } = j.truck_id ? await db.from('trucks').select('driver_id').eq('id', j.truck_id).maybeSingle() : { data: null };
  const driver: string = (truck as { driver_id?: string } | null)?.driver_id || c.id;
  if (okPt(b.pos) && driver === c.id) {
    await c.db.rpc('report_position', { p_lat: b.pos.lat, p_lng: b.pos.lng, p_accuracy: null, p_heading: null, p_speed: null, p_job: j.id });
  }
  const { data: live } = await db.from('positions').select('lat, lng, at').eq('id', driver).is('deleted_at', null).maybeSingle();
  const from: Pt | null = okPt(b.pos) ? b.pos : (live && Date.parse((live as any).at) > Date.now() - 15 * 60000 ? { lat: (live as any).lat, lng: (live as any).lng } : null);
  const { data: cust } = await db.from('customers').select('*').eq('id', j.customer_id).maybeSingle();
  const cu = (cust || {}) as Record<string, any>;
  const dest: Pt | null = okPt({ lat: j.lat ?? cu.lat, lng: j.lng ?? cu.lng }) ? { lat: j.lat ?? cu.lat, lng: j.lng ?? cu.lng } : null;
  const rt = from && dest ? await route(from, dest) : null;
  const eta = rt ? new Date(Date.now() + rt.minutes * 60000) : null;

  // one active trip per job; a new token each start (the old link stops working)
  const { data: existing } = await db.from('trips').select('*').eq('job_id', j.id).eq('status', 'active').maybeSingle();
  const lang: Lang = cu.lang === 'en' ? 'en' : 'fr';
  let token: string | null = null;
  let trip = existing as Record<string, any> | null;
  const patch = { staff_id: driver, eta_at: eta?.toISOString() ?? null, km: rt?.km ?? null, minutes: rt?.minutes ?? null, route: rt?.line ?? null,
    dest_lat: dest?.lat ?? null, dest_lng: dest?.lng ?? null, expires_at: new Date(Date.now() + 4 * 3600000).toISOString() };
  if (!trip || action === 'start' && b.resend) {
    token = newToken(18);
    if (trip) {
      const { data } = await db.from('trips').update({ ...patch, token_hash: await sha256hex(token) }).eq('id', trip.id).select('*').single();
      trip = data;
    } else {
      const { data, error } = await db.from('trips').insert({ job_id: j.id, ...patch, token_hash: await sha256hex(token), created_by: c.id }).select('*').single();
      if (error) throw error;
      trip = data;
    }
  } else if (rt) {
    const { data } = await db.from('trips').update(patch).eq('id', trip.id).select('*').single();
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
  const { data: rows } = await c.db.rpc('job_payload', { p_job: j.id });
  return json({ ok: true, sms: sms.status, error: sms.error, link, message, phone: cu.phone || null,
    eta_at: trip?.eta_at ?? null, minutes: trip?.minutes ?? null, km: trip?.km ?? null, route_source: rt?.source ?? null, rows });
});
