/* DEV ONLY — demo rows for the customers section: when the demo customers became customers (so « Récents » means
   something), a new caller with no visit yet, an English customer with a valid VIN, a business with a contact name,
   a few older visits and notes (one reminder due today). The pretend 'vin' answers like the real one (17 characters,
   the year from the VIN). Everything is wrapped: a problem here never stops another section's demo. */
import { put, registerFn } from '../fake-server';
import { addDays, today } from '../../lib/dates';
import { vinYear } from '../../lib/text';

export function load() {
  try {
    const D = (n: number) => addDays(today(), n);
    const iso = (day: string, h = 10) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, h).toISOString(); };
    // when each demo customer first called
    const since: Record<string, number> = { 'c-julie': -610, 'c-marc': -420, 'c-sophie': -330, 'c-kevin': -260, 'c-amira': -150, 'c-patrick': -540, 'c-emilie': -90, 'c-flotte': -800 };
    for (const [id, n] of Object.entries(since)) put('customers', { id, created_at: iso(D(n)) });

    const cu = (id: string, o: Record<string, unknown>) => put('customers', {
      id, first_name: null, last_name: null, company: null, phone: null, email: null, lang: 'fr', address: null, unit: null, city: 'Montréal', postal_code: null,
      lat: null, lng: null, notes: null, card_on_file: false, no_shows: 0, sms_ok: true, ...o, phone_digits: String(o.phone || '').replace(/\D/g, '').slice(-10) || null
    });
    cu('c-jf', { first_name: 'Jean-François', last_name: 'Bélanger', phone: '438 555-0112', address: '4100 rue Jean-Talon O, Montréal, QC', postal_code: 'H4P 1W1', created_at: iso(D(0), 9) });
    cu('c-liam', { first_name: 'Liam', last_name: 'O’Neil', phone: '514 555-0170', email: 'liam.oneil@example.com', lang: 'en', address: '5800 ch. Côte-Saint-Luc, Montréal, QC', unit: '12', postal_code: 'H3X 2E6', lat: 45.4831, lng: -73.6316, card_on_file: true, created_at: iso(D(-400)) });
    cu('c-dube', { first_name: 'Marc', last_name: 'Dubé', company: 'Plomberie Dubé inc.', phone: '450 555-0181', address: '2250 boul. Le Corbusier, Laval, QC', postal_code: 'H7S 2C9', lat: 45.5596, lng: -73.7339, sms_ok: false, created_at: iso(D(-45)) });

    const ve = (id: string, customer_id: string, o: Record<string, unknown>) => put('vehicles', { id, customer_id, trim: null, engine: null, displacement: null, cylinders: null, fuel: 'essence', drive: null, vin: null, plate: null, odometer_km: null, color: null, tire_size: null, spec_key: null, notes: null, ...o });
    ve('v-jf', 'c-jf', { year: 2015, make: 'Toyota', model: 'Corolla' });
    ve('v-liam', 'c-liam', { year: 2003, make: 'Honda', model: 'Accord', trim: 'EX', vin: '1HGCM82633A004352', plate: 'K45 PLM', odometer_km: 231400, color: 'Argent', tire_size: '205/60R16' });
    ve('v-dube1', 'c-dube', { year: 2019, make: 'RAM', model: '1500', engine: '5.7 L V8', plate: 'FLD 2210' });
    ve('v-dube2', 'c-dube', { year: 2019, make: 'RAM', model: '1500', engine: '5.7 L V8', plate: 'FLD 2211' });
    put('vehicles', { id: 'v-julie', plate: 'GHX 1207', color: 'Gris', tire_size: '215/50R17' });

    // older visits (history, « Dernière visite »)
    const job = (id: string, number: number, customer_id: string, vehicle_id: string, day: string, block: string, desc: string, cents: number, status = 'done') => {
      put('jobs', {
        id, number, customer_id, vehicle_id, day, block, truck_id: 't-complet', truck_pinned: false, stop_order: 1, eta_min: block === 'am' ? 540 : 780, travel_min: 18, duration_min: 60,
        status, problem: null, notes: null, address: null, unit: null, postal_code: null, lat: null, lng: null, card_on_file: false, lost_cents: null, lost_reason: null,
        started_at: iso(day, 9), arrived_at: iso(day, 9), finished_at: status === 'done' ? iso(day, 10) : null, cancelled_at: null, pay_later: false, pay_later_reason: null,
        waiver_signed_at: iso(day, 9), waiver_signer: null, waiver_version: '1', waiver_attachment: null, confirm_sent_at: null, source: 'phone', quote_id: null, created_by: 'u-hassan', created_at: iso(addDays(day, -5))
      });
      put('job_items', { id: `${id}-i`, job_id: id, kind: 'service', service_id: null, item_id: null, description: desc, qty: 1, unit_cents: cents, taxable: true, duration_min: null, status: status === 'done' ? 'done' : 'planned', answered_at: null, answered_via: null, note: null, sort: 1 });
    };
    job('j-old1', 61, 'c-julie', 'v-julie', D(-174), 'am', 'Changement d’huile et filtre', 8999);
    job('j-old2', 72, 'c-marc', 'v-marc', D(-125), 'pm', 'Freins avant (plaquettes et disques)', 34999);
    job('j-old3', 55, 'c-liam', 'v-liam', D(-212), 'pm', 'Remplacement de batterie', 4999);
    const sub = 8999, tps = Math.round(sub * 0.05), tvq = Math.round(sub * 0.09975);
    put('invoices', { id: 'f-old1', job_id: 'j-old1', customer_id: 'c-julie', number: 31, status: 'paid', issued_at: iso(D(-174), 10), due_on: null, lines: [{ description: 'Changement d’huile et filtre', qty: 1, unit_cents: sub, taxable: true }], taxes_on: true, subtotal_cents: sub, taxable_cents: sub, tps_cents: tps, tvq_cents: tvq, total_cents: sub + tps + tvq, paid_cents: sub + tps + tvq, lang: 'fr', notes: null, sent_at: iso(D(-174), 10), voided_at: null, void_reason: null });

    put('payments', { id: 'p-old1', invoice_id: 'f-old1', job_id: 'j-old1', amount_cents: sub + tps + tvq, method: 'debit', paid_at: iso(D(-174), 10), reference: null, stripe_session: null, note: null });
    // notes, with a reminder due today and one done
    put('customer_notes', { id: 'n-marc', customer_id: 'c-marc', body: 'Pneus d’hiver dans le coffre : les poser avant le 1er décembre.', remind_on: D(0), done_at: null, created_by: 'u-office', created_at: iso(D(-30)) });
    put('customer_notes', { id: 'n-kevin', customer_id: 'c-kevin', body: 'Préfère les textos aux appels. Stationnement visiteurs, place 14.', remind_on: null, done_at: null, created_by: 'u-saleh', created_at: iso(D(-60)) });
    put('customer_notes', { id: 'n-julie-old', customer_id: 'c-julie', body: 'Rappeler pour la vidange d’huile.', remind_on: D(-175), done_at: iso(D(-176)), created_by: 'u-hassan', created_at: iso(D(-260)) });
    put('customer_notes', { id: 'n-1', created_by: 'u-saleh', created_at: iso(D(-174), 11) });

    // the pretend VIN reader, close to the real one: 17 characters, never I, O, Q; the year comes from the VIN
    registerFn('vin', (b) => {
      const vin = String(b.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return { ok: false, code: 'vin', error: 'Un VIN a 17 caractères (jamais de I, O ou Q).' };
      if (vin === '1HGCM82633A004352') return { ok: true, vehicle: { vin, year: 2003, make: 'Honda', model: 'Accord', trim: 'EX', displacement: 3.0, cylinders: 6, turbo: null, fuel: 'essence', drive: 'fwd', engine: 'J30A4', error: null } };
      return { ok: true, vehicle: { vin, year: vinYear(vin) || 2019, make: 'Honda', model: 'Civic', trim: 'LX', displacement: 2.0, cylinders: 4, turbo: null, fuel: 'essence', drive: 'fwd', engine: 'K20C2', error: null } };
    });
  } catch (e) {
    console.warn('demo-extra/customers', e);
  }
}
