/* DEV ONLY — pretend set_truck_start (Part 18): where one truck leaves from. The real rules (who may, the re-plan of the
   coming blocks) live in supabase/migrations/20261106000400_truck_start.sql and are tested there. */
import { registerRpc, put, find, rows, refuse } from '../fake-server';

export function load() {
  registerRpc('set_truck_start', (a) => {
    const tr = find('trucks', a.p_truck);
    if (!tr || tr.deleted_at) refuse('no_truck', 'Ce camion n’existe plus.');
    const s = a.p_start as Record<string, unknown> | null;
    let start: Record<string, unknown> | null = null;
    if (s) {
      const lat = Number(s.lat), lng = Number(s.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) refuse('no_position', 'Cette adresse n’est pas trouvée sur la carte. Choisis-la dans la liste.');
      start = { label: s.label ? String(s.label).slice(0, 30) : null, address: s.address ? String(s.address) : null, lat, lng };
    }
    return { ok: true, rows: rows({ trucks: put('trucks', { id: String(a.p_truck), start }) }) };
  });
}
