/* DEV ONLY — demo rows for « Rappels d’huile »: an oil change of 7 months ago (to call), one of 5 months and a half ago
   (soon), and a car whose owner asked to be called back in two weeks. Wrapped: a problem here never stops another demo. */
import { put } from '../fake-server';
import { addDays, today } from '../../lib/dates';

export function load() {
  try {
    const D = (n: number) => addDays(today(), n);
    const iso = (day: string, h = 10) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, h).toISOString(); };
    const visit = (id: string, number: number, customer_id: string, vehicle_id: string, day: string, desc: string) => {
      put('jobs', {
        id, number, customer_id, vehicle_id, day, block: 'am', truck_id: 't-complet', truck_pinned: false, stop_order: 1, eta_min: 540, travel_min: 18, duration_min: 45,
        status: 'done', problem: null, notes: null, address: null, unit: null, postal_code: null, lat: null, lng: null, card_on_file: false, lost_cents: null, lost_reason: null,
        started_at: iso(day, 9), arrived_at: iso(day, 9), finished_at: iso(day, 10), cancelled_at: null, pay_later: false, pay_later_reason: null,
        waiver_signed_at: iso(day, 9), waiver_signer: null, waiver_version: '1', waiver_attachment: null, confirm_sent_at: null, source: 'phone', quote_id: null, created_by: 'u-hassan', created_at: iso(addDays(day, -3))
      });
      put('job_items', { id: `${id}-i`, job_id: id, kind: 'service', service_id: null, item_id: null, description: desc, qty: 1, unit_cents: 8999, taxable: true, duration_min: null, status: 'done', answered_at: null, answered_via: null, note: null, sort: 1 });
    };
    visit('j-oil1', 41, 'c-patrick', 'v-patrick', D(-214), 'Changement d’huile et filtre');
    visit('j-oil2', 58, 'c-dube', 'v-dube1', D(-190), 'Changement d’huile et filtre');
    visit('j-oil3', 66, 'c-flotte', 'v-flotte1', D(-165), 'Changement d’huile et filtre');
    put('vehicles', { id: 'v-dube1', oil_followup: { at: iso(D(-2), 14), by: 'u-hassan', again_on: D(12) } });
  } catch (e) { console.warn('demo oil', e); }
}
