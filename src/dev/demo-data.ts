/* DEV ONLY — a believable day at Mécanique Mobile H.I.S for the demo (the people other than Hassan, Saleh and Adam,
   the customers, cars, prices and amounts are made up). Dates are relative to today. */
import { addDays, today } from '../lib/dates';
import { put, type DemoRow } from './fake-server';

const D = (n: number) => addDays(today(), n);
const at = (day: string, min: number) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, Math.floor(min / 60), min % 60).toISOString(); };

export const ME = { owner: 'u-hassan', saleh: 'u-saleh', adam: 'u-adam', office: 'u-office', treasurer: 'u-treso' };
export const TRUCK = { complet: 't-complet', voiture: 't-voiture', trois: 't-trois' };

export function loadDemoData() {
  /* ---------- settings ---------- */
  put('settings', {
    id: '1',
    company: { name: 'Mécanique Mobile H.I.S', legal_name: 'Mécanique Mobile H.I.S', phone: '438 901-6606', email: 'host.nextline@gmail.com', address: '8255 av. Mountain Sights, Montréal, QC H4P 2B5', tps_no: '775958648 RT0001', tvq_no: '1234321141 TQ0001', footer_fr: 'Merci de votre confiance !', footer_en: 'Thank you for your trust!' },
    taxes: { enabled: true, tps: 0.05, tvq: 0.09975 },
    booking: { blocks: [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }], horizon_days: 120, speed_kmh: 35, detour: 1.3, stop_min: 5, unknown_min: 20, min_block_min: 45, near_km: 5,
      home: { label: 'Centrale', address: '8255 av. Mountain Sights, Montréal, QC H4P 2B5', lat: 45.5005053, lng: -73.6577429 } },
    billing: { invoice_prefix: 'F-', pad: 4, due_days: 0, hourly_cents: 11500, travel: { cents: 0, free_over_cents: null }, goal_cents: 2500000 },
    messages: { on: { booking: true, moved: true, en_route: true, invoice: true, extras: true, reminder: false }, fr: { booking: 'Bonjour {prenom}, votre rendez-vous avec {garage} est confirmé : {jour}, entre {debut} et {fin}. Détails : {lien}' }, en: { booking: 'Hello {prenom}, your appointment with {garage} is confirmed: {jour}, between {debut} and {fin}. Details: {lien}' } },
    role_rights: { office: { treasury: false }, mechanic: { book: true, money: false, hours: true }, treasurer: { agenda: true, edit_invoices: true } },
    waiver: { version: '1', fr: 'J’autorise {garage} à faire les travaux convenus sur mon véhicule, à l’endroit que j’ai indiqué.\nLe garage n’est pas responsable des objets laissés dans le véhicule.\nD’autres réparations ne seront faites qu’avec mon accord.', en: 'I authorize {garage} to do the agreed work on my vehicle, at the place I indicated.\nThe garage is not responsible for items left in the vehicle.\nOther repairs will only be done with my consent.' },
    appearance: { theme: 'his', mode: 'auto' }, maps: {},
    expense_categories: ['Pièces', 'Huile et liquides', 'Carburant', 'Outils et équipement', 'Entretien des camions', 'Assurances', 'Publicité', 'Téléphone et internet', 'Frais bancaires', 'Repas', 'Autre']
  });

  /* ---------- team, trucks, hours ---------- */
  const staff = [
    { id: ME.owner, full_name: 'Hassan Ismail', short_name: 'Hassan', email: 'host.nextline@gmail.com', phone: '438 901-6606', roles: ['owner'], color: '#D3000E' },
    { id: ME.saleh, full_name: 'Saleh Ismail', short_name: 'Saleh', email: 'saleh@example.com', phone: '514 555-0101', roles: ['mechanic'], color: '#B86E00' },
    { id: ME.adam, full_name: 'Adam Ismail', short_name: 'Adam', email: 'adam@example.com', phone: '514 555-0102', roles: ['mechanic'], color: '#2F6FD0' },
    { id: ME.office, full_name: 'Nadia Bureau', short_name: 'Nadia', email: 'bureau@example.com', phone: '514 555-0103', roles: ['office'], color: '#7347D1' },
    { id: ME.treasurer, full_name: 'Louis Comptes', short_name: 'Louis', email: 'comptes@example.com', phone: null, roles: ['treasurer'], color: '#0F7C82' }
  ];
  for (const s of staff) put('staff', { ...s, rights: {}, active: true, lang: 'fr', prefs: {}, last_seen_at: new Date().toISOString() });
  put('trucks', { id: TRUCK.complet, name: 'Camion Complet', driver_id: ME.saleh, active: true, color: '#D3000E', plate: 'FHX 4821', sort: 1 });
  put('trucks', { id: TRUCK.voiture, name: 'Voiture', driver_id: ME.adam, active: true, color: '#2F6FD0', plate: 'GKR 1907', sort: 2 });
  put('trucks', { id: TRUCK.trois, name: 'Camion 3', driver_id: null, active: false, color: '#1F8A53', plate: null, sort: 3 });
  for (let dow = 1; dow <= 5; dow++) put('truck_week', { id: `w-c-${dow}`, truck_id: TRUCK.complet, dow, ranges: [[480, 1200]] });
  put('truck_week', { id: 'w-c-6', truck_id: TRUCK.complet, dow: 6, ranges: [[540, 1020]] });
  for (const dow of [3, 4]) put('truck_week', { id: `w-v-${dow}`, truck_id: TRUCK.voiture, dow, ranges: [[540, 1200]] });
  // today the Voiture always works (so the demo day has two trucks whatever the day)
  put('truck_days', { id: 'd-v-today', truck_id: TRUCK.voiture, day: D(0), ranges: [[540, 1200]], note: null });

  /* ---------- services, stock ---------- */
  const sv = (id: string, name_fr: string, name_en: string, category: string, price: number | null, duration: number, sort: number, extra: Partial<DemoRow> = {}) =>
    put('services', { id, name_fr, name_en, category, price_cents: price, duration_min: duration, taxable: true, is_promo: false, promo_until: null, includes: [], active: true, sort, ...extra });
  sv('s-huile', 'Changement d’huile et filtre', 'Oil and filter change', 'entretien', 8999, 45, 1, { includes: [{ fr: 'Jusqu’à 5 L d’huile synthétique', en: 'Up to 5 L of synthetic oil' }, { fr: 'Filtre à huile', en: 'Oil filter' }, { fr: 'Inspection visuelle', en: 'Visual inspection' }], needs: [{ kind: 'oil' }, { kind: 'oil_filter' }] });
  sv('s-freins-av', 'Freins avant (plaquettes et disques)', 'Front brakes (pads and rotors)', 'freins', 34999, 90, 2);
  sv('s-freins-ar', 'Freins arrière (plaquettes et disques)', 'Rear brakes (pads and rotors)', 'freins', 34999, 90, 3);
  sv('s-diag30', 'Diagnostic 30 min', 'Diagnostic 30 min', 'diagnostic', 6000, 30, 4);
  sv('s-diag60', 'Diagnostic 1 h', 'Diagnostic 1 h', 'diagnostic', 12000, 60, 5);
  sv('s-inspection', 'Inspection avant achat', 'Pre-purchase inspection', 'inspection', 10000, 60, 6);
  sv('s-topup', 'Top up des liquides', 'Fluid top-up', 'entretien', 6000, 20, 7);
  sv('s-batterie', 'Remplacement de batterie', 'Battery replacement', 'électrique', 4999, 30, 8);
  sv('s-pneus', 'Pose de pneus (4)', 'Tire mounting (4)', 'pneus', 9999, 60, 9);
  sv('s-refroid', 'Vidange du liquide de refroidissement', 'Coolant flush', 'entretien', 14999, 60, 10);
  sv('s-promo', 'Promo hiver : huile + pneus', 'Winter promo: oil + tires', 'promo', 16999, 90, 0, { is_promo: true, promo_until: D(25) });
  sv('s-pneus-neufs', 'Pneus neufs d’hiver (4, posés)', 'New winter tires (4, mounted)', 'pneus', 79999, 75, 11, { needs: [{ kind: 'tires', qty: 4, season: 'winter' }] });
  const inv = (id: string, name: string, category: string, unit: string, qty: number, min: number | null, cost: number, price: number) =>
    put('inventory_items', { id, name, sku: null, category, unit, qty, min_qty: min, cost_cents: cost, price_cents: price, supplier: 'Lordco', notes: null, active: true });
  inv('i-5w30', 'Huile synthétique 5W-30', 'Huile', 'L', 38, 20, 650, 1200);
  inv('i-0w20', 'Huile synthétique 0W-20', 'Huile', 'L', 12, 20, 690, 1250);
  inv('i-filtre', 'Filtre à huile PH7317', 'Filtres', 'unité', 6, 4, 790, 1599);
  inv('i-plaq', 'Plaquettes céramique avant', 'Freins', 'jeu', 2, 2, 4500, 8999);
  inv('i-lave', 'Lave-glace -40 °C', 'Liquides', 'L', 0, 8, 120, 400);
  inv('i-pneu-h', 'Pneu d’hiver 225/65R17', 'Pneus', 'pneu', 2, null, 14500, 21999);
  // the oil and its filter depend on the car (needs of s-huile); the washer fluid is always the same
  put('service_parts', { id: 'sp-1', service_id: 's-topup', item_id: 'i-lave', qty: 1 });

  /* ---------- customers and cars ---------- */
  const cu = (id: string, first: string, last: string, phone: string, address: string, postal: string, lat: number, lng: number, extra: Partial<DemoRow> = {}) =>
    put('customers', { id, first_name: first, last_name: last, company: null, phone, phone_digits: phone.replace(/\D/g, ''), email: null, lang: 'fr', address, unit: null, city: 'Montréal', postal_code: postal, lat, lng, notes: null, card_on_file: false, no_shows: 0, sms_ok: true, ...extra });
  cu('c-julie', 'Julie', 'Tremblay', '514 555-0141', '1250 rue Graham, Mont-Royal, QC', 'H3P 2C9', 45.5205, -73.6489, { email: 'julie.t@example.com' });
  cu('c-marc', 'Marc-André', 'Gagnon', '438 555-0177', '2150 boul. Thimens, Saint-Laurent, QC', 'H4R 2K3', 45.5022, -73.7094);
  cu('c-sophie', 'Sophie', 'Lavoie', '514 555-0119', '5600 av. Royalmount, Mont-Royal, QC', 'H4P 2T1', 45.4972, -73.6588, { notes: 'Stationnement derrière la bâtisse.' });
  cu('c-kevin', 'Kevin', 'Nguyen', '514 555-0164', '4800 ch. de la Côte-des-Neiges, Montréal, QC', 'H3V 1G8', 45.4955, -73.6152, { lang: 'en', email: 'kevin.n@example.com' });
  cu('c-amira', 'Amira', 'Haddad', '438 555-0133', '1400 rue Sauvé O, Montréal, QC', 'H4N 1C5', 45.5307, -73.6702, { card_on_file: true });
  cu('c-patrick', 'Patrick', 'Roy', '514 555-0188', '3900 boul. Décarie, Montréal, QC', 'H4A 3J5', 45.4772, -73.6213);
  cu('c-emilie', 'Émilie', 'Côté', '514 555-0125', '700 rue Lebeau, Saint-Laurent, QC', 'H4N 1R3', 45.5159, -73.6829, { no_shows: 1 });
  cu('c-flotte', '', '', '450 555-0150', '3000 boul. Industriel, Laval, QC', 'H7L 4P8', 45.5768, -73.7446, { company: 'Livraisons Express Laval', first_name: null, last_name: null, email: 'flotte@example.com' });
  put('customer_notes', { id: 'n-1', customer_id: 'c-julie', body: 'Plaquettes arrière à 4 mm : rappeler au printemps.', remind_on: D(120), done_at: null });
  const ve = (id: string, customer_id: string, year: number, make: string, model: string, extra: Partial<DemoRow> = {}) =>
    put('vehicles', { id, customer_id, year, make, model, trim: null, engine: null, displacement: null, cylinders: null, fuel: 'essence', drive: null, vin: null, plate: null, odometer_km: null, color: null, tire_size: null, spec_key: null, notes: null, ...extra });
  ve('v-julie', 'c-julie', 2019, 'Honda', 'Civic', { engine: '2.0 L 4 cyl.', odometer_km: 84200, vin: '2HGFC2F59KH512345', spec_key: 'honda|civic|2019|2.0' });
  ve('v-marc', 'c-marc', 2017, 'Ford', 'F-150', { engine: '3.5 L V6 EcoBoost', odometer_km: 142300 });
  ve('v-sophie', 'c-sophie', 2021, 'Toyota', 'RAV4', { engine: '2.5 L 4 cyl.', tire_size: '225/65R17' });
  ve('v-kevin', 'c-kevin', 2016, 'Mazda', 'CX-5', { engine: '2.5 L 4 cyl.', tire_size: '225/65R17' });
  ve('v-amira', 'c-amira', 2020, 'Hyundai', 'Elantra', {});
  ve('v-patrick', 'c-patrick', 2014, 'Chevrolet', 'Silverado', { engine: '5.3 L V8' });
  ve('v-emilie', 'c-emilie', 2018, 'Kia', 'Soul', {});
  ve('v-flotte1', 'c-flotte', 2022, 'Ford', 'Transit', { plate: 'FLT 001' });
  put('engine_specs', { id: 'es-1', key: 'honda|civic|2019|2.0', year: 2019, make: 'Honda', model: 'Civic', engine: '2.0 L 4 cyl.', data: { oil_l: 4.2, oil_visc: '0W-20', oil_filter: 'PH7317', drain_torque: '39 N·m', plugs: 'NGK ILZKR7B11', coolant: 'Honda Type 2', notes: 'Remettre le témoin d’entretien à zéro.' }, confirmed_by: ME.saleh, confirmed_at: new Date().toISOString() });

  /* ---------- jobs: yesterday, today, tomorrow ---------- */
  let num = 100;
  const job = (id: string, o: Partial<DemoRow> & { customer_id: string; day: string; block: string; status: string }) => {
    return put('jobs', {
      id, number: ++num, vehicle_id: null, truck_id: TRUCK.complet, truck_pinned: false, stop_order: 1, eta_min: null, travel_min: 15, duration_min: 60, problem: null, notes: null,
      address: null, unit: null, postal_code: null, lat: null, lng: null, card_on_file: false, lost_cents: null, lost_reason: null, started_at: null, arrived_at: null, finished_at: null,
      cancelled_at: null, pay_later: false, pay_later_reason: null, waiver_signed_at: null, waiver_signer: null, waiver_version: null, waiver_attachment: null, confirm_sent_at: null,
      source: 'phone', quote_id: null, created_by: ME.owner, ...o
    });
  };
  const item = (id: string, job_id: string, service_id: string | null, description: string, unit_cents: number, o: Partial<DemoRow> = {}) =>
    put('job_items', { id, job_id, kind: 'service', service_id, item_id: null, description, qty: 1, unit_cents, taxable: true, duration_min: null, status: 'planned', answered_at: null, answered_via: null, note: null, sort: 1, ...o });

  // yesterday
  job('j-y1', { customer_id: 'c-patrick', vehicle_id: 'v-patrick', day: D(-1), block: 'am', status: 'done', stop_order: 1, eta_min: 495, duration_min: 90, started_at: at(D(-1), 470), arrived_at: at(D(-1), 492), finished_at: at(D(-1), 590), waiver_signed_at: at(D(-1), 495), waiver_signer: 'Patrick Roy', waiver_version: '1' });
  item('ji-y1', 'j-y1', 's-freins-av', 'Freins avant (plaquettes et disques)', 34999, { status: 'done' });
  job('j-y2', { customer_id: 'c-flotte', vehicle_id: 'v-flotte1', day: D(-1), block: 'pm', status: 'done', stop_order: 1, eta_min: 750, duration_min: 45, started_at: at(D(-1), 725), arrived_at: at(D(-1), 748), finished_at: at(D(-1), 800), pay_later: true, pay_later_reason: 'Compte d’entreprise : paie à 30 jours.' });
  item('ji-y2', 'j-y2', 's-huile', 'Changement d’huile et filtre', 8999, { status: 'done' });
  job('j-y3', { customer_id: 'c-emilie', vehicle_id: 'v-emilie', day: D(-1), block: 'eve', status: 'no_show', stop_order: 1, eta_min: 990, lost_cents: 8999, lost_reason: 'Personne sur place, pas de réponse au téléphone.' });
  item('ji-y3', 'j-y3', 's-huile', 'Changement d’huile et filtre', 8999);

  // today, Camion Complet (Saleh)
  job('j-1', { customer_id: 'c-julie', vehicle_id: 'v-julie', day: D(0), block: 'am', status: 'done', stop_order: 1, eta_min: 500, duration_min: 45, started_at: at(D(0), 478), arrived_at: at(D(0), 498), finished_at: at(D(0), 548), waiver_signed_at: at(D(0), 500), waiver_signer: 'Julie Tremblay', waiver_version: '1', confirm_sent_at: at(D(-3), 600) });
  item('ji-1a', 'j-1', 's-huile', 'Changement d’huile et filtre', 8999, { status: 'done' });
  item('ji-1b', 'j-1', 's-topup', 'Top up des liquides', 6000, { status: 'done', sort: 2 });
  job('j-2', { customer_id: 'c-marc', vehicle_id: 'v-marc', day: D(0), block: 'am', status: 'on_site', stop_order: 2, eta_min: 590, duration_min: 90, travel_min: 22, problem: 'Bruit de frottement à l’avant en freinant.', started_at: at(D(0), 560), arrived_at: at(D(0), 584), waiver_signed_at: at(D(0), 590), waiver_signer: 'Marc-André Gagnon', waiver_version: '1' });
  item('ji-2a', 'j-2', 's-freins-av', 'Freins avant (plaquettes et disques)', 34999);
  item('ji-2b', 'j-2', null, 'Étriers avant collés : nettoyage et graissage', 8000, { status: 'proposed', kind: 'labour', duration_min: 30, sort: 2, note: 'Les deux étriers forcent. Sans ça, les plaquettes neuves s’useront vite.' });
  job('j-3', { customer_id: 'c-sophie', vehicle_id: 'v-sophie', day: D(0), block: 'pm', status: 'booked', stop_order: 1, eta_min: 735, duration_min: 45, travel_min: 12, confirm_sent_at: at(D(-1), 900) });
  item('ji-3', 'j-3', 's-huile', 'Changement d’huile et filtre', 8999);
  job('j-4', { customer_id: 'c-kevin', vehicle_id: 'v-kevin', day: D(0), block: 'pm', status: 'booked', stop_order: 2, eta_min: 815, duration_min: 60, travel_min: 18, problem: 'Check engine allumé depuis hier.' });
  item('ji-4', 'j-4', 's-diag60', 'Diagnostic 1 h', 12000);
  job('j-5', { customer_id: 'c-emilie', vehicle_id: 'v-emilie', day: D(0), block: 'eve', status: 'booked', stop_order: 1, eta_min: 980, duration_min: 45, travel_min: 14 });
  item('ji-5', 'j-5', 's-huile', 'Changement d’huile et filtre', 8999);
  // today, Voiture (Adam)
  job('j-6', { customer_id: 'c-amira', vehicle_id: 'v-amira', day: D(0), block: 'am', truck_id: TRUCK.voiture, status: 'en_route', stop_order: 1, eta_min: 640, duration_min: 30, travel_min: 16, card_on_file: true, started_at: at(D(0), 615) });
  item('ji-6', 'j-6', 's-batterie', 'Remplacement de batterie', 4999);
  item('ji-6b', 'j-6', null, 'Batterie Groupe 47 (fournie)', 18999, { kind: 'part', sort: 2 });
  job('j-7', { customer_id: 'c-patrick', vehicle_id: 'v-patrick', day: D(0), block: 'pm', truck_id: TRUCK.voiture, status: 'booked', stop_order: 1, eta_min: 760, duration_min: 60, travel_min: 20 });
  item('ji-7', 'j-7', 's-inspection', 'Inspection avant achat', 10000, { note: 'Auto à acheter : 2015 Nissan Rogue, au 4100 rue Jean-Talon.' });
  // tomorrow
  job('j-t1', { customer_id: 'c-flotte', vehicle_id: 'v-flotte1', day: D(1), block: 'am', status: 'booked', stop_order: 1, eta_min: 510, duration_min: 45, travel_min: 30 });
  item('ji-t1', 'j-t1', 's-huile', 'Changement d’huile et filtre', 8999);
  job('j-t2', { customer_id: 'c-kevin', vehicle_id: 'v-kevin', day: D(1), block: 'pm', status: 'booked', stop_order: 1, eta_min: 740, duration_min: 90, travel_min: 18 });
  item('ji-t2', 'j-t2', 's-freins-ar', 'Freins arrière (plaquettes et disques)', 34999);
  item('ji-t2b', 'j-t2', 's-pneus-neufs', 'Pneus neufs d’hiver (4, posés)', 79999, { sort: 2 });
  job('j-t3', { customer_id: 'c-julie', vehicle_id: 'v-julie', day: D(2), block: 'am', status: 'cancelled', stop_order: null, cancelled_at: at(D(0), 420), lost_reason: 'La cliente a vendu son auto.' });
  item('ji-t3', 'j-t3', 's-pneus', 'Pose de pneus (4)', 9999);

  /* ---------- invoices and payments ---------- */
  const invoice = (id: string, job_id: string, customer_id: string, number: number | null, status: string, lines: { description: string; qty: number; unit_cents: number; taxable: boolean }[], paid: number, issued: string | null) => {
    const sub = lines.reduce((n, l) => n + Math.round(l.qty * l.unit_cents), 0);
    const tps = Math.round(sub * 0.05), tvq = Math.round(sub * 0.09975);
    return put('invoices', { id, job_id, customer_id, number, status, issued_at: issued, due_on: null, lines, taxes_on: true, subtotal_cents: sub, taxable_cents: sub, tps_cents: tps, tvq_cents: tvq, total_cents: sub + tps + tvq, paid_cents: paid, lang: 'fr', notes: null, sent_at: issued, voided_at: null, void_reason: null });
  };
  const tot = (sub: number) => sub + Math.round(sub * 0.05) + Math.round(sub * 0.09975);
  invoice('f-y1', 'j-y1', 'c-patrick', 41, 'paid', [{ description: 'Freins avant (plaquettes et disques)', qty: 1, unit_cents: 34999, taxable: true }], tot(34999), at(D(-1), 592));
  put('payments', { id: 'p-y1', invoice_id: 'f-y1', job_id: 'j-y1', amount_cents: tot(34999), method: 'debit', paid_at: at(D(-1), 595), reference: null, stripe_session: null, note: null });
  invoice('f-y2', 'j-y2', 'c-flotte', 42, 'issued', [{ description: 'Changement d’huile et filtre', qty: 1, unit_cents: 8999, taxable: true }], 0, at(D(-1), 802));
  invoice('f-1', 'j-1', 'c-julie', 43, 'paid', [{ description: 'Changement d’huile et filtre', qty: 1, unit_cents: 8999, taxable: true }, { description: 'Top up des liquides', qty: 1, unit_cents: 6000, taxable: true }], tot(14999), at(D(0), 549));
  put('payments', { id: 'p-1', invoice_id: 'f-1', job_id: 'j-1', amount_cents: tot(14999), method: 'credit', paid_at: at(D(0), 551), reference: null, stripe_session: null, note: null });
  invoice('f-old', 'j-y1', 'c-patrick', 40, 'void', [{ description: 'Brouillon remplacé', qty: 1, unit_cents: 1000, taxable: true }], 0, at(D(-1), 591));
  put('quotes', { id: 'q-1', number: 7, customer_id: null, vehicle_id: null, vehicle_text: '2012 Toyota Corolla', contact_name: 'Client au stationnement', contact_phone: null, items: [{ description: 'Freins avant (plaquettes et disques)', qty: 1, unit_cents: 34999, taxable: true, service_id: 's-freins-av', duration_min: 90 }], notes: 'Prix donné sur place.', status: 'open', job_id: null, lang: 'fr', valid_until: D(30) });
  put('quotes', { id: 'q-2', number: 8, customer_id: 'c-sophie', vehicle_id: 'v-sophie', vehicle_text: null, contact_name: null, contact_phone: null, items: [{ description: 'Pose de pneus (4)', qty: 1, unit_cents: 9999, taxable: true, service_id: 's-pneus', duration_min: 60 }], notes: null, status: 'sent', job_id: null, lang: 'fr', valid_until: D(14) });

  /* ---------- treasury ---------- */
  const ex = (id: string, day: string, vendor: string, category: string, sub: number, method: string) =>
    put('expenses', { id, day, vendor, category, description: null, subtotal_cents: sub, tps_cents: Math.round(sub * 0.05), tvq_cents: Math.round(sub * 0.09975), total_cents: tot(sub), method, truck_id: TRUCK.complet, receipt_id: null, notes: null });
  ex('e-1', D(-1), 'Lordco Pièces d’auto', 'Pièces', 18450, 'credit');
  ex('e-2', D(-2), 'Petro-Canada', 'Carburant', 8695, 'debit');
  ex('e-3', D(-8), 'Canadian Tire', 'Outils et équipement', 12999, 'credit');

  /* ---------- the day in the field ---------- */
  put('shifts', { id: 'sh-saleh', staff_id: ME.saleh, started_at: at(D(0), 465), ended_at: null });
  put('shifts', { id: 'sh-adam', staff_id: ME.adam, started_at: at(D(0), 600), ended_at: null });
  put('positions', { id: ME.saleh, lat: 45.5022, lng: -73.7094, accuracy_m: 12, heading: null, speed_kmh: 0, job_id: 'j-2', at: new Date().toISOString() });
  put('positions', { id: ME.adam, lat: 45.5201, lng: -73.6655, accuracy_m: 9, heading: 40, speed_kmh: 38, job_id: 'j-6', at: new Date().toISOString() });
  put('trips', { id: 'tr-1', job_id: 'j-6', staff_id: ME.adam, status: 'active', started_at: at(D(0), 615), ended_at: null, eta_at: at(D(0), 640), km: 6.2, minutes: 14, route: [[45.5005, -73.6577], [45.5120, -73.6630], [45.5201, -73.6655], [45.5307, -73.6702]], dest_lat: 45.5307, dest_lng: -73.6702, sms_status: 'sent', expires_at: at(D(0), 900) });
  put('messages', { id: 'm-1', job_id: 'j-3', customer_id: 'c-sophie', staff_id: ME.owner, kind: 'booking', channel: 'sms', to_addr: '+15145550119', body: 'Bonjour Sophie, votre rendez-vous avec Mécanique Mobile H.I.S est confirmé…', status: 'sent', error: null });
  put('messages', { id: 'm-2', job_id: 'j-6', customer_id: 'c-amira', staff_id: ME.adam, kind: 'en_route', channel: 'sms', to_addr: '+14385550133', body: 'Bonjour Amira, Adam de Mécanique Mobile H.I.S est en route…', status: 'sent', error: null });
}
