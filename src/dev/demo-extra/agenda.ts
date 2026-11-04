/* DEV ONLY — the week of the agenda, booking and hours screens: more jobs over the coming days, two changed days, and
   pretend operations closer to the real planner (a block is closed when no truck works, full when the work and a drive
   no longer fit; apply_hours touches only the days it is given). Imported by every section's demo: it never throws. */
import { registerRpc, put, find, table, rows, refuse, type DemoRow } from '../fake-server';
import { addDays, today, nowMinute, dow } from '../../lib/dates';

const BLOCKS: Record<string, [number, number]> = { am: [480, 720], pm: [720, 960], eve: [960, 1200] };
const POS: Record<string, number> = { am: 0, pm: 1, eve: 2 };
const HOME = { lat: 45.5005053, lng: -73.6577429 };
type R = [number, number];

function rangesOf(truckId: string, day: string): R[] {
  const d = table('truck_days').find((x) => x.truck_id === truckId && x.day === day && !x.deleted_at);
  if (d) return (d.ranges as R[]) || [];
  const w = table('truck_week').find((x) => x.truck_id === truckId && Number(x.dow) === dow(day) && !x.deleted_at);
  return (w?.ranges as R[]) || [];
}
function capOf(truckId: string, day: string, block: string): number {
  if (day < today()) return 0;
  const [a, b] = BLOCKS[block] || [0, 0];
  const from = day === today() ? nowMinute() : 0;
  let n = 0;
  for (const [x, y] of rangesOf(truckId, day)) n += Math.max(0, Math.min(y, b) - Math.max(x, a, from));
  return n;
}
const live = (j: DemoRow) => !j.deleted_at && !['cancelled', 'no_show', 'done'].includes(String(j.status));
function usedOf(truckId: string, day: string, block: string, exclude?: string | null): number {
  return table('jobs').filter((j) => j.truck_id === truckId && j.day === day && j.block === block && live(j) && j.id !== exclude)
    .reduce((n, j) => n + Number(j.duration_min || 60) + Number(j.travel_min ?? 20), 0);
}
function started(day: string, block: string) { return day < today() || (day === today() && nowMinute() >= (BLOCKS[block]?.[0] ?? 0)); }
/** the truck with the most room that takes the work and a drive, or the reason it can't be placed */
function placeIn(day: string, block: string, dur: number, wanted: string | null, exclude: string | null): { truck: string; left: number } | { refusal: string } {
  const working = table('trucks').filter((t) => t.active && !t.deleted_at && capOf(t.id, day, block) >= 45);
  if (!working.length) return { refusal: 'block_closed' };
  const room = (id: string) => capOf(id, day, block) - usedOf(id, day, block, exclude);
  const fits = working.filter((t) => room(t.id) >= dur + 18).sort((a, b) => room(b.id) - room(a.id));
  if (wanted) return fits.some((t) => t.id === wanted) ? { truck: wanted, left: room(wanted) - dur - 18 } : { refusal: 'truck_full' };
  return fits[0] ? { truck: fits[0].id, left: room(fits[0].id) - dur - 18 } : { refusal: 'block_full' };
}
const WHY: Record<string, string> = {
  block_closed: 'Ce bloc est fermé ce jour-là : aucun camion ne travaille.',
  block_full: 'Ce bloc est complet : la route ne rentre plus dans le temps. Choisis un autre bloc.',
  truck_full: 'Ce camion n’a plus de place dans ce bloc. Laisse l’app choisir le camion, ou choisis un autre bloc.',
  block_started: 'Ce bloc est déjà commencé : choisis un autre bloc.'
};
/** the stops of each truck in a block, in order: 1, 2, 3… */
function renumber(day: string, block: string): DemoRow[] {
  const out: DemoRow[] = [];
  const js = table('jobs').filter((j) => j.day === day && j.block === block && !j.deleted_at && !['cancelled', 'no_show'].includes(String(j.status)));
  for (const tid of new Set(js.map((j) => j.truck_id))) {
    js.filter((j) => j.truck_id === tid).sort((a, b) => Number(a.stop_order ?? 99) - Number(b.stop_order ?? 99) || String(a.created_at).localeCompare(String(b.created_at)))
      .forEach((j, i) => {
        const order = tid ? i + 1 : null;
        const eta = tid ? (BLOCKS[block]?.[0] ?? 480) + 20 + i * 75 : null;
        out.push(j.stop_order === order && j.eta_min === eta ? j : put('jobs', { id: j.id, stop_order: order, eta_min: eta }));
      });
  }
  return out;
}
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
};
function pointOf(j: DemoRow): { lat: number; lng: number } | null {
  const c = find('customers', j.customer_id);
  const lat = Number(j.lat ?? c?.lat), lng = Number(j.lng ?? c?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && (j.lat != null || c?.lat != null) ? { lat, lng } : null;
}

/* ---------- operations (registered from load(): the demo's own ones are registered after this file is read) ---------- */
function registerOps() {
  registerRpc('book_job', (a) => {
    const j = a.p_job as DemoRow & { day: string; block: string; customer_id: string; truck_id?: string; duration_min?: number };
    if (!j.customer_id) refuse('no_customer', 'Choisis le client avant de réserver.');
    if (!BLOCKS[j.block] || !j.day) refuse('bad_block', 'Choisis la date et le bloc : matin, après-midi ou soir.');
    if (started(j.day, j.block)) refuse('block_started', WHY.block_started);
    if (find('jobs', j.id)) refuse('exists', 'Ce rendez-vous existe déjà.');
    const items = ((a.p_items as DemoRow[]) || []);
    const dur = Number(j.duration_min) || items.reduce((m, i) => m + (Number(i.duration_min) || 0), 0) || 60;
    const p = placeIn(j.day, j.block, dur, j.truck_id || null, null);
    if ('refusal' in p) refuse(p.refusal, WHY[p.refusal]);
    const number = Math.max(200, ...table('jobs').map((x) => Number(x.number) || 0)) + 1;
    const job = put('jobs', {
      vehicle_id: null, stop_order: 99, eta_min: null, travel_min: 18, problem: null, notes: null, address: null, unit: null, postal_code: null, lat: null, lng: null,
      card_on_file: false, lost_cents: null, lost_reason: null, started_at: null, arrived_at: null, finished_at: null, cancelled_at: null, pay_later: false, pay_later_reason: null,
      waiver_signed_at: null, waiver_signer: null, waiver_version: null, waiver_attachment: null, confirm_sent_at: null, source: 'phone', quote_id: null,
      status: 'booked', number, created_by: (globalThis as { __demoUser?: string }).__demoUser || 'u-hassan',
      ...j, truck_id: p.truck, truck_pinned: !!j.truck_id, duration_min: dur
    });
    const its = items.map((it, i) => put('job_items', { kind: 'service', qty: 1, unit_cents: 0, taxable: true, status: 'planned', answered_at: null, answered_via: null, note: null, item_id: null, service_id: null, duration_min: null, sort: i + 1, ...it, id: String(it.id || crypto.randomUUID()), job_id: job.id }));
    if (j.quote_id) { const q = find('quotes', j.quote_id); if (q) put('quotes', { id: q.id, status: 'converted', job_id: job.id }); }
    const moved = renumber(j.day, j.block);
    return { ok: true, job_id: job.id, truck_id: p.truck, rows: rows({ jobs: moved.length ? moved : [job], job_items: its, quotes: j.quote_id ? find('quotes', j.quote_id) : undefined }) };
  });

  registerRpc('move_job', (a) => {
    const j = find('jobs', a.p_job);
    if (!j) refuse('not_found', 'Ce rendez-vous n’existe plus.');
    if (j.status !== 'booked') refuse('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.');
    const day = String(a.p_day), block = String(a.p_block), wanted = (a.p_truck as string) || null;
    if (!BLOCKS[block]) refuse('bad_block', 'Bloc inconnu.');
    if (started(day, block)) refuse('block_started', 'Ce bloc est déjà commencé.');
    if (j.day === day && j.block === block && !wanted) return { ok: true, unchanged: true, rows: rows({ jobs: j }) };
    const p = placeIn(day, block, Number(j.duration_min) || 60, wanted, j.id);
    if ('refusal' in p) refuse(p.refusal, WHY[p.refusal].replace(' Choisis un autre bloc.', ''));
    const from = { day: String(j.day), block: String(j.block) };
    put('jobs', { id: j.id, day, block, truck_id: p.truck, truck_pinned: !!wanted, stop_order: 99, confirm_sent_at: null });
    const changed = [...renumber(day, block), ...renumber(from.day, from.block)];
    return { ok: true, job_id: j.id, changed: true, rows: rows({ jobs: changed.length ? changed : [find('jobs', j.id)!] }) };
  });

  registerRpc('suggest_blocks', (a) => {
    const from = String(a.p_from || today()) < today() ? today() : String(a.p_from || today());
    const days = Math.max(1, Math.min(60, Number(a.p_days || 14)));
    const dur = Number(a.p_duration) || 60, exclude = (a.p_exclude as string) || null, limit = Math.max(1, Number(a.p_limit || 6));
    const here = a.p_lat != null && a.p_lng != null ? { lat: Number(a.p_lat), lng: Number(a.p_lng) } : null;
    const out: { day: string; block: string; pos: number; drive_min: number; near: number; truck: string; left: number }[] = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(from, i);
      for (const block of ['am', 'pm', 'eve']) {
        if (started(day, block)) continue;
        const p = placeIn(day, block, dur, null, exclude);
        if ('refusal' in p) continue;
        const others = table('jobs').filter((j) => j.day === day && j.block === block && j.id !== exclude && !j.deleted_at && !['cancelled', 'no_show'].includes(String(j.status)));
        const pts = others.map(pointOf).filter(Boolean) as { lat: number; lng: number }[];
        const nearest = here ? Math.min(km(HOME, here), ...pts.map((q) => km(q, here))) : 0;
        const drive = here ? Math.ceil((nearest * 1.3) / 35 * 60) : 20;
        const near = here ? pts.filter((q) => km(q, here) <= 5).length : 0;
        out.push({ day, block, pos: POS[block], drive_min: drive, near, truck: p.truck, left: Math.max(0, p.left) });
      }
    }
    out.sort((x, y) => x.drive_min - y.drive_min || y.near - x.near || x.day.localeCompare(y.day) || x.pos - y.pos);
    return out.slice(0, limit);
  });

  registerRpc('apply_hours', (a) => {
    const truck = String(a.p_truck), mode = String(a.p_mode), week = (a.p_week || {}) as Record<string, R[]>;
    if (!['day', 'weeks', 'always'].includes(mode)) refuse('bad_mode', 'Choisis : aujourd’hui seulement, pendant quelques semaines ou en permanence.');
    const from = String(a.p_from || today()) < today() ? today() : String(a.p_from || today());
    const changedWeek: DemoRow[] = [], changedDays: DemoRow[] = [];
    if (mode === 'always') {
      for (const [k, ranges] of Object.entries(week)) {
        const d = Number(k);
        const cur = table('truck_week').find((x) => x.truck_id === truck && Number(x.dow) === d);
        changedWeek.push(put('truck_week', { id: cur?.id || `w-${truck}-${d}`, truck_id: truck, dow: d, ranges, deleted_at: null }));
        for (const x of table('truck_days')) if (x.truck_id === truck && String(x.day) >= from && dow(String(x.day)) === d && !x.deleted_at) changedDays.push(put('truck_days', { id: x.id, deleted_at: new Date().toISOString() }));
      }
    } else {
      const n = mode === 'day' ? 1 : Math.max(1, Math.min(52, Number(a.p_weeks || 1))) * 7;
      for (let i = 0; i < n; i++) {
        const day = addDays(from, i);
        const ranges = week[String(dow(day))];
        if (!ranges) continue;
        const cur = table('truck_days').find((x) => x.truck_id === truck && x.day === day);
        changedDays.push(put('truck_days', { id: cur?.id || `d-${truck}-${day}`, truck_id: truck, day, ranges, note: null, deleted_at: null }));
      }
    }
    return { ok: true, changed: changedWeek.length + changedDays.length, rows: rows({ truck_week: changedWeek, truck_days: changedDays }) };
  });

}

