/* DEV ONLY — demo rows and pretend server functions for the job sheet and « Ma journée » (section jobs).
   - Saleh's day gets the texts it would have (confirmation, « en route ») and the trip to Marc-André.
   - enroute / notify answer like the real ones and leave the same traces (trip, text in the list, confirmation date).
     The « en route » text goes by itself only when the demo says texts are switched on (&texts=on); &texts=off also
     makes the other texts come back « to send by hand ».
   Small on purpose; nothing here can stop the demo (every part is guarded). */
import { registerFn, registerRpc, put, find, table, rows as answerRows, refuse, nowIso, type DemoRow } from '../fake-server';
import { can, customerVisible, hasRole, isStaff, jobIdVisible, myTruckIds, need } from '../demo-rules';
import { addDays, today, longDay, clock } from '../../lib/dates';

const D = (n: number) => addDays(today(), n);
const at = (day: string, min: number) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, Math.floor(min / 60), min % 60).toISOString(); };
const me = () => (globalThis as { __demoUser?: string }).__demoUser || 'u-hassan';
const LINK = 'https://mecanique-mobile-his.vercel.app/client.html';
const textsParam = (): 'on' | 'off' | null => { try { return (/[?&]texts=(on|off)\b/.exec(location.search)?.[1] as 'on' | 'off') || null; } catch { return null; } };
const textsOff = () => textsParam() === 'off';
/** automatic texts as the app is told (Access.texts_online, set by the demo): the « en route » text follows it */
const textsOnline = () => !!(globalThis as { __demoServices?: { texts?: boolean } }).__demoServices?.texts;

function rows() {
  if (find('jobs', 'j-2')) put('jobs', { id: 'j-2', confirm_sent_at: at(D(-2), 640), notes: 'Clé du F-150 sous le tapis, côté conducteur.' });
  if (find('jobs', 'j-4')) put('jobs', { id: 'j-4', confirm_sent_at: at(D(-1), 610), unit: '2' });
  const msg = (id: string, job_id: string, customer_id: string, kind: string, to: string, body: string, created: string, staff = 'u-office') =>
    put('messages', { id, job_id, customer_id, staff_id: staff, kind, channel: 'sms', to_addr: to, body, status: 'sent', error: null, created_at: created });
  msg('m-d-j1', 'j-1', 'c-julie', 'en_route', '+15145550141', `Bonjour Julie, Saleh de Mécanique Mobile H.I.S est en route : arrivée vers 8 h 18. Suivez le camion : ${LINK}#suivi=demo1`, at(D(0), 478), 'u-saleh');
  msg('m-d-j2a', 'j-2', 'c-marc', 'booking', '+14385550177', `Bonjour Marc-André, votre rendez-vous avec Mécanique Mobile H.I.S est confirmé : ${longDay(D(0), 'fr')}, entre 8 h et 12 h. Détails : ${LINK}#t=demo-marc`, at(D(-2), 640));
  msg('m-d-j2b', 'j-2', 'c-marc', 'en_route', '+14385550177', `Bonjour Marc-André, Saleh de Mécanique Mobile H.I.S est en route : arrivée vers 9 h 43. Suivez le camion : ${LINK}#suivi=demo2`, at(D(0), 561), 'u-saleh');
  msg('m-d-j4', 'j-4', 'c-kevin', 'booking', '+15145550164', `Hello Kevin, your appointment with Mécanique Mobile H.I.S is confirmed: ${longDay(D(0), 'en')}, between 12 p.m. and 4 p.m. Details: ${LINK}#t=demo-kevin&l=en`, at(D(-1), 610));
  put('trips', { id: 'tr-d-j2', job_id: 'j-2', staff_id: 'u-saleh', status: 'arrived', started_at: at(D(0), 560), ended_at: at(D(0), 584), eta_at: at(D(0), 583), km: 7.4, minutes: 22, route: null,
    dest_lat: 45.5022, dest_lng: -73.7094, sms_status: 'sent', expires_at: at(D(0), 800) });
}

