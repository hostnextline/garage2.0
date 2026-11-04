/* DEV ONLY — the customer page's demo. Imported only when import.meta.env.DEV and the address has ?demo, so it is never
   part of the real page. It answers the « client » function and public_track from memory (kept for the tab in
   sessionStorage, so the pretend Stripe round trip survives the reload), and adds a list of links at the bottom:
     client.html?demo#t=demo            booked: the estimate to sign, « Payer maintenant »   (= demo-booked)
     client.html?demo#t=demo-onsite     the mechanic arrived: the invoice to pay during the work
     client.html?demo#t=demo-extras     the mechanic on site proposes extra work to accept or refuse
     client.html?demo#t=demo-route      the mechanic is on the way (with the tracking link)
     client.html?demo#t=demo-unpaid     an invoice to pay (« Payer par carte » comes back with &retour=paye)
     client.html?demo#t=demo-paid       a paid invoice (PAYÉ)
     client.html?demo#t=demo-quote      an estimate        demo-cancelled, demo-expired, demo-gone, demo-bad, demo-offline: the other cases
     client.html?demo#suivi=demo        the truck on the way (moves at each refresh)  demo-nopos, demo-arrived, demo-cancelled, demo-expired, demo-bad */
import { SUPABASE_URL } from '../lib/config';
import { totals } from '../lib/money';
import { addDays, today, longDay } from '../lib/dates';

const GARAGE = {
  name: 'Mécanique Mobile H.I.S', phone: '438 901-6606', email: 'host.nextline@gmail.com', address: '8255 av. Mountain Sights, Montréal, QC H4P 2B5',
  tps_no: '775958648 RT0001', tvq_no: '1234321141 TQ0001', footer_fr: 'Merci de votre confiance !', footer_en: 'Thank you for your trust!'
};
interface Item { id: string; description: string; qty: number; unit_cents: number; status: string; note?: string | null }
interface DemoJob {
  lang: 'fr' | 'en'; first: string; day: string; block: 'am' | 'pm' | 'eve'; status: string; tracking: boolean; vehicle: string; number: number;
  items: Item[]; extras: Item[]; invoiced: boolean; paid: number; prepaid: number; stripe: boolean; pending: boolean; checks?: number; paying?: boolean;
  /** the estimate signed online (name, moment, the total signed) */
  signed?: { name: string; at: string; cents: number } | null;
  /** the invoice being made (from the mechanic's arrival) */
  draft?: boolean;
}
const BLOCKS = { am: [480, 720], pm: [720, 960], eve: [960, 1200] } as const;
const D = (n: number) => addDays(today(), n);

function fresh(): Record<string, DemoJob> {
  const oil: Item = { id: 'i-oil', description: 'Changement d’huile et filtre', qty: 1, unit_cents: 8999, status: 'planned' };
  const top: Item = { id: 'i-top', description: 'Top up des liquides', qty: 1, unit_cents: 6000, status: 'planned' };
  return {
    'demo-booked': { lang: 'fr', first: 'Sophie', day: D(1), block: 'pm', status: 'booked', tracking: false, vehicle: '2021 Toyota RAV4', number: 118,
      items: [oil, top], extras: [], invoiced: false, paid: 0, prepaid: 0, stripe: true, pending: false },
    'demo-extras': { lang: 'fr', first: 'Marc-André', day: D(0), block: 'am', status: 'on_site', tracking: false, vehicle: '2017 Ford F-150', number: 104,
      items: [{ id: 'i-fr', description: 'Freins avant (plaquettes et disques)', qty: 1, unit_cents: 34999, status: 'planned' }],
      extras: [
        { id: 'x-1', description: 'Étriers avant collés : nettoyage et graissage', qty: 1, unit_cents: 8000, status: 'proposed', note: 'Les deux étriers forcent. Sans ça, les plaquettes neuves s’useront vite.' },
        { id: 'x-2', description: 'Liquide de frein à changer', qty: 1, unit_cents: 8999, status: 'proposed', note: 'Le liquide est foncé et contient de l’eau (test à 3 %).' }
      ], invoiced: false, paid: 0, prepaid: 0, stripe: false, pending: false },
    'demo-route': { lang: 'fr', first: 'Amira', day: D(0), block: 'am', status: 'en_route', tracking: true, vehicle: '2020 Hyundai Elantra', number: 109,
      items: [{ id: 'i-bat', description: 'Remplacement de batterie', qty: 1, unit_cents: 4999, status: 'planned' }, { id: 'i-bat2', description: 'Batterie Groupe 47 (fournie)', qty: 1, unit_cents: 18999, status: 'planned' }],
      extras: [], invoiced: false, paid: 0, prepaid: 0, stripe: false, pending: false },
    'demo-unpaid': { lang: 'fr', first: 'Julie', day: D(0), block: 'am', status: 'done', tracking: false, vehicle: '2019 Honda Civic', number: 102,
      items: [{ ...oil, status: 'done' }, { ...top, status: 'done' }, { id: 'i-wip', description: 'Balais d’essuie-glace', qty: 2, unit_cents: 2499, status: 'done' }],
      extras: [], invoiced: true, paid: 0, prepaid: 0, stripe: true, pending: false },
    'demo-paid': { lang: 'fr', first: 'Patrick', day: D(-1), block: 'am', status: 'done', tracking: false, vehicle: '2014 Chevrolet Silverado', number: 98,
      items: [{ id: 'i-fr2', description: 'Freins avant (plaquettes et disques)', qty: 1, unit_cents: 34999, status: 'done' }],
      extras: [{ id: 'x-3', description: 'Nettoyage des étriers', qty: 1, unit_cents: 4000, status: 'declined', note: null }], invoiced: true, paid: -1, prepaid: 0, stripe: true, pending: false },
    'demo-onsite': { lang: 'fr', first: 'Karim', day: D(0), block: 'pm', status: 'on_site', tracking: false, vehicle: '2015 Volkswagen Jetta', number: 1001,
      items: [{ id: 'i-promo', description: 'Promo : pneus non montés + huile + inspection', qty: 1, unit_cents: 19999, status: 'planned' }],
      extras: [], invoiced: false, paid: 0, prepaid: 0, stripe: true, pending: false, draft: true, signed: { name: 'Karim Haddad', at: new Date(Date.now() - 86400000).toISOString(), cents: 22994 } },
    'demo-cancelled': { lang: 'fr', first: 'Émilie', day: D(2), block: 'eve', status: 'cancelled', tracking: false, vehicle: '2018 Kia Soul', number: 121,
      items: [oil], extras: [], invoiced: false, paid: 0, prepaid: 0, stripe: true, pending: false }
  };
}

