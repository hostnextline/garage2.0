/* The address of the customer's page: client.html#t=<token>[&l=en][&retour=paye], client.html#suivi=<token>[&l=en], or
   client.html#reserver[&l=en] (« Réserver en ligne », open to everyone).
   Also remembers, on this phone only, the last appointment link opened (with its day), so the tracking page of that
   same day can point back to it, and the garage's name and phone, so an error page can still say whom to call. */
import { isLang, type CLang } from './i18n';
import { localDayOf, montrealToday } from './format';

export interface Link { kind: 't' | 'suivi' | 'reserver' | null; token: string; l: CLang | null; retour: string | null }

export function parseLink(hash: string | null | undefined): Link {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const t = p.get('t'), s = p.get('suivi');
  const kind = t != null ? 't' : s != null ? 'suivi' : p.has('reserver') ? 'reserver' : null;
  // texting apps sometimes glue a period or a bracket to the end of a link: tokens never contain those
  const token = String(t ?? s ?? '').trim().replace(/[^A-Za-z0-9_-]+$/, '');
  const l = p.get('l');
  return { kind, token, l: isLang(l) ? l : null, retour: p.get('retour') };
}

export function linkHash(kind: 't' | 'suivi', token: string, l?: CLang | null, extra: Record<string, string> = {}): string {
  const parts = [`${kind}=${token}`];
  if (l) parts.push(`l=${l}`);
  for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${encodeURIComponent(v)}`);
  return '#' + parts.join('&');
}

/** changes the address without a new step in the browser's history */
export function replaceHash(hash: string) {
  try { history.replaceState(history.state, '', location.pathname + location.search + hash); } catch { /* an old browser: the address stays */ }
}

/* ---------- the appointment link opened on this phone ---------- */
const APPOINTMENT = 'his.client.t';
const KEEP_MS = 45 * 24 * 3600 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{4,120}$/;
interface Remembered { token: string; at: number; day: string | null }

/** `day`: the appointment's day ('YYYY-MM-DD'), which ties the link to the trips of that day.
    Only an appointment still to come is worth keeping (a trip is always on its appointment's day): last month's invoice
    opened again neither replaces today's appointment (client-r6) nor stays on the phone (client-page-29); of two
    appointments to come, the nearer one is kept. */
export function rememberAppointment(token: string, day: string | null, now: number = Date.now()) {
  const today = montrealToday(new Date(now));
  if (day != null && day < today) return;
  const old = recalled(now);
  if (old && old.token !== token && old.day != null && old.day >= today && (day == null || day > old.day)) return;
  try { localStorage.setItem(APPOINTMENT, JSON.stringify({ token, at: now, day })); } catch { /* private mode: nothing kept */ }
}
function recalled(now: number): Remembered | null {
  try {
    const v = JSON.parse(localStorage.getItem(APPOINTMENT) || 'null') as Partial<Remembered> | null;
    if (!v) return null;
    const day = typeof v.day === 'string' ? v.day : null;
    // past its day (or its 45 days), the link is of no use here any more: it leaves the phone
    if (!v.token || !v.at || now - v.at > KEEP_MS || !TOKEN.test(v.token) || (day != null && day < montrealToday(new Date(now)))) {
      localStorage.removeItem(APPOINTMENT);
      return null;
    }
    return { token: v.token, at: v.at, day };
  } catch { return null; }
}
/** the link the server refused (revoked, expired, deleted file) is not offered again from the tracking page.
    `now` as the other functions here: read with the real clock, an entry of a pretended day (the tests') counted as
    past and left the phone at the first call, whatever link was named (link.test was red from 2026-11-18 on) */
export function forgetAppointment(token: string, now: number = Date.now()) {
  try { if (recalled(now)?.token === token) localStorage.removeItem(APPOINTMENT); } catch { /* nothing to forget */ }
}
/** the appointment behind a trip, when this phone knows it: the page was opened with the appointment's own link
    (public_track accepts it), or the appointment remembered is today's (a trip is always on its appointment's day).
    An older appointment (last month's invoice) is never offered: it is not the one the truck drives to. */
export function appointmentOfTrip(trackToken: string, now: number = Date.now()): string | null {
  const r = recalled(now);
  if (!r) return null;
  if (r.token === trackToken) return r.token;
  return r.day != null && r.day === localDayOf(now) ? r.token : null;
}

/* ---------- the garage, from the last good answer ---------- */
export interface KnownGarage { name: string | null; phone: string | null }
export function rememberGarage(g: { name?: string | null; phone?: string | null } | null | undefined) {
  if (!g || (!g.name && !g.phone)) return;
  try { localStorage.setItem('his.client.garage', JSON.stringify({ name: g.name || null, phone: g.phone || null })); } catch { /* private mode: nothing kept */ }
}
export function recallGarage(): KnownGarage | null {
  try {
    const v = JSON.parse(localStorage.getItem('his.client.garage') || 'null') as KnownGarage | null;
    return v && (v.name || v.phone) ? { name: v.name || null, phone: v.phone || null } : null;
  } catch { return null; }
}

/* ---------- a card payment on its way (this tab only, survives the round trip to Stripe) ---------- */
const PAYING = 'his.client.paying';
/** before leaving for Stripe: how much money the file had received, so the way back can tell that a payment came in
    even when a balance is still left (the total rose meanwhile, or the payment was a part) */
export function rememberPaying(token: string, receivedCents: number, now: number = Date.now()) {
  try { sessionStorage.setItem(PAYING, JSON.stringify({ token, received: receivedCents, at: now })); } catch { /* without it, balances decide */ }
}
/** what was received before this tab left for Stripe (null: unknown, e.g. Stripe opened in another browser) */
export function recallPaying(token: string, now: number = Date.now()): number | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(PAYING) || 'null') as { token?: string; received?: number; at?: number } | null;
    // Stripe's card page lives one hour: an older note belongs to another visit
    if (!v || v.token !== token || typeof v.received !== 'number' || !v.at || now - v.at > 2 * 3600 * 1000) return null;
    return v.received;
  } catch { return null; }
}
export function forgetPaying() {
  try { sessionStorage.removeItem(PAYING); } catch { /* nothing to forget */ }
}
