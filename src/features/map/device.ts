/* The team map from the phone's own copy, in the same shape as team_map(p_day): shown at once while the server
   answers, and when there is no signal and no earlier answer. It only holds what this person may see. */
import { rowsOf } from '../../data/store';
import { settings, trucks, jobsOn, customer, staff, openShift } from '../../data/select';
import type { Position, Trip } from '../../data/types';
import type { TeamMapAnswer } from './assemble';

const HOURS12 = 12 * 3600 * 1000;

export function fromDevice(day: string): TeamMapAnswer {
  const h = settings.value.booking?.home;
  const now = Date.now();
  return {
    home: h ? { lat: h.lat ?? null, lng: h.lng ?? null, label: h.label || 'Centrale', address: h.address || '' } : null,
    trucks: trucks.value.map((tr) => ({ id: tr.id, name: tr.name, color: tr.color, driver_id: tr.driver_id })),
    jobs: jobsOn(day).filter((j) => j.status !== 'cancelled' && j.status !== 'no_show').map((j) => {
      const c = customer(j.customer_id);
      return {
        id: j.id, number: j.number, truck_id: j.truck_id, order: j.stop_order, eta_min: j.eta_min, status: j.status, block: j.block,
        name: (c?.first_name || '').trim() || c?.company || '—', address: j.address || c?.address || null,
        lat: j.lat ?? c?.lat ?? null, lng: j.lng ?? c?.lng ?? null
      };
    }),
    people: rowsOf<Position>('positions')
      .filter((p) => !p.deleted_at && openShift(p.id) && now - Date.parse(p.at) < HOURS12)
      .map((p) => { const s = staff(p.id); return { id: p.id, name: s ? s.short_name || s.full_name : '', color: s?.color ?? null, lat: p.lat, lng: p.lng, at: p.at, job_id: p.job_id }; }),
    trips: rowsOf<Trip>('trips')
      .filter((tr) => tr.status === 'active' && !tr.deleted_at && Date.parse(tr.expires_at) > now)
      .map((tr) => ({ job_id: tr.job_id, staff_id: tr.staff_id, eta_at: tr.eta_at, km: tr.km, minutes: tr.minutes, route: tr.route }))
  };
}