const KEY = 'demo.client.v2';
let state: Record<string, DemoJob> = fresh();
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } }
function restore() { try { const s = sessionStorage.getItem(KEY); if (s) state = { ...fresh(), ...JSON.parse(s) }; } catch { state = fresh(); } }

const sum = (items: Item[]) => {
  const t = totals(items.map((i) => ({ qty: i.qty, unitCents: i.unit_cents })));
  return { subtotal: t.subtotal, tps: t.tps, tvq: t.tvq, total: t.total };
};
function jobView(j: DemoJob) {
  const planned = [...j.items, ...j.extras.filter((x) => x.status === 'approved')];
  const expected = sum(planned);
  const invTotal = expected.total;
  const paid = j.paid < 0 ? invTotal : j.paid;
  const invoice = j.invoiced ? {
    number: `F-${String(j.number - 59).padStart(4, '0')}`, issued_at: new Date(Date.now() - 40 * 60000).toISOString(), due_on: null, status: paid >= invTotal ? 'paid' : 'issued',
    lines: planned.map((i) => ({ description: i.description, qty: i.qty, unit_cents: i.unit_cents, taxable: true })),
    subtotal_cents: expected.subtotal, tps_cents: expected.tps, tvq_cents: expected.tvq, total_cents: invTotal, paid_cents: paid, notes: null
  } : null;
  const balance = invoice ? Math.max(0, invoice.total_cents - invoice.paid_cents) : Math.max(0, expected.total - j.prepaid);
  const [start, end] = BLOCKS[j.block];
  return {
    ok: true, kind: 'job', garage: GARAGE, lang: j.lang, customer: { first: j.first },
    job: { number: j.number, day: j.day, day_label_fr: longDay(j.day, 'fr'), day_label_en: longDay(j.day, 'en'), block: j.block, start, end, status: j.status,
      tracking: j.tracking, vehicle: j.vehicle, waiver_signed: j.status !== 'booked' },
    items: planned.map((i) => ({ id: i.id, description: i.description, qty: i.qty, unit_cents: i.unit_cents, status: i.status })),
    extras: j.extras.map((x) => ({ id: x.id, description: x.description, qty: x.qty, unit_cents: x.unit_cents, total_cents: Math.round(x.qty * x.unit_cents), status: x.status, note: x.note ?? null, answered_via: x.status === 'proposed' ? null : 'link' })),
    expected, prepaid_cents: j.prepaid, invoice,
    estimate: { signed_at: j.signed?.at ?? null, signer: j.signed?.name ?? null, cents: j.signed?.cents ?? null, changed: !!j.signed && j.signed.cents !== expected.total,
      can_sign: ['booked', 'en_route', 'on_site'].includes(j.status) && !invoice && expected.total > 0 && (!j.signed || j.signed.cents !== expected.total) },
    conditions: CONDITIONS,
    bill: j.draft && !invoice ? { lines: planned.map((i) => ({ description: i.description, qty: i.qty, unit_cents: i.unit_cents, taxable: true })),
      subtotal_cents: expected.subtotal, tps_cents: expected.tps, tvq_cents: expected.tvq, total_cents: expected.total } : null,
    pay: { available: j.stripe && balance >= 50 && (invoice ? !['cancelled', 'no_show'].includes(j.status) : ['booked', 'en_route', 'on_site'].includes(j.status)), amount_cents: balance, kind: invoice ? 'invoice' : 'prepay', pending: j.pending }
  };
}
const CONDITIONS = 'J’autorise Mécanique Mobile H.I.S à faire les travaux convenus sur mon véhicule, à l’endroit que j’ai indiqué. Je confirme être le propriétaire du véhicule ou avoir son autorisation.\nJe comprends que :\n• les travaux se font sur place (entrée, stationnement ou rue) et je m’assure que l’endroit le permet;\n• si d’autres réparations sont nécessaires, elles ne seront faites qu’avec mon accord.';
function quoteView() {
  const items = [{ description: 'Pose de pneus d’hiver (4)', qty: 1, unit_cents: 9999 }, { description: 'Balancement des roues', qty: 4, unit_cents: 1500 }, { description: 'Entreposage des pneus d’été (une saison)', qty: 1, unit_cents: 7500 }];
  const t = totals(items.map((i) => ({ qty: i.qty, unitCents: i.unit_cents })));
  return { ok: true, kind: 'quote', garage: GARAGE, lang: 'fr', number: 8, vehicle: '2021 Toyota RAV4', items, totals: { subtotal: t.subtotal, tps: t.tps, tvq: t.tvq, total: t.total }, valid_until: D(14) };
}

