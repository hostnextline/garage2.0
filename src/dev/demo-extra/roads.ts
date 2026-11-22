/* DEV ONLY — « Vraies routes » (Part 27) in the demo: the switch of Réglages → Réservations can be tried for real.
   - A pretend function « drive » (status, warm, sweep) that « measures » the demo's trips: a made-up road time for each
     pair of places (the start and the appointments of each coming day), kept in a pretend table. NOTHING leaves the page:
     there is no network in the demo, so the made-up times come from the distance between the two places (a road factor,
     a city speed, and a slower time at the rush hours). They are the demo's numbers, never the app's.
   - A pretend roads_switch: owner only (not_allowed), p_on must be true or false (bad_mode), refused (roads_cold) while a
     usual-hours trip of the coming days is not measured; then the coming days are planned again with the measured times:
     the blocks planned again, the blocks kept as they were (the trips no longer fit: arrival times rewritten anyway), the
     appointments now later than the moment told. Its answer has no rows, like the real one: the screen pulls.
   - With the switch on, the demo's suggestions (suggest_blocks, suggest_windows, by blocks or by windows) carry the new
     fields of the real ones (unmeasured, add_km null while a trip is not measured, day_km, rank, route; far null while
     unmeasured), and their driving (drive_min, add_min, day_min, hop_min, far, near) is counted with the measured times
     (the unknown time while not measured). By windows the new stop's arrival and window are counted with the measured
     trip too (setDriveTo). What the demo does NOT recount: by blocks, which moments are offered and their room left come
     from the demo's own pretend planner (agenda.ts), as before. rank and route are given only by windows: by blocks the
     real server leaves them null (the booking plans the other blocks again, so the order shown would not be the one
     booked: lead's decision F2, STATE 2026-11-20 15:25), and the app says nothing of the order.
   - The pretend re-plan (blocks) counts each vehicle from its own last stop of the day (the start first), and never moves
     nor re-times a stop under way (en route, on site): the vehicle goes on from it.
   Address switches: &routes=1 opens the demo with the switch on and everything measured; &tomtom=nokey | refuse | busy |
   over | down | missing pretends the server has no key, TomTom refuses it (403), is busy (429), the month's ceiling is
   reached, TomTom and OSRM are both down, or the function is not installed (404). installRoads() is called by demo.ts
   AFTER installWindows(), so it wraps the windows' operations too. */
import { registerRpc, registerFn, rpcOf, put, find, table, refuse, type DemoRow } from '../fake-server';
import { addDays, today, dow } from '../../lib/dates';
import { HOME, km, pointOf, renumber } from './agenda';
import { windowsOn, replanDay, setDriveTo } from '../demo-windows';

export type Pt = { lat: number; lng: number };
type Mode = 'ok' | 'nokey' | 'refuse' | 'busy' | 'over' | 'down' | 'missing';
interface Time { min: number; km: number; source: 'tomtom' | 'osrm' }
const BLOCKS: Record<string, [number, number]> = { am: [480, 720], pm: [720, 960], eve: [960, 1200] };
const POS: Record<string, number> = { am: 0, pm: 1, eve: 2, day: 0 };
/** the days the demo measures (the real one: horizon_days) */
export const DEMO_DAYS = 14;
/** what one pretend call measures at most (the real one: 60 requests or ~40 s) */
export const PER_CALL = 24;

/* ---------- the pretend road table ---------- */
const t0 = new Map<string, Time>();         // usual hours
const rush = new Map<string, [number, number]>();   // morning, late afternoon (TomTom only)
const spent = { month: '', tx: 0, requests: 0 };
const original = new Map<string, number | null>();    // travel_min before the real roads (put back when switched off)

export const placeKey = (p: Pt) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
const pairKey = (a: Pt, b: Pt) => `${placeKey(a)}>${placeKey(b)}`;
const booking = () => ((find('settings', '1')?.booking || {}) as Record<string, unknown>);
const num = (v: unknown, d: number) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);
export const roadsOnDemo = () => booking().roads_on === true;
const rushOn = () => booking().roads_rush !== false;
const unknownMin = () => num(booking().unknown_min, 20);
const stopMin = () => num(booking().stop_min, 5);
const me = () => (globalThis as { __demoUser?: string }).__demoUser || 'u-hassan';
const roles = () => ((find('staff', me())?.roles as string[]) || []);
export function mode(): Mode {
  const m = /[?&]tomtom=(\w+)/.exec(typeof location === 'undefined' ? '' : location.search)?.[1];
  return (['nokey', 'refuse', 'busy', 'over', 'down', 'missing'] as const).find((x) => x === m) ?? 'ok';
}
/** the made-up road of the demo (no network): road km = 1.4 × the distance, 28 km/h in town + 2 min to leave; a pair is
    a little longer one way than the other; rush hours slower (morning × 1.5, late afternoon × 1.7) */
