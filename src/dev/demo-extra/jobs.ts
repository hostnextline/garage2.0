/* DEV ONLY — demo rows and pretend server functions for the job sheet and « Ma journée » (section jobs).
   - Saleh's day gets the texts it would have (confirmation, « en route ») and the trip to Marc-André.
   - enroute / notify answer like the real ones and leave the same traces (trip, text in the list, confirmation date).
     The « en route » text goes by itself only when the demo says texts are switched on (&texts=on); &texts=off also
     makes the other texts come back « to send by hand ».
   Small on purpose; nothing here can stop the demo (every part is guarded). */
import { registerFn, put, find, table, nowIso, type DemoRow } from '../fake-server';
import { addDays, today, longDay } from '../../lib/dates';

const D = (n: number) => addDays(today(), n);
const at = (day: string, min: number) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, Math.floor(min / 60), min % 60).toISOString(); };
const me = () => (globalThis as { __demoUser?: string }).__demoUser || 'u-hassan';
const LINK = 'https://hostnextline.github.io/garage2.0/client.html';
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

function fns() {
  registerFn('enroute', (b) => {
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
    if (['booking', 'moved', 'reminder'].includes(kind) && j.status !== 'booked') return { ok: false, code: 'not_booked', error: 'Ce rendez-vous n’est plus à venir.' };
    const c = find('customers', j.customer_id);
    const link = `${LINK}#t=demo-${String(j.id)}${c?.lang === 'en' ? '&l=en' : ''}`;
    const words: Record<string, string> = {
      booking: `votre rendez-vous avec Mécanique Mobile H.I.S est confirmé. Détails : ${link}`,
      moved: `votre rendez-vous avec Mécanique Mobile H.I.S a été déplacé. Détails : ${link}`,
      extras: `votre mécano propose un travail sur votre véhicule. Acceptez ou refusez ici : ${link}`,
      invoice: `voici votre facture de Mécanique Mobile H.I.S. Pour payer : ${link}`,
      payment_reminder: `petit rappel : votre facture de Mécanique Mobile H.I.S est à payer. ${link}`
    };
    const message = `Bonjour ${first(c)}, ${words[kind] || link}`;
    const status = textsOff() ? 'off' : c?.phone ? 'sent' : 'no_phone';
    textRow(j, kind, message, status);
    if (status === 'sent' && (kind === 'booking' || kind === 'moved')) put('jobs', { id: j.id, confirm_sent_at: nowIso() });
    if (status === 'sent' && kind === 'invoice') for (const v of table('invoices').filter((x) => x.job_id === j.id && x.status !== 'void')) put('invoices', { id: v.id, sent_at: nowIso() });
    return { ok: status === 'sent', status, message, link, phone: c?.phone ?? null };
  });
}

export function load() {
  // &texts=on / &texts=off: the demo says the automatic texts are (not) switched on (Access.texts_online)
  try {
    const p = textsParam();
    const g = globalThis as { __demoServices?: { card?: boolean; texts?: boolean } };
    if (p) g.__demoServices = { ...(g.__demoServices || {}), texts: p === 'on' };
  } catch { /* the default stays */ }
  try { rows(); } catch { /* the demo goes on without them */ }
  try { fns(); } catch { /* the core's pretend functions stay */ }
}
