/* DEV ONLY — « Heures travaillées »: Saleh's and Adam's days of work before today (one « Terminer ma journée » forgotten,
   closed by the night at 3 h 17), and the corrections by the owners and the treasurer (pretend shift_save / shift_remove).
   The real rules (who may, not in the future, 24 hours at most, the history in activity) live in
   supabase/migrations/20261119000100_heures.sql and are tested in tests/db/heures.test.mjs. */
import { registerRpc, put, find, table, rows, refuse, nowIso } from '../fake-server';
import { addDays, dow, instantOf, today } from '../../lib/dates';

const SALEH = 'u-saleh', ADAM = 'u-adam';
const me = () => (globalThis as { __demoUser?: string }).__demoUser || 'u-hassan';

export function load() {
  try {
    const D = (n: number) => addDays(today(), n);
    const at = (day: string, min: number) => instantOf(day, min).toISOString();
    for (let i = 1; i <= 9; i++) {
      const day = D(-i);
      if (dow(day) === 0) continue;
      put('shifts', { id: `sh-saleh-${i}`, staff_id: SALEH, started_at: at(day, 470 + (i % 3) * 7), ended_at: i === 2 ? at(D(-1), 197) : at(day, 990 + (i % 4) * 11) });
      if (i % 3 !== 1) put('shifts', { id: `sh-adam-${i}`, staff_id: ADAM, started_at: at(day, 540 + (i % 2) * 15), ended_at: at(day, 1020 - (i % 3) * 20) });
    }
  } catch (e) { console.warn('demo timesheet', e); }

  registerRpc('shift_save', (a) => {
    const id = a.p_shift ? String(a.p_shift) : null;
    const old = id ? find('shifts', id) : undefined;
    if (id && !old) refuse('no_shift_row', 'Cette journée n’existe plus. Recharge la page.');
    const staff = old ? String(old.staff_id) : String(a.p_staff);
    const start = String(a.p_start), end = a.p_end ? String(a.p_end) : null;
    if (end && Date.parse(end) <= Date.parse(start)) refuse('bad_hours', 'La fin doit être après le début.');
    const hit = table('shifts').some((s) => s.staff_id === staff && !s.deleted_at && s.id !== id && Date.parse(String(s.started_at)) < (end ? Date.parse(end) : Infinity) && Date.parse(start) < (s.ended_at ? Date.parse(String(s.ended_at)) : Infinity));
    if (hit) refuse('overlap', 'Ces heures chevauchent une autre journée de cette personne.');
    const row = put('shifts', { ...(id ? { id } : {}), staff_id: staff, started_at: start, ended_at: end, fixed_by: me(), fixed_at: nowIso() });
    return { ok: true, id: row.id, rows: rows({ shifts: row }) };
  });
  registerRpc('shift_remove', (a) => {
    const s = find('shifts', String(a.p_shift));
    if (!s) refuse('no_shift_row', 'Cette journée n’existe plus. Recharge la page.');
    return { ok: true, rows: rows({ shifts: put('shifts', { id: String(a.p_shift), deleted_at: nowIso(), fixed_by: me(), fixed_at: nowIso() }) }) };
  });
}