export function pretend(a: Pt, b: Pt): { min: number; km: number; am: number; pm: number } {
  const d = km(a, b) * 1.4;
  const min = Math.max(3, Math.round((d / 28) * 60 + 2 + (a.lng < b.lng ? 1 : 0)));
  return { min, km: Math.round(d * 10) / 10, am: Math.round(min * 1.5), pm: Math.round(min * 1.7) };
}
const live = (j: DemoRow) => !j.deleted_at && ['booked', 'en_route', 'on_site'].includes(String(j.status));
/** the places of one day: the start and every appointment with a position */
function placesOf(day: string): Pt[] {
  const pts = table('jobs').filter((j) => j.day === day && live(j)).map(pointOf).filter(Boolean) as Pt[];
  const seen = new Set<string>([placeKey(HOME)]);
  const out: Pt[] = [HOME];
  for (const p of pts) if (!seen.has(placeKey(p))) { seen.add(placeKey(p)); out.push(p); }
  return out;
}
const weekday = (day: string) => { const d = dow(day); return d >= 1 && d <= 5; };
interface Pair { a: Pt; b: Pt; key: string; extra: boolean }
/** what is missing (as drive_wanted): usual-hours pairs with no time, then rush pairs (working days, rush on, ≥ 15 min) */
export function wanted(point: Pt | null = null, from = today(), days = DEMO_DAYS): { slot0: Pair[]; rush: Pair[] } {
  const s0 = new Map<string, Pair>(), sr = new Map<string, Pair>();
  const add = (a: Pt, b: Pt, extra: boolean, work: boolean) => {
    if (placeKey(a) === placeKey(b)) return;
    const key = pairKey(a, b);
    const tm = t0.get(key);
    if (!tm) { if (!s0.has(key) || extra) s0.set(key, { a, b, key, extra }); return; }
    if (work && rushOn() && tm.min >= 15 && !rush.has(key)) sr.set(key, { a, b, key, extra });
  };
  const start = from < today() ? today() : from;
  for (let i = 0; i < Math.max(1, Math.min(DEMO_DAYS, days)); i++) {
    const day = addDays(start, i);
    const ps = placesOf(day);
    const work = weekday(day);
    if (point) for (const p of ps) { add(point, p, true, work); add(p, point, true, work); }
    if (ps.length < 2) continue;
    for (const a of ps) for (const b of ps) if (a !== b && !(a === HOME && b === HOME)) add(a, b, false, work);
  }
  const first = (m: Map<string, Pair>) => [...m.values()].sort((x, y) => Number(y.extra) - Number(x.extra));
  return { slot0: first(s0), rush: first(sr) };
}
export function left(): { left: number; left0: number } {
  const w = wanted();
  return { left: w.slot0.length + w.rush.length, left0: w.slot0.length };
}
const monthNow = () => today().slice(0, 7) + '-01';
function spend(): { month: string; tx: number; cap: number } {
  if (spent.month !== monthNow()) Object.assign(spent, { month: monthNow(), tx: 0, requests: 0 });
  return { month: spent.month, tx: spent.tx, cap: Math.max(0, num(booking().roads_month_tx, 10000)) };
}
/** the trip as the planner counts it: measured minutes (the rush one at the rush hours), else unknown */
export function tripOf(a: Pt | null, b: Pt | null, day: string, at: number | null = null): { min: number; km: number | null; measured: boolean } {
  if (!a || !b) return { min: unknownMin(), km: null, measured: false };
  if (placeKey(a) === placeKey(b)) return { min: 0, km: 0, measured: true };
  const key = pairKey(a, b);
  const tm = t0.get(key);
  if (!tm) return { min: unknownMin(), km: null, measured: false };
  const r = rush.get(key);
  if (r && at != null && rushOn() && weekday(day)) {
    if (at >= 390 && at < 570) return { min: r[0], km: tm.km, measured: true };
    if (at >= 900 && at < 1110) return { min: r[1], km: tm.km, measured: true };
  }
  return { min: tm.min, km: tm.km, measured: true };
}