type Answer = { status: number; body: unknown };
const refuse = (status: number, code: string, error: string): Answer => ({ status, body: { ok: false, code, error } });
function clientAnswer(b: Record<string, unknown>): Answer {
  const token = String(b.token || '');
  const action = String(b.action || 'view');
  const key = token === 'demo' ? 'demo-booked' : token;
  if (key === 'demo-quote') return { status: 200, body: quoteView() };
  if (key === 'demo-expired') return refuse(410, 'expired', 'Ce lien a expiré. Demandez-en un nouveau au garage.');
  if (key === 'demo-gone') return refuse(404, 'gone', 'Ce dossier n’existe plus.');
  const j = state[key];
  if (!j) return refuse(404, 'bad_link', 'Ce lien n’est plus valide. Demandez-en un nouveau au garage.');
  if (action === 'answer') {
    if (b.confirm !== true) return refuse(400, 'confirm', 'Confirmez votre réponse.');
    const x = j.extras.find((e) => e.id === b.item_id);
    if (!x) return refuse(404, 'gone', 'Cette proposition n’existe plus.');
    if (x.status === 'proposed') x.status = b.accept ? 'approved' : 'declined';
    save();
  }
  if (action === 'sign') {
    if (b.confirm !== true) return refuse(400, 'confirm', 'Cochez « J’accepte » pour signer.');
    const v = jobView(j);
    if (!v.estimate.can_sign) return refuse(400, 'signed', 'Cette estimation est déjà signée.');
    j.signed = { name: String(b.signer || ''), at: new Date().toISOString(), cents: v.expected.total };
    save();
  }
  if (action === 'pay') {
    const v = jobView(j);
    if (!v.pay.available) return refuse(400, 'nothing', 'Rien à payer : merci !');
    j.paying = true; j.pending = true; j.checks = 0; save();
    // the pretend Stripe page: straight back, as Stripe's success page would do (a new address: the page reloads)
    return { status: 200, body: { ok: true, url: `${location.pathname}?demo&stripe=${Date.now()}#t=${token}${j.lang === 'en' ? '&l=en' : ''}&retour=paye` } };
  }
  if (action === 'check') {
    if (j.paying) {
      j.checks = (j.checks || 0) + 1;
      // the bank answers at the second check (the page shows « Paiement en vérification… » meanwhile)
      if (j.checks >= 2) { const v = jobView(j); if (j.invoiced) j.paid = -1; else j.prepaid += v.pay.amount_cents; j.paying = false; j.pending = false; }
      save();
    }
  }
  return { status: 200, body: jobView(j) };
}

/* ---------- the truck on the way ---------- */
const WAY: [number, number][] = [[45.5005, -73.6577], [45.5033, -73.6604], [45.5061, -73.6612], [45.5089, -73.6619], [45.5112, -73.6628], [45.5139, -73.6637],
  [45.5162, -73.6644], [45.5188, -73.6651], [45.5213, -73.6659], [45.5241, -73.6672], [45.5266, -73.6684], [45.5289, -73.6694], [45.5307, -73.6702]];