function first(c: DemoRow | undefined) { return String(c?.first_name || c?.company || '').trim().split(/\s+/)[0] || ''; }
function textRow(j: DemoRow, kind: string, body: string, status: string) {
  const c = find('customers', j.customer_id);
  put('messages', { job_id: j.id, customer_id: j.customer_id, staff_id: me(), kind, channel: 'sms', to_addr: String(c?.phone || ''), body, status: status === 'sent' ? 'sent' : 'skipped', error: status === 'sent' ? null : status });
}

/** the trip back to the truck's start (or « Départ des camions »), like supabase/functions/enroute returnTrip */
function returnTrip(b: Record<string, unknown>) {
  const mine = () => table('trips').filter((t) => t.staff_id === me() && t.kind === 'return' && t.status === 'active');
  if (b.action === 'return_end') return { ok: true, rows: answerRows({ trips: mine().map((t) => put('trips', { id: t.id, status: 'arrived', ended_at: nowIso() })) }) };
  const bk = (find('settings', '1')?.booking || {}) as { home?: { label?: string; lat?: number; lng?: number }; return_phone?: string };
  const truck = myTruckIds().map((id) => find('trucks', id)).find((t) => t?.driver_id === me()) || find('trucks', myTruckIds()[0]);
  const start = (truck?.start as { label?: string; lat?: number; lng?: number } | null) || null;
  const home = start?.lat != null ? start : bk.home;
  if (home?.lat == null || home.lng == null) return { ok: false, code: 'no_home', error: 'Le départ des camions n’a pas de position : choisis son adresse dans Réglages → Réservations.' };
  const label = String(home.label || bk.home?.label || 'Centrale');
  for (const t of mine()) put('trips', { id: t.id, status: 'cancelled', ended_at: nowIso() });
  const minutes = 18, eta = new Date(Date.now() + minutes * 60_000);
  const phone = String(bk.return_phone || '').trim() || null;
  const sms = !phone ? 'no_phone' : b.notify === false ? 'quiet' : textsOnline() ? 'sent' : 'off';
  const trip = put('trips', { job_id: null, kind: 'return', dest_label: label, staff_id: me(), status: 'active', started_at: nowIso(), ended_at: null, eta_at: eta.toISOString(),
    km: 7.5, minutes, route: null, dest_lat: home.lat, dest_lng: home.lng, sms_status: sms, expires_at: new Date(Date.now() + 4 * 3600_000).toISOString() });
  const mech = String(find('staff', me())?.short_name || 'Le mécano');
  const link = `${LINK}#suivi=demo-retour`;
  const message = `${mech} a fini sa journée et revient vers ${label}. Suivre le camion en direct : ${link}`;
  return { ok: true, sms, link, message, phone, place: label, eta_at: trip.eta_at, minutes, km: 7.5, rows: answerRows({ trips: trip }) };
}