/* ---------- measuring (the pretend « drive ») ---------- */
interface Round { stored: number; tomtom: string; osrm: string; more: boolean }
/** measures what is missing, the point's trips first; `only`: the point's usual-hours trips and nothing else */
function measure(point: Pt | null, from: string, days: number, only: boolean, max = PER_CALL): Round {
  const m = mode();
  const w = wanted(point, from, days);
  const todo0 = (only ? w.slot0.filter((p) => p.extra) : w.slot0).slice(0, max);
  const s = spend();
  const tomtomUsable = m === 'ok' && s.tx + todo0.length <= s.cap;
  const tomtom = m === 'nokey' ? 'no_key' : m === 'refuse' ? 'refused' : m === 'busy' || m === 'down' ? 'busy' : m === 'over' || (m === 'ok' && !tomtomUsable) ? 'over_budget' : 'ok';
  const osrm = m === 'down' ? 'down' : tomtom === 'ok' ? 'unused' : 'ok';
  if (m === 'down') return { stored: 0, tomtom, osrm, more: false };
  let stored = 0;
  for (const p of todo0) {
    const r = pretend(p.a, p.b);
    t0.set(p.key, tomtom === 'ok' ? { min: r.min, km: r.km, source: 'tomtom' } : { min: Math.ceil(r.min * 1.2), km: r.km, source: 'osrm' });
    stored++;
  }
  if (tomtom === 'ok' && todo0.length) { spent.tx += todo0.length; spent.requests++; }
  let rushDone = 0;
  if (!only && tomtom === 'ok' && stored < max) {
    const again = wanted(point, from, days).rush.slice(0, max - stored);
    const cap = spend().cap;
    for (const p of again) {
      if (spent.tx + 2 > cap) break;   // the ceiling counted as it goes (drive_spend_add before each request)
      const r = pretend(p.a, p.b);
      rush.set(p.key, [r.am, r.pm]);
      spent.tx += 2; rushDone++;
    }
    if (rushDone) spent.requests++;
  }
  stored += rushDone;
  const after = wanted(point, from, days);
  const canRush = tomtom === 'ok' && spend().tx < spend().cap;
  const more = only ? false : (after.slot0.length > 0 || (canRush && after.rush.length > 0)) && stored >= max;
  return { stored, tomtom, osrm, more };
}