/* ---------- more of the week ---------- */
export function load() {
  try { registerOps(); } catch (e) { console.warn('demo-extra/agenda: operations', e); }
  try {
    if (find('jobs', 'j-w1')) return;
    const D = (n: number) => addDays(today(), n);
    let num = 150;
    const trucks = table('trucks').filter((t) => t.active && !t.deleted_at).map((t) => t.id);
    const add = (id: string, n: number, block: string, o: Partial<DemoRow> & { customer_id: string }, line: [string | null, string, number, number]) => {
      const day = D(n);
      // the truck that works then (the demo's hours depend on today's weekday)
      const truck = o.truck_id === null ? null : trucks.find((tid) => capOf(tid, day, block) >= 45 && (!o.truck_id || o.truck_id === tid)) ?? trucks.find((tid) => capOf(tid, day, block) >= 45) ?? null;
      if (truck === null && o.truck_id !== null) return;
      const v = table('vehicles').find((x) => x.customer_id === o.customer_id && !x.deleted_at);
      put('jobs', {
        id, number: ++num, vehicle_id: v?.id ?? null, truck_pinned: false, stop_order: 99, eta_min: null, travel_min: 16, duration_min: line[3], problem: null, notes: null,
        address: null, unit: null, postal_code: null, lat: null, lng: null, card_on_file: false, lost_cents: null, lost_reason: null, started_at: null, arrived_at: null, finished_at: null,
        cancelled_at: null, pay_later: false, pay_later_reason: null, waiver_signed_at: null, waiver_signer: null, waiver_version: null, waiver_attachment: null, confirm_sent_at: null,
        source: 'phone', quote_id: null, created_by: 'u-hassan', day, block, status: 'booked', ...o, truck_id: truck
      });
      put('job_items', { id: `${id}-i`, job_id: id, kind: 'service', service_id: line[0], item_id: null, description: line[1], qty: 1, unit_cents: line[2], taxable: true, duration_min: line[3], status: 'planned', answered_at: null, answered_via: null, note: null, sort: 1 });
    };
    add('j-w1', 1, 'am', { customer_id: 'c-sophie', truck_id: 't-voiture' }, ['s-pneus', 'Pose de pneus (4)', 9999, 60]);
    add('j-w2', 1, 'am', { customer_id: 'c-emilie' }, ['s-huile', 'Changement d’huile et filtre', 8999, 45]);
    add('j-w3', 1, 'eve', { customer_id: 'c-amira', problem: 'Voyant de batterie allumé le matin.' }, ['s-diag60', 'Diagnostic 1 h', 12000, 60]);
    add('j-w4', 1, 'pm', { customer_id: 'c-patrick', status: 'cancelled', cancelled_at: new Date().toISOString(), lost_reason: 'Le client a trouvé un garage plus proche.' }, ['s-inspection', 'Inspection avant achat', 10000, 60]);
    add('j-w5', 2, 'am', { customer_id: 'c-marc' }, ['s-freins-ar', 'Freins arrière (plaquettes et disques)', 34999, 90]);
    add('j-w6', 2, 'pm', { customer_id: 'c-emilie' }, ['s-topup', 'Top up des liquides', 6000, 20]);
    add('j-w7', 2, 'pm', { customer_id: 'c-patrick' }, ['s-refroid', 'Vidange du liquide de refroidissement', 14999, 60]);
    add('j-w8', 2, 'eve', { customer_id: 'c-sophie', truck_id: null, notes: 'Préfère après 18 h.' }, ['s-batterie', 'Remplacement de batterie', 4999, 30]);
    add('j-w9', 3, 'am', { customer_id: 'c-julie' }, ['s-promo', 'Promo hiver : huile + pneus', 16999, 90]);
    add('j-w11', 5, 'pm', { customer_id: 'c-kevin' }, ['s-refroid', 'Vidange du liquide de refroidissement', 14999, 60]);
    add('j-w12', 6, 'am', { customer_id: 'c-flotte' }, ['s-huile', 'Changement d’huile et filtre', 8999, 45]);
    add('j-w13', 6, 'am', { customer_id: 'c-amira' }, ['s-freins-av', 'Freins avant (plaquettes et disques)', 34999, 90]);
    for (let n = 1; n <= 6; n++) for (const b of ['am', 'pm', 'eve']) renumber(D(n), b);
    // two days that differ from the usual week
    if (!find('truck_days', 'd-x-1')) put('truck_days', { id: 'd-x-1', truck_id: 't-complet', day: D(9), ranges: [], note: null });
    if (!find('truck_days', 'd-x-2')) put('truck_days', { id: 'd-x-2', truck_id: 't-voiture', day: D(10), ranges: [[600, 960]], note: null });
  } catch (e) {
    console.warn('demo-extra/agenda', e);
  }
}