function fns() {
  registerFn('enroute', (b) => {
    // « Je pars vers la Centrale » / « Je suis arrivé » after the last job: a trip with no job (demo-16: it answered
    // « Cette job n’existe plus »)
    if (b.action === 'return' || b.action === 'return_end') return returnTrip(b);
    const j = find('jobs', b.job_id);
    if (!j) return { ok: false, code: 'not_found', error: 'Cette job n’existe plus (ou tu n’y as pas accès).' };
    const action = String(b.action || 'start');
    const active = table('trips').find((x) => x.job_id === j.id && x.status === 'active');
    if (action === 'end') { if (active) put('trips', { id: active.id, status: 'cancelled', ended_at: nowIso() }); return { ok: true }; }
    // like the real one: « Je pars » goes through the same rule
    if (j.status === 'booked') put('jobs', { id: j.id, status: 'en_route', started_at: nowIso() });
    else if (j.status !== 'en_route') return { ok: false, code: 'not_en_route', error: 'Cette job n’est pas en route.' };
    const minutes = 14, eta = new Date(Date.now() + minutes * 60_000);
    const truck = find('trucks', j.truck_id);
    const trip = put('trips', { ...(active ? { id: active.id } : {}), job_id: j.id, staff_id: truck?.driver_id || me(), status: 'active', started_at: active?.started_at || nowIso(), ended_at: null,
      eta_at: eta.toISOString(), km: 6.2, minutes, route: null, dest_lat: j.lat ?? find('customers', j.customer_id)?.lat ?? null, dest_lng: j.lng ?? find('customers', j.customer_id)?.lng ?? null,
      sms_status: textsOnline() ? 'sent' : 'off', expires_at: new Date(Date.now() + 4 * 3600_000).toISOString() });
    if (active && !b.resend) return { ok: true, sms: 'already', link: null, message: null, phone: null, eta_at: trip.eta_at, minutes, km: 6.2 };
    const c = find('customers', j.customer_id);
    const mech = String(find('staff', truck?.driver_id)?.short_name || 'Votre mécano');
    const time = `${eta.getHours()} h ${String(eta.getMinutes()).padStart(2, '0')}`;
    const link = `${LINK}#suivi=demo-${String(j.id)}`;
    const message = c?.lang === 'en'
      ? `Hello ${first(c)}, ${mech} from Mécanique Mobile H.I.S is on the way: arriving around ${time}. Follow the truck: ${link}&l=en`
      : `Bonjour ${first(c)}, ${mech} de Mécanique Mobile H.I.S est en route : arrivée vers ${time}. Suivez le camion : ${link}`;
    const sms = !textsOnline() ? 'off' : b.notify === false ? 'quiet' : 'sent';
    textRow(j, 'en_route', message, sms);
    return { ok: true, sms, link, message, phone: c?.phone ?? null, eta_at: trip.eta_at, minutes, km: 6.2 };
  });
  registerFn('notify', (b) => {
    const j = find('jobs', b.job_id);
    if (!j) return { ok: false, code: 'not_found', error: 'Cette job n’existe plus (ou tu n’y as pas accès).' };
    const kind = String(b.kind || '');
    if (kind === 'booking' && j.confirm_sent_at && !b.resend) return { ok: true, status: 'already' };
    if (['booking', 'moved', 'reminder', 'window'].includes(kind) && j.status !== 'booked') return { ok: false, code: 'not_booked', error: 'Ce rendez-vous n’est plus à venir.' };
    if (kind === 'arrived' && j.status !== 'on_site') return { ok: false, code: 'not_on_site', error: 'Le mécano n’est pas encore arrivé chez ce client.' };
    const c = find('customers', j.customer_id);
    const link = `${LINK}#t=demo-${String(j.id)}${c?.lang === 'en' ? '&l=en' : ''}`;
    const words: Record<string, string> = {
      booking: `votre rendez-vous avec Mécanique Mobile H.I.S est confirmé. Pour voir et signer votre estimation : ${link}`,
      arrived: `votre mécano de Mécanique Mobile H.I.S est arrivé. Votre facture, à payer pendant les travaux : ${link}`,
      moved: `votre rendez-vous avec Mécanique Mobile H.I.S a été déplacé. Détails : ${link}`,
      extras: `votre mécano propose un travail sur votre véhicule. Acceptez ou refusez ici : ${link}`,
      invoice: `voici votre facture de Mécanique Mobile H.I.S. Pour payer : ${link}`,
      payment_reminder: `petit rappel : votre facture de Mécanique Mobile H.I.S est à payer. ${link}`,
      // « Plages d'arrivée »: the window of a flexible appointment, once fixed
      window: `votre plage d’arrivée est confirmée : Mécanique Mobile H.I.S vient ${longDay(String(j.day), 'fr')}${j.win_start != null && j.win_end != null ? `, entre ${clock(Number(j.win_start))} et ${clock(Number(j.win_end))}` : ''}. Détails : ${link}`
    };
    const message = `Bonjour ${first(c)}, ${words[kind] || link}`;
    const status = textsOff() ? 'off' : c?.phone ? 'sent' : 'no_phone';
    textRow(j, kind, message, status);
    if (status === 'sent' && (kind === 'booking' || kind === 'moved')) put('jobs', { id: j.id, confirm_sent_at: nowIso() });
    if (status === 'sent' && kind === 'invoice') for (const v of table('invoices').filter((x) => x.job_id === j.id && x.status !== 'void')) put('invoices', { id: v.id, sent_at: nowIso() });
    return { ok: status === 'sent', status, message, link, phone: c?.phone ?? null };
  });
}