/* ---------- planning again with the measured times (the pretend roads_replan) ---------- */
interface Replan { planned: number; kept: { day: string; block: string }[]; late: string[] }
const told = (j: DemoRow) => (j.win_end != null ? Number(j.win_end) : BLOCKS[String(j.block)]?.[1] ?? 1200);
const lateNow = (j: DemoRow) => j.status === 'booked' && j.truck_id && j.eta_min != null && Number(j.eta_min) > told(j);
/** the coming days planned again: with the switch on, each stop's arrival = the end of the stop before + the measured trip */
export function replan(days?: string[]): Replan {
  const coming = table('jobs').filter((j) => !j.deleted_at && j.status === 'booked' && String(j.day) >= today());
  const list = days ?? [...new Set(coming.map((j) => String(j.day)))].sort();
  const before = new Set(coming.filter(lateNow).map((j) => j.id));
  const on = roadsOnDemo();
  let planned = 0;
  const kept: Replan['kept'] = [];
  for (const day of list) {
    if (windowsOn()) {
      if (!coming.some((j) => j.day === day)) continue;
      for (const j of table('jobs').filter((x) => x.day === day && x.block === 'day' && live(x))) setTravel(j, on ? null : undefined);
      // the windows' walk counts each stop's travel_min: written from the measured trips first
      if (on) for (const tid of new Set(table('jobs').filter((x) => x.day === day && live(x)).map((x) => x.truck_id))) {
        let prev: Pt | null = HOME;
        for (const j of table('jobs').filter((x) => x.day === day && x.truck_id === tid && live(x)).sort((a, b) => Number(a.stop_order ?? 99) - Number(b.stop_order ?? 99))) {
          const here = pointOf(j);
          put('jobs', { id: j.id, travel_min: tripOf(prev, here, day, j.eta_min == null ? null : Number(j.eta_min)).min });
          prev = here ?? prev;
        }
      }
      replanDay(day);
      planned++;
      continue;
    }
    // each vehicle's last stop so far that day: its next block leaves from there (the start before its first stop)
    const lastAt = new Map<string, Pt>();
    // the stops under way first (they never move), then the others in their order
    const ofTruck = (js: DemoRow[], tid: unknown) => js.filter((j) => j.truck_id === tid)
      .sort((a, b) => Number(a.status === 'booked') - Number(b.status === 'booked') || Number(a.stop_order ?? 99) - Number(b.stop_order ?? 99));
    const remember = (js: DemoRow[]) => {
      for (const tid of new Set(js.map((j) => j.truck_id))) {
        const p = ofTruck(js, tid).map(pointOf).filter(Boolean).pop();
        if (tid && p) lastAt.set(String(tid), p);
      }
    };
    for (const block of ['am', 'pm', 'eve']) {
      const js = table('jobs').filter((j) => j.day === day && j.block === block && live(j));
      if (!js.some((j) => j.status === 'booked')) { remember(js); continue; }
      if (!on) { for (const j of js) setTravel(j, undefined); renumber(day, block); planned++; continue; }
      let over = false;
      for (const tid of new Set(js.map((j) => j.truck_id))) {
        if (!tid) continue;
        const stops = ofTruck(js, tid);
        let tm = BLOCKS[block][0], prev: Pt | null = lastAt.get(String(tid)) ?? HOME;
        stops.forEach((j, i) => {
          const here = pointOf(j);
          if (j.status !== 'booked') {
            // en route / on site: neither moved nor re-timed (the real planner); the vehicle goes on from there
            const at = j.eta_min == null ? tm : Number(j.eta_min);
            tm = Math.max(tm, at + stopMin() + num(j.duration_min, 60));
            prev = here ?? prev;
            return;
          }
          const trip = tripOf(prev, here, day, tm);
          setTravel(j, null);
          const eta = tm + trip.min;
          put('jobs', { id: j.id, stop_order: i + 1, eta_min: eta, travel_min: trip.min });
          tm = eta + stopMin() + num(j.duration_min, 60);
          prev = here ?? prev;
        });
        if (tm > BLOCKS[block][1]) over = true;
        if (prev) lastAt.set(String(tid), prev);
      }
      // the trips no longer fit: the real planner keeps the block as it was (arrival times rewritten): « kept »
      if (over) kept.push({ day, block }); else planned++;
    }
  }
  const late = table('jobs').filter((j) => !j.deleted_at && list.includes(String(j.day)) && lateNow(j) && !before.has(j.id)).map((j) => j.id);
  return { planned, kept, late };
}
/** null: keep what was there before the real roads (once); undefined: put it back */
function setTravel(j: DemoRow, what: null | undefined) {
  if (what === null) { if (!original.has(j.id)) original.set(j.id, j.travel_min == null ? null : Number(j.travel_min)); return; }
  if (original.has(j.id)) { put('jobs', { id: j.id, travel_min: original.get(j.id) }); original.delete(j.id); }
}

/* ---------- the suggestions with the switch on ---------- */
/** to: the drive to the new stop (from the stop before it in the walk) */
interface Walk { min: number; km: number | null; unmeasured: number; rank: number; route: string[]; hop: number | null; to: number | null }
/** one truck's day walked with the stop `here` at `at` (null: without it), from the start and back */
export function walkDay(day: string, stops: { id: string; at: Pt | null; dur: number; block: string }[], here: Pt | null, at: number | null, block = '', dur = 60): Walk {
  const seq = at == null || !here ? stops : [...stops.slice(0, at), { id: 'new', at: here, dur, block }, ...stops.slice(at)];
  let min = 0, kmSum = 0, unm = 0, prev: Pt | null = HOME, tm = BLOCKS.am[0], hop: number | null = null;
  const legs: number[] = [];
  for (const s of [...seq, { id: '', at: HOME, dur: 0, block: '' }]) {
    // a block's first stop: the truck leaves when the block starts
    if (BLOCKS[s.block] && tm < BLOCKS[s.block][0]) tm = BLOCKS[s.block][0];
    const trip = tripOf(prev, s.at, day, tm);
    min += trip.min; legs.push(trip.min);
    if (trip.km == null) unm++; else kmSum += trip.km;
    tm += trip.min + stopMin() + s.dur;
    prev = s.at ?? prev;
  }
  const r = seq.findIndex((s) => s.id === 'new');
  if (r >= 0) hop = Math.max(legs[r], legs[r + 1]);
  return { min, km: unm ? null : Math.round(kmSum * 10) / 10, unmeasured: unm, rank: r + 1, route: seq.map((s) => s.id), hop, to: r >= 0 ? legs[r] : null };
}
type Row = Record<string, unknown> & { day: string; block: string; truck: string };
function truckStops(day: string, truck: string, exclude: string | null) {
  return table('jobs').filter((j) => j.truck_id === truck && j.day === day && j.id !== exclude && live(j))
    .sort((x, y) => POS[String(x.block)] - POS[String(y.block)] || Number(x.stop_order ?? 99) - Number(y.stop_order ?? 99) || Number(x.eta_min ?? 9999) - Number(y.eta_min ?? 9999))
    .map((j) => ({ id: j.id, at: pointOf(j), dur: num(j.duration_min, 60), block: String(j.block), eta: j.eta_min == null ? null : Number(j.eta_min) }));
}
/** the row of a suggestion with the real-road fields (CONTRACT §2.4), counted with the measured times; rank / route only by
    windows (block 'day'), null by blocks (F2) */