let step = 0;
function trackAnswer(token: string) {
  const now = new Date();
  const base = { garage: { name: GARAGE.name, phone: GARAGE.phone }, mechanic: 'Adam', customer: 'Amira', lang: 'fr', now: now.toISOString(), km: 6.2, minutes: 14 };
  const key = token === 'demo' ? 'demo-active' : token;
  if (key === 'demo-active' || key === 'demo-nopos') {
    const i = Math.min(step, WAY.length - 2);
    if (key === 'demo-active') step += 1;
    const left = Math.max(1, Math.round((WAY.length - 1 - i) * 1.2));
    return { ...base, status: 'active', dest: { lat: 45.5307, lng: -73.6702 }, route: WAY, eta_at: new Date(now.getTime() + left * 60000).toISOString(), ended_at: null,
      pos: key === 'demo-nopos' ? null : { lat: WAY[i][0], lng: WAY[i][1], at: new Date(now.getTime() - 20000).toISOString() } };
  }
  if (key === 'demo-arrived') return { ...base, status: 'arrived', dest: null, route: null, eta_at: null, ended_at: new Date(now.getTime() - 3 * 60000).toISOString(), pos: null };
  if (key === 'demo-cancelled') return { ...base, status: 'cancelled', dest: null, route: null, eta_at: null, ended_at: now.toISOString(), pos: null };
  if (key === 'demo-expired') return { ...base, status: 'expired', dest: null, route: null, eta_at: null, ended_at: null, pos: null };
  return { status: 'not_found' };
}

const LINKS: [string, string][] = [
  ['#t=demo-booked', 'Réservé'], ['#t=demo-onsite', 'Mécano arrivé (facture)'], ['#t=demo-extras', 'Travaux proposés'], ['#t=demo-route', 'En route'], ['#t=demo-unpaid', 'Facture à payer'],
  ['#t=demo-unpaid&l=en', 'Invoice (English)'], ['#t=demo-paid', 'Payée'], ['#t=demo-quote', 'Estimation'], ['#t=demo-cancelled', 'Annulé'],
  ['#t=demo-expired', 'Lien expiré'], ['#t=demo-bad', 'Mauvais lien'], ['#t=demo-offline', 'Sans réseau'],
  ['#suivi=demo', 'Suivi en route'], ['#suivi=demo-nopos', 'Suivi sans position'], ['#suivi=demo-arrived', 'Arrivé'], ['#suivi=demo-cancelled', 'Suivi terminé'],
  ['#suivi=demo-expired', 'Suivi expiré'], ['#suivi=demo-bad', 'Mauvais suivi']
];
function switcher() {
  const nav = document.createElement('nav');
  nav.className = 'cl-demo';
  nav.setAttribute('aria-label', 'Démo');
  nav.style.cssText = 'max-width:680px;margin:0 auto 40px;padding:16px;display:flex;flex-wrap:wrap;gap:8px;font-size:13px;border-top:1px dashed var(--line);color:var(--ink-2)';
  nav.innerHTML = `<b style="width:100%">Démo (développement seulement)</b>${LINKS.map(([h, label]) => `<a href="${location.pathname}?demo${h}" style="padding:6px 10px;border:1px solid var(--line);border-radius:999px;text-decoration:none">${label}</a>`).join('')}`;
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Recommencer la démo';
  reset.style.cssText = 'padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:transparent';
  reset.onclick = () => { try { sessionStorage.removeItem(KEY); localStorage.removeItem('his.client.suivi'); localStorage.removeItem('his.client.t'); } catch { /* ignore */ } location.reload(); };
  nav.appendChild(reset);
  document.body.appendChild(nav);
}

export function installClientDemo() {
  restore();
  // the « en route » appointment knows its tracking link, like a phone that opened the text
  try { if (!localStorage.getItem('his.client.suivi')) localStorage.setItem('his.client.suivi', JSON.stringify({ token: 'demo', at: Date.now() })); } catch { /* ignore */ }
  const real = window.fetch.bind(window);
  const origin = new URL(SUPABASE_URL).origin;
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== origin) return real(input as RequestInfo, init);
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(String(init.body || '{}')); } catch { body = {}; }
    // what the page asked, for the test scripts (dev only)
    ((window as unknown as { __demoCalls?: unknown[] }).__demoCalls ||= []).push({ path: url.pathname.replace(/^.*\/(functions|rest)\/v1\//, ''), body, at: Date.now() });
    await new Promise((r) => setTimeout(r, 350));
    if (body.token === 'demo-offline') throw new TypeError('Failed to fetch');
    const out = url.pathname.endsWith('/functions/v1/client') ? clientAnswer(body)
      : url.pathname.endsWith('/rest/v1/rpc/public_track') ? { status: 200, body: trackAnswer(String(body.p_token || '')) }
      : { status: 404, body: { message: 'demo: unknown address' } };
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json' } });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', switcher); else switcher();
}
