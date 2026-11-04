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

export const handler = serve(async (req) => {
  const b = await body(req);
  const action = String(b.action || 'start');
  const c = await caller(req);
  const db = adminDb();
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