export function withRoads(row: Row, a: Record<string, unknown>): Row {
  const here = a.p_lat != null && a.p_lng != null ? { lat: Number(a.p_lat), lng: Number(a.p_lng) } : null;
  const stops = truckStops(row.day, row.truck, (a.p_exclude as string) || null);
  const dur = num(a.p_duration, 60);
  const base = walkDay(row.day, stops, null, null);
  let best: Walk;
  if (row.block === 'day') {
    // by windows: the new stop goes where its arrival falls
    const eta = Number(row.eta ?? 0);
    const at = stops.filter((s) => s.eta != null && s.eta <= eta).length;
    best = walkDay(row.day, stops, here, at, 'day', dur);
  } else {
    const lo = stops.filter((s) => POS[s.block] < POS[row.block]).length, hi = stops.filter((s) => POS[s.block] <= POS[row.block]).length;
    best = walkDay(row.day, stops, here, lo, row.block, dur);
    for (let at = lo + 1; at <= hi; at++) { const w = walkDay(row.day, stops, here, at, row.block, dur); if (w.min < best.min) best = w; }
  }
  const bk = booking();
  const maxHop = num(bk.max_hop_min, 35), maxDay = num(bk.max_day_drive_min, 105), nearMin = num(bk.near_min, 10);
  const near = here ? table('jobs').filter((j) => j.day === row.day && (row.block === 'day' || j.block === row.block) && j.id !== a.p_exclude && live(j))
    .filter((j) => { const p = pointOf(j); if (!p) return false; const x = tripOf(here, p, row.day), y = tripOf(p, here, row.day); return (x.measured && x.min <= nearMin) || (y.measured && y.min <= nearMin); }).length : 0;
  const unmeasured = best.unmeasured;
  const far = unmeasured > 0 ? null : maxHop > 0 && best.hop != null && best.hop > maxHop ? 'hop' : maxDay > 0 && stops.length > 0 && best.min > maxDay ? 'day' : null;
  const addKm = unmeasured > 0 || base.km == null || best.km == null ? null : Math.round(Math.max(0, best.km - base.km) * 10) / 10;
  return {
    ...row, ...(best.to != null ? { drive_min: best.to } : {}), near, unmeasured, add_min: Math.max(0, best.min - base.min), add_km: addKm, day_min: best.min, day_km: best.km,
    hop_min: stops.length ? best.hop : null, stops: stops.length, far,
    rank: row.block === 'day' ? best.rank : null, route: row.block === 'day' ? best.route : null
  };
}