/* « Changer de client » (Part 24 nonies): the appointment goes to the right customer, with the database's rules */
function jobCustomer() {
  registerRpc('job_customer', (a) => {
    need(isStaff(), 'Connecte-toi avec ton compte de l’équipe.');
    const j = find('jobs', a.p_job);
    if (!j || j.deleted_at || !jobIdVisible(j.id)) refuse('not_found', 'Ce rendez-vous n’existe plus (ou tu n’y as pas accès).');
    need(can('book') || (hasRole('mechanic') && j.truck_id != null && myTruckIds().includes(String(j.truck_id))), 'Tu ne peux pas changer ce rendez-vous. Parle au propriétaire.');
    if (j.status !== 'booked') refuse('started', 'Le client ne change plus une fois le camion parti : annule et réserve pour le bon client.');
    if (table('invoices').some((v) => v.job_id === j.id && !v.deleted_at && !['draft', 'void'].includes(String(v.status)))) refuse('invoice_done', 'La facture est déjà terminée : annule-la d’abord.');
    const c = find('customers', a.p_customer);
    if (!c || c.deleted_at || !customerVisible(c.id)) refuse('no_customer', 'Choisis le client.');
    if (c.id === j.customer_id) refuse('same', 'C’est déjà le client de ce rendez-vous.');
    const cars = table('vehicles').filter((v) => v.customer_id === c.id && !v.deleted_at);
    let car = (a.p_vehicle as string | null) || null;
    if (car && !cars.some((v) => v.id === car)) refuse('bad_vehicle', 'Ce véhicule n’est pas à ce client.');
    if (!car && cars.length === 1) car = cars[0].id;
    const job = put('jobs', { id: j.id, customer_id: c.id, vehicle_id: car, address: c.address ?? null, unit: c.unit ?? null, postal_code: c.postal_code ?? null, lat: c.lat ?? null, lng: c.lng ?? null,
      confirm_sent_at: null, waiver_signed_at: null, waiver_signer: null, waiver_version: null, waiver_attachment: null,
      estimate_signed_at: null, estimate_signer: null, estimate_attachment: null, estimate_cents: null });
    const invs = table('invoices').filter((v) => v.job_id === j.id);
    for (const v of invs) if (v.status === 'draft' && !v.deleted_at) put('invoices', { id: v.id, customer_id: c.id });
    return { ok: true, vehicle_id: car, rows: answerRows({ jobs: job, invoices: invs }) };
  });
}

export function load() {
  try { jobCustomer(); } catch { /* the demo goes on without it */ }
  // &texts=on / &texts=off: the demo says the automatic texts are (not) switched on (Access.texts_online)
  try {
    const p = textsParam();
    const g = globalThis as { __demoServices?: { card?: boolean; texts?: boolean } };
    if (p) g.__demoServices = { ...(g.__demoServices || {}), texts: p === 'on' };
  } catch { /* the default stays */ }
  try { rows(); } catch { /* the demo goes on without them */ }
  try { fns(); } catch { /* the core's pretend functions stay */ }
}