/* ---------- the pretend operations ---------- */
function drive(b: Record<string, unknown>): Record<string, unknown> {
  const m = mode();
  if (m === 'missing') return { ok: false, code: 'NOT_FOUND', error: 'Requested function was not found' };
  const action = String(b.action || '');
  const state = () => ({ ...left(), spent: spend() });
  if (action === 'status') {
    const rows = { tomtom: [...t0.values()].filter((x) => x.source === 'tomtom').length, osrm: [...t0.values()].filter((x) => x.source === 'osrm').length, none: 0 };
    return { ok: true, key: m !== 'nokey', on: roadsOnDemo(), ...left(), month: spend(), rows };
  }
  if (action === 'sweep') {
    if (!roles().some((r) => r === 'owner' || r === 'office')) return { ok: false, code: 'not_allowed', error: 'Seuls le propriétaire et le bureau mesurent les routes.' };
    const r = measure(null, today(), DEMO_DAYS, false);
    const rep = r.stored && roadsOnDemo() ? replan() : { planned: 0, kept: [], late: [] };
    const s = state();
    return { ok: true, ready: s.left0 === 0, left: s.left, left0: s.left0, stored: r.stored, ...rep, no_road: 0, tomtom: r.tomtom, osrm: r.osrm, spent: s.spent, more: r.more };
  }
  if (action === 'warm') {
    const p = b.point as Partial<Pt> | undefined;
    if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return { ok: false, code: 'bad_point', error: 'Position manquante.' };
    if (km(HOME, p as Pt) > 150) return { ok: false, code: 'far', error: 'Cette adresse est trop loin du garage.' };
    const from = typeof b.from === 'string' ? b.from : today(), days = num(b.days, 14);
    const only = b.only === 'point';
    const r = measure(p as Pt, from, days, only, only ? 200 : PER_CALL);
    const mine = wanted(p as Pt, from, days).slot0.filter((x) => x.extra).length;
    const rep = !only && r.stored && roadsOnDemo() ? replan() : { planned: 0, kept: [], late: [] };
    const s = state();
    return { ok: true, ready: mine === 0, left: s.left, left0: s.left0, stored: r.stored, ...rep, no_road: 0, tomtom: r.tomtom, osrm: r.osrm, spent: s.spent, more: r.more };
  }
  return { ok: false, code: 'bad_action', error: 'Action inconnue.' };
}

function roadsSwitch(a: Record<string, unknown>) {
  if (!roles().includes('owner')) refuse('not_allowed', 'Seul le propriétaire change la façon de compter la route.');
  if (typeof a.p_on !== 'boolean') refuse('bad_mode', 'Choisis : les vraies routes, ou l’estimation.');
  const on = a.p_on;
  if (on === roadsOnDemo()) return { ok: true, unchanged: true, on, planned: 0, kept: [], late: [] };
  if (on) {
    const n = left().left0;
    if (n > 0) refuse('roads_cold', `Il reste ${n} trajets à mesurer avant d’allumer les vraies routes. Réessaie dans un instant.`);
  }
  put('settings', { id: '1', booking: { ...booking(), roads_on: on } });
  return { ok: true, on, ...replan() };
}

/** the sections' operations are registered by load() (the glob of demo.ts) */
export function load() {
  try {
    registerFn('drive', (b) => drive(b || {}));
    registerRpc('roads_switch', (a) => roadsSwitch(a || {}));
  } catch (e) { console.warn('demo-extra/roads', e); }
}

/** after installWindows (demo.ts): the suggestions carry the real-road fields while the switch is on; &routes=1 */
export function installRoads() {
  const wrap = (name: string) => {
    const before = rpcOf(name);
    if (!before) return;
    const after = (a: Record<string, unknown>, out: unknown) => {
      if (!roadsOnDemo() || !Array.isArray(out)) return out;
      const list = (out as Row[]).filter((r) => r && typeof r === 'object' && typeof r.day === 'string' && typeof r.truck === 'string').map((r) => withRoads(r, a));
      // the server's order: the moments not far first, then the least driving added
      if (name === 'suggest_blocks') list.sort((x, y) => Number(!!x.far) - Number(!!y.far) || Number(x.add_min) - Number(y.add_min) || Number(y.near) - Number(x.near) || x.day.localeCompare(y.day) || POS[x.block] - POS[y.block]);
      return list;
    };
    // the same answer as the operation wrapped: at once when it answers at once
    registerRpc(name, (a) => {
      const out = before(a);
      return out instanceof Promise ? out.then((o) => after(a, o)) : after(a, out);
    });
  };
  wrap('suggest_blocks');
  wrap('suggest_windows');
  // by windows, the new stop's drive (its arrival, its window) with the measured trips while the switch is on
  setDriveTo((day, here, from) => (!roadsOnDemo() ? null : here ? Math.min(...from.map((p) => tripOf(p, here, day).min)) : unknownMin()));
  try {
    if (/[?&]routes(=1|=on)?(&|$)/.test(location.search)) {
      for (let i = 0; i < 40 && left().left > 0; i++) if (!measure(null, today(), DEMO_DAYS, false, 500).stored) break;
      put('settings', { id: '1', booking: { ...booking(), roads_on: true } });
      replan();
    }
  } catch (e) { console.warn('demo: vraies routes', e); }
}

/** tests only: the pretend table emptied */
export function resetRoadsDemo() { t0.clear(); rush.clear(); original.clear(); Object.assign(spent, { month: '', tx: 0, requests: 0 }); }
