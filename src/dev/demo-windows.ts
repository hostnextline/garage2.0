/* DEV ONLY — « Plages d'arrivée » (Part 25) in the demo: the pretend server knows the window mode.
   - ?demo=owner&fenetres=1 opens the demo with the mode already on (the coming pretend appointments converted, a few
     examples: windows that follow no block, « flexible » ones, one « hors plage » on today's route).
   - Réglages → Réservations switches it on and off like the real thing (windows_switch), « Fixer les plages de demain »
     (lock_windows), and the booking operations take and give windows while the mode is on.
   While the mode is off every operation goes to the pretend operation that was there before: the block demo is unchanged.
   installWindows() is called by demo.ts AFTER the sections' own operations (demo-extra) are registered, so it wraps them.
   « exact move » (STATE.md S2–S7, A6): move_job's 8th argument `p_exact` { at, late_ok } and move_preview(p_job, p_day,
   p_truck, p_at): the job slips into its truck's day where that minute falls and arrives AT it, every other stop keeps
   its order and is held « not before its stored arrival » (pushed later only when the truck cannot keep it: said), the
   day it left keeps its order and times; somebody late not accepted → late_changed; the truck cannot be there →
   arrive_late (the preview says the earliest). Later plans of the demo keep the pinned minute (S6: a window of one
   minute); a move without p_exact, an order by hand and the windows switched off clear it (S7).
   « Réserver à l'heure choisie » (Part 30, K1, K2): book_job with p_job.arrive_at (+ truck_id, late_ok) and
   book_preview(p_job, p_items): the new appointment goes AT that minute on the vehicle asked (else the one where nobody is
   made late, the car first), with the exact move's own placing (exactPlan); somebody late (or past the hours) not accepted →
   late_changed; forcing is the owner's and the office's (not_allowed else); the truck cannot be there → arrive_late (the
   preview throws it too, with the earliest minute). */
import { registerRpc, rpcOf, put, find, table, rows, refuse, nowIso, type DemoRow } from './fake-server';
import { addDays, today, nowMinute, windowFor } from '../lib/dates';
import { rangesOf, renumber, km, pointOf, HOME } from './demo-extra/agenda';
import { can, myTruckIds, need } from './demo-rules';
import { order, walk, choices, fits, type Stop, type Choice } from './demo-plan';

type Win = [number, number];
const OLD = ['am', 'pm', 'eve'];
const LOCK_HOUR = 18 * 60;
const me = () => (globalThis as { __demoUser?: string }).__demoUser || 'u-hassan';
const roles = () => ((find('staff', me())?.roles as string[]) || []);
const booking = () => ((find('settings', '1')?.booking || {}) as Record<string, unknown>);
export const windowsOn = () => booking().windows_on === true;
const blocksOf = () => ((booking().blocks as { key: string; start: number; end: number }[] | undefined)?.length
  ? (booking().blocks as { key: string; start: number; end: number }[]) : [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }]);
const span = (): Win => [Math.min(...blocksOf().map((b) => b.start)), Math.max(...blocksOf().map((b) => b.end))];
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v != null ? Number(v) : d);
const winLen = () => num(booking().win_before_min, 60) + num(booking().win_after_min, 180);
const winOf = (eta: number): Win => {
  const [d0, d1] = span();
  return windowFor(eta, { before: num(booking().win_before_min, 60), after: num(booking().win_after_min, 180), round: num(booking().win_round_min, 60), dayStart: d0, dayEnd: d1 });
};
const live = (j: DemoRow) => !j.deleted_at && !['cancelled', 'no_show'].includes(String(j.status));
const dayJobs = (day: string, truck: string, exclude?: string | null) =>
  table('jobs').filter((j) => j.day === day && j.block === 'day' && j.truck_id === truck && live(j) && j.id !== exclude)
    .sort((a, b) => Number(a.stop_order ?? 99) - Number(b.stop_order ?? 99) || String(a.created_at).localeCompare(String(b.created_at)));
/** when a truck may drive that day: its hours inside the booking day, from now on today; null: it does not work */
function truckDay(truck: string, day: string): { start: number; end: number } | null {
  const rs = rangesOf(truck, day).filter(([a, b]) => b > a);
  if (!rs.length || day < today()) return null;
  const [d0, d1] = span();
  const start = Math.max(d0, Math.min(...rs.map((r) => r[0])), day === today() ? nowMinute() : 0);
  const end = Math.min(d1, Math.max(...rs.map((r) => r[1])));
  return end - start >= 45 ? { start, end } : null;
}
const toStop = (j: DemoRow, start: number): Stop => ({
  id: j.id, dur: Number(j.duration_min) || 60, travel: Number(j.travel_min ?? 18),
  // « exact move » (S6): a minute pointed by hand is a window of one minute for every later plan
  win: j.arrive_at != null ? [Number(j.arrive_at), Number(j.arrive_at)] : j.win_start != null && j.win_end != null ? [Number(j.win_start), Number(j.win_end)] : null,
  fixedEta: j.status === 'booked' ? null : Number(j.eta_min ?? start), manual: j.manual_order == null ? null : Number(j.manual_order), forced: j.forced === true
});

/** the pretend planner: every truck's stops of a day in order, with their arrival times */
export function replanDay(day: string): DemoRow[] {
  if (day < today()) return [];
  const out: DemoRow[] = [];
  const js = table('jobs').filter((j) => j.day === day && j.block === 'day' && live(j));
  for (const tid of new Set(js.map((j) => j.truck_id))) {
    if (!tid) continue;
    const td = truckDay(String(tid), day) || { start: Math.max(span()[0], day === today() ? nowMinute() : 0), end: span()[1] };
    const seq = order(dayJobs(day, String(tid)).map((j) => toStop(j, td.start)), td.start);
    walk(seq, td.start).forEach((p, i) => out.push(put('jobs', { id: p.id, stop_order: i + 1, eta_min: p.eta })));
  }
  return out;
}

interface Offer { truck: string; choice: Choice; drive: number; near: number; left: number }
/** the windows still possible for one more stop that day, over every truck that works, the best first */
function offers(day: string, dur: number, here: { lat: number; lng: number } | null, wanted: string | null, exclude: string | null): Offer[] {
  const out: Offer[] = [];
  for (const tr of table('trucks').filter((x) => x.active && !x.deleted_at && (!wanted || x.id === wanted))) {
    const td = truckDay(tr.id, day);
    if (!td) continue;
    const js = dayJobs(day, tr.id, exclude);
    const pts = js.map(pointOf).filter(Boolean) as { lat: number; lng: number }[];
    const drive = driveTo?.(day, here, [HOME, ...pts]) ?? (here ? Math.max(5, Math.ceil((Math.min(km(HOME, here), ...pts.map((q) => km(q, here))) * 1.3) / 35 * 60)) : 18);
    const near = here ? pts.filter((q) => km(q, here) <= 5).length : 0;
    const seq = order(js.map((j) => toStop(j, td.start)), td.start);
    for (const c of choices(seq, { id: 'new', dur, travel: drive }, td.start, td.end, winOf)) out.push({ truck: tr.id, choice: c, drive, near, left: Math.max(0, td.end - c.end) });
  }
  return out.sort((a, b) => (a.drive + a.choice.wait) - (b.drive + b.choice.wait) || b.near - a.near || a.choice.eta - b.choice.eta);
}
/** the drive to a new stop that day: null = the demo's own estimate (below); demo-extra/roads.ts sets it so that, the real
    roads on, it is the measured trip from the nearest place of the day (the unknown time while not measured), never the
    straight line */
type DriveTo = (day: string, here: { lat: number; lng: number } | null, from: { lat: number; lng: number }[]) => number | null;
let driveTo: DriveTo | null = null;
export function setDriveTo(fn: DriveTo | null) { driveTo = fn; }
const rowOf = (day: string, o: Offer) => ({ day, block: 'day', pos: 0, drive_min: o.drive, near: o.near, truck: o.truck, left: o.left, eta: o.choice.eta, win_start: o.choice.win[0], win_end: o.choice.win[1] });
/** one row per window (the best truck for each) */
function distinct(list: Offer[]): Offer[] {
  const seen = new Set<number>();
  return list.filter((o) => (seen.has(o.choice.win[0]) ? false : (seen.add(o.choice.win[0]), true)));
}

interface Placed { truck: string; win: Win | null; flex: boolean; forced: boolean }
/** where a booking goes: the window asked for (refused when it can no longer be kept), « flexible », or the best window */
function placeFor(day: string, dur: number, here: { lat: number; lng: number } | null, wanted: string | null, exclude: string | null, ask: { start: number | null; flex: boolean; force: boolean }): Placed {
  if (day < today()) refuse('block_started', 'Cette journée est passée : choisis une autre journée.');
  const working = table('trucks').filter((x) => x.active && !x.deleted_at && truckDay(x.id, day) && (!wanted || x.id === wanted));
  if (!working.length) refuse(wanted ? 'truck_full' : 'block_closed', wanted ? 'Ce véhicule ne travaille pas cette journée-là.' : 'Cette journée est fermée : personne ne travaille.');
  const all = offers(day, dur, here, wanted, exclude);
  const last = (): Placed => ({ truck: (all[0]?.truck || working[0].id), win: ask.start != null ? [ask.start, ask.start + winLen()] : null, flex: false, forced: true });
  if (ask.start != null) {
    const win: Win = [ask.start, ask.start + winLen()];
    const ok = working.find((tr) => {
      const td = truckDay(tr.id, day)!;
      return fits(dayJobs(day, tr.id, exclude).map((j) => toStop(j, td.start)), { id: 'new', dur, travel: 18, win }, td.start, td.end);
    });
    if (ok) return { truck: ok.id, win, flex: false, forced: false };
    if (ask.force) return last();
    refuse('window_full', 'Cette plage n’est plus possible : la route ne permet plus d’arriver à temps. Choisis une autre plage.');
  }
  if (!all.length) {
    if (ask.force) return last();
    refuse('block_full', 'Cette journée est complète : la route ne rentre plus dans le temps. Choisis une autre journée.');
  }
  return ask.flex ? { truck: all[0].truck, win: null, flex: true, forced: false } : { truck: all[0].truck, win: all[0].choice.win, flex: false, forced: false };
}
/** after the plan: a forced stop with no window gets the one of its arrival; a flexible stop booked for today, or for
    tomorrow after the evening's lock, gets its window at once */
function settle(id: string) {
  const j = find('jobs', id);
  if (!j || j.win_start != null || j.eta_min == null) return;
  const soon = j.day === today() || (j.day === addDays(today(), 1) && nowMinute() >= LOCK_HOUR);
  if (j.win_flex === true && !soon) return;
  const w = winOf(Number(j.eta_min));
  put('jobs', { id: j.id, win_start: w[0], win_end: w[1] });
}
const hereOf = (j: DemoRow) => pointOf(j);

/** block → windows (the old block's hours ARE what those customers were told) or back; today's and coming jobs only */
export function convert(on: boolean): DemoRow[] {
  const coming = table('jobs').filter((j) => !j.deleted_at && String(j.day) >= today());
  const days = new Set<string>();
  const changed: DemoRow[] = [];
  if (on) {
    for (const j of coming.filter((x) => OLD.includes(String(x.block)))) {
      const b = blocksOf().find((x) => x.key === j.block);
      changed.push(put('jobs', { id: j.id, block: 'day', win_start: b?.start ?? null, win_end: b?.end ?? null, win_flex: false }));
      days.add(String(j.day));
    }
    for (const d of days) replanDay(d);
  } else {
    const holds = (m: unknown) => (m == null ? undefined : blocksOf().find((b) => Number(m) >= b.start && Number(m) < b.end)?.key);
    for (const j of coming.filter((x) => x.block === 'day')) {
      changed.push(put('jobs', { id: j.id, block: holds(j.eta_min) || holds(j.win_start) || 'am', win_start: null, win_end: null, win_flex: false, manual_order: null, arrive_at: null }));
      days.add(String(j.day));
    }
    for (const d of days) for (const b of OLD) renumber(d, b);
  }
  return changed;
}

/** the examples of ?fenetres=1 (each only if the pretend job is there: the demo's week depends on today's weekday) */
function examples() {
  const set = (id: string, patch: Record<string, unknown>) => { if (find('jobs', id)?.block === 'day') put('jobs', { id, ...patch }); };
  const len = winLen();
  // windows that follow no block
  set('j-t2', { win_start: 780, win_end: 780 + len });
  set('j-w9', { win_start: 540, win_end: 540 + len });
  set('j-w11', { win_start: 840, win_end: 840 + len });
  // « flexible »: free all day, the window comes the evening before (one tomorrow, for « Fixer les plages de demain »)
  set('j-w3', { win_start: null, win_end: null, win_flex: true });
  set('j-w6', { win_start: null, win_end: null, win_flex: true });
  // « hors plage » on today's route: told the morning, booked « quand même », so it goes after the other stops
  set('j-5', { win_start: span()[0], win_end: span()[0] + len, forced: true });
  for (let n = 0; n <= 7; n++) replanDay(addDays(today(), n));
}

/* ---------- « exact move » (S2–S5) ---------- */
const FAR = 24 * 60;
interface ExactPlan {
  truck: string; at: number; order: DemoRow[]; eta: Map<string, number>; late: string[]; overHours: number;
  earliest: number | null; earliestKeep: number | null; placed: boolean; stops: Record<string, unknown>[]; left: DemoRow[]
}
/** where a job pointed at `at` goes in its truck's day (nothing written): every place after the stops already under way
    is walked, each other stop held « not before its stored arrival », the job « not before at »; kept: the places where
    it arrives AT that minute, the fewest late, then the least delay. None: placed false, with the earliest minute over
    the places and the earliest of a place where nobody's time changes. */
function exactPlan(j: DemoRow, day: string, truck: string, at: number): ExactPlan {
  const td = truckDay(truck, day)!;
  const others = dayJobs(day, truck, j.id);
  const stored = new Map(others.map((o) => [o.id, o.eta_min == null ? null : Number(o.eta_min)]));
  const held = (o: DemoRow): Stop => {
    const st = toStop(o, td.start);
    const was = stored.get(o.id);
    return o.status !== 'booked' || st.fixedEta != null ? st : { ...st, win: [Math.max(st.win?.[0] ?? 0, was ?? 0), FAR] };
  };
  const head = others.filter((o) => o.status !== 'booked').length;
  const me: Stop = { id: j.id, dur: Number(j.duration_min) || 60, travel: Number(j.travel_min ?? 18), win: [at, FAR] };
  // the server's rule (exact.sql exact_view, review F4): its limit is the minute pinned by hand, else its window's end;
  // late = past that limit AND made so by this move or later than before (a stop already late, untouched: not « late »)
  const lim = (o: DemoRow) => (o.arrive_at != null ? Number(o.arrive_at) : o.win_end == null ? null : Number(o.win_end));
  const lateBy = (o: DemoRow, before: number | null, after: number | null) => {
    const l = lim(o);
    if (l == null || after == null || after <= l) return 0;
    return before == null || before <= l || after > before ? after - l : 0;
  };
  let best: { seq: DemoRow[]; eta: Map<string, number>; late: string[]; delay: number; end: number } | null = null;
  let earliest: number | null = null, earliestKeep: number | null = null;
  for (let pos = head; pos <= others.length; pos++) {
    const seq = [...others.slice(0, pos), j, ...others.slice(pos)];
    const walked = walk(seq.map((o) => (o.id === j.id ? me : held(o))), td.start);
    const eta = new Map(walked.map((w) => [w.id, w.eta]));
    const mine = eta.get(j.id)!;
    const delay = others.reduce((m, o) => m + Math.max(0, eta.get(o.id)! - (stored.get(o.id) ?? eta.get(o.id)!)), 0);
    earliest = earliest == null ? mine : Math.min(earliest, mine);
    if (delay === 0) earliestKeep = earliestKeep == null ? mine : Math.min(earliestKeep, mine);
    if (mine !== at) continue;
    const late = others.filter((o) => o.status === 'booked' && lateBy(o, stored.get(o.id) ?? null, eta.get(o.id)!) > 0).map((o) => o.id);
    const end = seq.reduce((m, o) => Math.max(m, eta.get(o.id)! + (Number(o.duration_min) || 60)), td.start);
    if (!best || late.length < best.late.length || (late.length === best.late.length && delay < best.delay)) best = { seq, eta, late, delay, end };
  }
  // the day it left (another day or another truck): its stops keep their order and their times, the hole closed
  const from = String(j.day), fromTruck = String(j.truck_id ?? '');
  const left = from !== day || fromTruck !== truck ? dayJobs(from, fromTruck, j.id) : [];
  const wB = (o: DemoRow) => winOf(Number(o.eta_min ?? at));
  const row = (o: DemoRow, dayOf: string, truckOf: string, after: number | null, orderAfter: number) => {
    const before = o.eta_min == null ? null : Number(o.eta_min);
    const ws = o.id === j.id ? winOf(at)[0] : o.win_start == null ? wB(o)[0] : Number(o.win_start);
    const we = o.id === j.id ? winOf(at)[1] : o.win_end == null ? wB(o)[1] : Number(o.win_end);
    const lateMin = o.id !== j.id && o.status === 'booked' ? lateBy(o, before, after) : 0;
    return { id: o.id, day: dayOf, truck_id: truckOf, order_before: o.stop_order ?? null, order_after: orderAfter, eta_before: before, eta_after: after,
      win_start: ws, win_end: we, delay_min: before != null && after != null ? Math.max(0, after - before) : 0, late: lateMin > 0, late_min: lateMin, measured: null };
  };
  const stops = best
    ? [...best.seq.map((o, i) => row(o, day, truck, best!.eta.get(o.id)!, i + 1)), ...left.map((o, i) => row(o, from, fromTruck, o.eta_min == null ? null : Number(o.eta_min), i + 1))]
    : [];
  return { truck, at, order: best?.seq ?? [], eta: best?.eta ?? new Map(), late: best?.late ?? [], overHours: best ? Math.max(0, best.end - td.end) : 0,
    earliest: best ? null : earliest, earliestKeep: best ? null : earliestKeep, placed: !!best, stops, left };
}
/** the right of move_job and of the exact move on the server (« book », or a truck of mine for a job of my truck): the
    demo follows the database's rules (main's demo-rules; merge-main L-2) */
function mayMove(j: DemoRow, wanted: unknown) {
  const mine = myTruckIds();
  need(can('book') || (!!wanted && mine.includes(String(wanted)) && mine.includes(String(j.truck_id))), 'Tu ne peux pas déplacer ce rendez-vous.');
}
/** the checks every exact move and preview share: the job, the day, the truck it goes on (picked, else its own) */
function exactAsk(a: Record<string, unknown>, at: number): { j: DemoRow; day: string; truck: string } {
  const j = find('jobs', a.p_job);
  if (!j) refuse('not_found', 'Ce rendez-vous n’existe plus.');
  mayMove(j, a.p_truck);
  if (j.status !== 'booked') refuse('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.');
  const day = String(a.p_day);
  if (day < today()) refuse('block_started', 'Cette journée est passée : choisis une autre journée.');
  const [d0, d1] = span();
  if (!(at >= d0 && at < d1)) refuse('bad_window', 'Cette plage n’est pas dans les heures de la journée : choisis-en une autre.');
  const picked = (a.p_truck as string) || null;
  const truck = picked || String(j.truck_id ?? '');
  if (!truck || !truckDay(truck, day)) {
    if (picked) refuse('truck_full', 'Ce véhicule ne travaille pas cette journée-là.');
    refuse('pick_truck', 'Son camion ne travaille pas ce jour-là : choisis un camion qui travaille.');
  }
  return { j, day, truck };
}
const exactAnswer = (p: ExactPlan) => ({ exact: true, at: p.at, stops: p.stops, over_hours: p.overHours, earliest: p.earliest, earliest_keep: p.earliestKeep });
/** move_preview(p_job, p_day, p_truck, p_at): what that move would answer, nothing written (S5) */
function exactPreview(a: Record<string, unknown>) {
  const at = Number(a.p_at);
  if (!windowsOn()) return { exact: false, stops: [] };
  const { j, day, truck } = exactAsk(a, at);
  const p = exactPlan(j, day, truck, at);
  if (!p.placed) return { ok: false, code: 'arrive_late', exact: true, at, stops: [], over_hours: 0, earliest: p.earliest, earliest_keep: p.earliestKeep };
  // like the real one (« what move_job answers », S3): the TRIAL's rows too, newer than the real ones, written nowhere, so
  // ?demo shows that the app never takes them (review F0)
  const win = winOf(at), stamp = nowIso();
  const trial = p.order.map((o, i) => (o.id === j.id
    ? { ...o, day, block: 'day', truck_id: truck, truck_pinned: true, win_start: win[0], win_end: win[1], win_flex: false, arrive_at: at, eta_min: at, stop_order: i + 1, updated_at: stamp }
    : { ...o, eta_min: p.eta.get(o.id), stop_order: i + 1, updated_at: stamp }));
  return { ok: true, ...exactAnswer(p), rows: rows({ jobs: trial }) };
}
/** move_job with p_exact { at, late_ok } (S2, S4): written as the preview said, or refused */
function exactMove(a: Record<string, unknown>) {
  const ex = (a.p_exact || {}) as { at?: unknown; late_ok?: unknown };
  const at = Number(ex.at);
  const ok = new Set(Array.isArray(ex.late_ok) ? (ex.late_ok as unknown[]).map(String) : []);
  const { j, day, truck } = exactAsk(a, at);
  const p = exactPlan(j, day, truck, at);
  if (!p.placed) refuse('arrive_late', 'Le camion ne peut pas être là à cette heure-là : choisis une heure plus tard.');
  if (p.late.some((id) => !ok.has(id)) || (p.overHours > 0 && !ok.has(j.id))) refuse('late_changed', 'La journée a changé depuis la vérification : ce déplacement mettrait un autre client en retard. Déplace-le de nouveau pour voir qui.');
  const win = winOf(at);
  const before = { day: String(j.day), win_start: j.win_start ?? null, win_end: j.win_end ?? null, win_flex: j.win_flex === true };
  const tell = before.day !== day || before.win_start !== win[0] || before.win_end !== win[1] || before.win_flex;
  const changed: DemoRow[] = [];
  p.order.forEach((o, i) => {
    changed.push(put('jobs', o.id === j.id
      ? { id: o.id, day, block: 'day', truck_id: truck, truck_pinned: true, win_start: win[0], win_end: win[1], win_flex: false, arrive_at: at, forced: false, manual_order: null,
        eta_min: at, stop_order: i + 1, ...(tell ? { confirm_sent_at: null } : {}) }
      : { id: o.id, eta_min: p.eta.get(o.id), stop_order: i + 1, manual_order: null }));
  });
  p.left.forEach((o, i) => changed.push(put('jobs', { id: o.id, stop_order: i + 1 })));
  return { ok: true, job_id: j.id, changed: before.day !== day, tell, window_changed: before.win_start !== win[0], truck_changed: String(j.truck_id) !== truck, ...exactAnswer(p), rows: rows({ jobs: changed }) };
}

/* ---------- « Réserver à l'heure choisie » (Part 30) ---------- */
interface AtPlan { truck: string; p: ExactPlan; late: number; delay: number }
/** no vehicle can be there at that minute: the earliest it can (the exact move's arrive_late) */
interface AtEarly { early: true; earliest: number | null; earliestKeep: number | null; truck: string }
/** where a NEW appointment pointed at `at` goes: every vehicle that may take it tried (the one asked, else each that works
    that day), the exact move's placing for each; kept: the fewest late (past the hours counts as one), then the least
    delay, then the car first. Refused as the server: arrive_late (the earliest), pick_truck */
function atPlan(j: DemoRow, day: string, wanted: string | null, at: number, kind: string | null): AtPlan | AtEarly {
  const [d0, d1] = span();
  if (!(at >= d0 && at < d1)) refuse('bad_window', 'Cette heure n’est pas dans les heures de la journée : choisis-en une autre.');
  const trucks = table('trucks').filter((x) => x.active && !x.deleted_at && truckDay(x.id, day) && (!wanted || x.id === wanted)
    && (!kind || (kind === 'truck') === (x.tire_machine !== false)));
  if (!trucks.length) refuse(wanted ? 'pick_truck' : 'block_closed', wanted ? 'Ce camion ne travaille pas ce jour-là : choisis une autre journée, ou laisse l’app choisir le camion.' : 'Cette journée est fermée : aucun camion ne travaille.');
  let best: AtPlan | null = null;
  let early: number | null = null, keep: number | null = null;
  const carFirst = (t: string) => (kind ? 0 : find('trucks', t)?.tire_machine !== false ? 1 : 0);
  for (const tr of trucks) {
    const p = exactPlan({ ...j, day, block: 'day', truck_id: tr.id }, day, tr.id, at);
    if (!p.placed) {
      if (p.earliest != null) early = early == null ? p.earliest : Math.min(early, p.earliest);
      if (p.earliestKeep != null) keep = keep == null ? p.earliestKeep : Math.min(keep, p.earliestKeep);
      continue;
    }
    const late = p.late.length + (p.overHours > 0 ? 1 : 0);
    const delay = p.stops.reduce((m, s) => m + (s.id === j.id ? 0 : Number(s.delay_min) || 0), 0);
    if (!best || late < best.late || (late === best.late && (delay < best.delay || (delay === best.delay && carFirst(tr.id) < carFirst(best.truck))))) best = { truck: tr.id, p, late, delay };
  }
  return best ?? { early: true, earliest: early, earliestKeep: keep, truck: trucks[0].id };
}
const atAnswer = (j: DemoRow, a: AtPlan, at: number, may: boolean) => {
  const win = winOf(at);
  const late = a.p.stops.filter((s) => s.id !== j.id && s.late).map((s) => ({ id: String(s.id), late_min: Number(s.late_min) || 0 }));
  return { ok: true, exact: true, at, job_id: j.id, truck_id: a.truck, win_start: win[0], win_end: win[1], forced: a.late > 0, may_force: may, late,
    stops: a.p.stops, over_hours: a.p.overHours, earliest: a.p.earliest, earliest_keep: a.p.earliestKeep };
};
const mayForceHere = () => roles().includes('owner') || roles().includes('office');
/** book_preview(p_job, p_items) / book_job with arrive_at: the checks of a booking, then the plan at that minute */
function atAsk(a: Record<string, unknown>) {
  const j = a.p_job as DemoRow & { day: string; customer_id: string; truck_id?: string | null; duration_min?: number; arrive_at: number; vehicle_kind?: string | null; late_ok?: unknown };
  if (!j.customer_id) refuse('no_customer', 'Choisis le client avant de réserver.');
  if (!j.day || (j.block && j.block !== 'day')) refuse('bad_block', 'Choisis la journée et la plage d’arrivée.');
  if (j.day < today()) refuse('block_started', 'Cette journée est finie : choisis une autre journée.');
  const wanted = (j.truck_id as string) || null;
  need(can('book') || (!!wanted && myTruckIds().includes(wanted)), 'Tu ne peux pas prendre de rendez-vous. Parle au propriétaire.');
  if (j.id && find('jobs', j.id)) refuse('exists', 'Ce rendez-vous existe déjà.');
  const items = (a.p_items as DemoRow[]) || [];
  const dur = Number(j.duration_min) || items.reduce((m, i) => m + (Number(i.duration_min) || 0), 0) || 60;
  const id = String(j.id || crypto.randomUUID());
  const row: DemoRow = { id, duration_min: dur, travel_min: 18, status: 'booked', day: j.day, block: 'day', truck_id: wanted, stop_order: null, eta_min: null };
  const kind = j.vehicle_kind === 'car' || j.vehicle_kind === 'truck' ? j.vehicle_kind : null;
  return { j, row, items, dur, at: Number(j.arrive_at), plan: atPlan(row, j.day, wanted, Number(j.arrive_at), kind) };
}
function atPreview(a: Record<string, unknown>) {
  if (!windowsOn() || typeof (a.p_job as DemoRow | null)?.arrive_at !== 'number') return { ok: true, exact: false, stops: [] };
  const x = atAsk(a);
  // the truck cannot be there: answered with its code and the earliest minute (as the exact move's demo preview)
  if ('early' in x.plan) return { ok: false, code: 'arrive_late', exact: true, at: x.at, stops: [], over_hours: 0, earliest: x.plan.earliest, earliest_keep: x.plan.earliestKeep, truck_id: x.plan.truck };
  return { preview: true, ...atAnswer(x.row, x.plan, x.at, mayForceHere()) };
}
function atBook(a: Record<string, unknown>) {
  const x = atAsk(a);
  if ('early' in x.plan) refuse('arrive_late', 'Le camion ne peut pas être là à cette heure-là : choisis une heure plus tard.');
  const plan = x.plan;
  const ans = atAnswer(x.row, plan, x.at, mayForceHere());
  if (ans.forced && !mayForceHere()) refuse('not_allowed', 'Seuls le propriétaire et le bureau peuvent réserver à cette heure : elle met un autre client en retard, ou le camion après ses heures.');
  const ok = new Set(Array.isArray(x.j.late_ok) ? (x.j.late_ok as unknown[]).map(String) : []);
  if (ans.late.some((l) => !ok.has(l.id)) || (ans.over_hours > 0 && !ok.has(x.row.id))) refuse('late_changed', 'La journée a changé depuis la vérification : cette réservation mettrait un autre client en retard (ou le camion après ses heures). Vérifie de nouveau.');
  const win = winOf(x.at);
  const { late_ok: _l, arrive_at: _a, force: _f, ...rest } = x.j as DemoRow;
  void _l; void _a; void _f;
  const changed: DemoRow[] = [];
  const job = put('jobs', {
    vehicle_id: null, problem: null, notes: null, address: null, unit: null, postal_code: null, lat: null, lng: null,
    card_on_file: false, lost_cents: null, lost_reason: null, started_at: null, arrived_at: null, finished_at: null, cancelled_at: null, pay_later: false, pay_later_reason: null,
    waiver_signed_at: null, waiver_signer: null, waiver_version: null, waiver_attachment: null, confirm_sent_at: null, source: 'phone', quote_id: null, manual_order: null,
    number: Math.max(200, ...table('jobs').map((y) => Number(y.number) || 0)) + 1, created_by: me(),
    ...rest, id: x.row.id, status: 'booked', block: 'day', truck_id: plan.truck, truck_pinned: true, duration_min: x.dur, win_start: win[0], win_end: win[1], win_flex: false,
    arrive_at: x.at, eta_min: x.at, forced: false, travel_min: 18
  });
  plan.p.order.forEach((o, i) => changed.push(put('jobs', o.id === x.row.id ? { id: job.id, stop_order: i + 1, eta_min: x.at } : { id: o.id, eta_min: plan.p.eta.get(o.id), stop_order: i + 1, manual_order: null })));
  const its = x.items.map((it, i) => put('job_items', { kind: 'service', qty: 1, unit_cents: 0, taxable: true, status: 'planned', answered_at: null, answered_via: null, note: null, item_id: null, service_id: null, duration_min: null, sort: i + 1, ...it, id: String(it.id || crypto.randomUUID()), job_id: job.id }));
  if (x.j.quote_id) { const q = find('quotes', x.j.quote_id); if (q) put('quotes', { id: q.id, status: 'converted', job_id: job.id }); }
  return { ...ans, eta: x.at, win_flex: false, rows: rows({ jobs: [find('jobs', job.id)!, ...changed.filter((c) => c.id !== job.id)], job_items: its }) };
}

export function installWindows() {
  const before = { book: rpcOf('book_job'), move: rpcOf('move_job'), suggest: rpcOf('suggest_blocks'), stops: rpcOf('set_stop_order'), preview: rpcOf('move_preview') };

  registerRpc('book_job', (a) => {
    const j = a.p_job as DemoRow & { day: string; block: string; customer_id: string; truck_id?: string; duration_min?: number; win_start?: number | null; win_flex?: boolean; force?: boolean };
    if (!windowsOn()) {
      if (j.block === 'day') refuse('bad_block', 'Choisis la date et le bloc : matin, après-midi ou soir.');
      return before.book!(a);
    }
    // Part 30: a minute said (not « flexible »): booked AT that minute
    if (typeof j.arrive_at === 'number' && j.win_flex !== true) return atBook(a);
    if (!j.customer_id) refuse('no_customer', 'Choisis le client avant de réserver.');
    if (j.block !== 'day' || !j.day) refuse('bad_block', 'Choisis la journée et la plage d’arrivée.');
    if (find('jobs', j.id)) refuse('exists', 'Ce rendez-vous existe déjà.');
    const items = (a.p_items as DemoRow[]) || [];
    const dur = Number(j.duration_min) || items.reduce((m, i) => m + (Number(i.duration_min) || 0), 0) || 60;
    const c = find('customers', j.customer_id);
    const here = j.lat != null && j.lng != null ? { lat: Number(j.lat), lng: Number(j.lng) } : c?.lat != null ? { lat: Number(c.lat), lng: Number(c.lng) } : null;
    const p = placeFor(j.day, dur, here, j.truck_id || null, null, { start: j.win_start ?? null, flex: j.win_flex === true && j.win_start == null, force: j.force === true });
    const { force: _force, ...rest } = j;
    void _force;
    const job = put('jobs', {
      vehicle_id: null, stop_order: 99, eta_min: null, travel_min: 18, problem: null, notes: null, address: null, unit: null, postal_code: null, lat: null, lng: null,
      card_on_file: false, lost_cents: null, lost_reason: null, started_at: null, arrived_at: null, finished_at: null, cancelled_at: null, pay_later: false, pay_later_reason: null,
      waiver_signed_at: null, waiver_signer: null, waiver_version: null, waiver_attachment: null, confirm_sent_at: null, source: 'phone', quote_id: null, manual_order: null,
      status: 'booked', number: Math.max(200, ...table('jobs').map((x) => Number(x.number) || 0)) + 1, created_by: me(),
      ...rest, block: 'day', truck_id: p.truck, truck_pinned: !!j.truck_id, duration_min: dur, win_start: p.win?.[0] ?? null, win_end: p.win?.[1] ?? null, win_flex: p.flex, forced: p.forced
    });
    const its = items.map((it, i) => put('job_items', { kind: 'service', qty: 1, unit_cents: 0, taxable: true, status: 'planned', answered_at: null, answered_via: null, note: null, item_id: null, service_id: null, duration_min: null, sort: i + 1, ...it, id: String(it.id || crypto.randomUUID()), job_id: job.id }));
    if (j.quote_id) { const q = find('quotes', j.quote_id); if (q) put('quotes', { id: q.id, status: 'converted', job_id: job.id }); }
    const moved = replanDay(j.day);
    settle(job.id);
    return { ok: true, job_id: job.id, truck_id: p.truck, forced: p.forced, rows: rows({ jobs: moved.length ? moved : [job], job_items: its, quotes: j.quote_id ? find('quotes', j.quote_id) : undefined }) };
  });

  registerRpc('move_job', (a) => {
    if (!windowsOn()) {
      if (a.p_block === 'day') refuse('bad_block', 'Bloc inconnu.');
      return before.move!(a);
    }
    if (a.p_exact != null) return exactMove(a);
    const j = find('jobs', a.p_job);
    if (!j) refuse('not_found', 'Ce rendez-vous n’existe plus.');
    mayMove(j, a.p_truck);
    if (j.status !== 'booked') refuse('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.');
    if (a.p_block !== 'day') refuse('bad_block', 'Choisis la journée et la plage d’arrivée.');
    const day = String(a.p_day), wanted = (a.p_truck as string) || null;
    const said = a.p_win_start != null || a.p_win_flex === true;
    // the old call (no window said): the same day keeps the window the customer was told; another day gets the best one
    const keep = !said && j.day === day;
    const p = placeFor(day, Number(j.duration_min) || 60, hereOf(j), wanted, j.id, {
      start: a.p_win_start != null ? Number(a.p_win_start) : keep && j.win_start != null ? Number(j.win_start) : null,
      flex: a.p_win_flex === true || (keep && j.win_flex === true && j.win_start == null), force: false
    });
    const from = String(j.day);
    const same = from === day && (p.win?.[0] ?? null) === (j.win_start ?? null) && p.flex === (j.win_flex === true);
    // a move without a minute pointed: the planner chooses again inside the window (S7: the pin is cleared)
    put('jobs', { id: j.id, day, block: 'day', truck_id: p.truck, truck_pinned: !!wanted, stop_order: 99, manual_order: null, forced: false, arrive_at: null,
      win_start: p.win?.[0] ?? null, win_end: p.win?.[1] ?? null, win_flex: p.flex, ...(same ? {} : { confirm_sent_at: null }) });
    const changed = [...replanDay(day), ...(from !== day ? replanDay(from) : [])];
    settle(j.id);
    return { ok: true, job_id: j.id, changed: true, rows: rows({ jobs: changed.length ? changed : [find('jobs', j.id)!] }) };
  });

  // Part 30: what a booking at a minute would do, nothing written
  registerRpc('book_preview', (a) => atPreview(a));

  // « exact move »: the new form of the preview (p_job, p_day, p_truck, p_at); the older form answers as before
  registerRpc('move_preview', (a) => (a.p_at != null && a.p_job != null ? exactPreview(a) : before.preview ? before.preview(a) : { ok: true }));

  registerRpc('suggest_blocks', (a) => {
    if (!windowsOn()) return before.suggest!(a);
    const from = String(a.p_from || today()) < today() ? today() : String(a.p_from || today());
    const days = Math.max(1, Math.min(60, Number(a.p_days || 14)));
    const here = a.p_lat != null && a.p_lng != null ? { lat: Number(a.p_lat), lng: Number(a.p_lng) } : null;
    const out: ReturnType<typeof rowOf>[] = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(from, i);
      const best = offers(day, Number(a.p_duration) || 60, here, null, (a.p_exclude as string) || null)[0];
      if (best) out.push(rowOf(day, best));
    }
    out.sort((x, y) => x.drive_min - y.drive_min || y.near - x.near || x.day.localeCompare(y.day));
    return out.slice(0, Math.max(1, Number(a.p_limit || 6)));
  });

  registerRpc('suggest_windows', (a) => {
    if (!windowsOn() || !a.p_day) return [];
    const day = String(a.p_day);
    const here = a.p_lat != null && a.p_lng != null ? { lat: Number(a.p_lat), lng: Number(a.p_lng) } : null;
    return distinct(offers(day, Number(a.p_duration) || 60, here, null, (a.p_exclude as string) || null)).map((o) => rowOf(day, o));
  });

  registerRpc('set_stop_order', (a) => {
    if (a.p_block !== 'day') return before.stops!(a);
    const ids = (a.p_jobs as string[]) || [];
    const day = String(a.p_day);
    const booked = dayJobs(day, String(a.p_truck)).filter((j) => j.status === 'booked');
    // the stops named, in that order, then the others as they were; an empty list gives the route back to the planner
    const named = ids.map((id) => booked.find((j) => j.id === id)).filter(Boolean) as DemoRow[];
    // an order by hand: the last action wins, the minutes pointed of the stops listed are cleared (S7)
    [...named, ...booked.filter((j) => !ids.includes(j.id))].forEach((j, i) => put('jobs', { id: j.id, manual_order: ids.length ? i + 1 : null, ...(ids.includes(j.id) ? { arrive_at: null } : {}) }));
    return { ok: true, rows: rows({ jobs: replanDay(day) }) };
  });

  registerRpc('lock_windows', (a) => {
    if (!roles().some((r) => r === 'owner' || r === 'office')) refuse('not_allowed', 'Seuls le propriétaire et le bureau peuvent fixer les plages.');
    if (!windowsOn()) return { ok: true, fixed: 0 };
    const day = String(a.p_day || addDays(today(), 1));
    replanDay(day);
    const fixed = table('jobs').filter((j) => j.day === day && j.block === 'day' && j.status === 'booked' && live(j) && j.win_flex === true && j.win_start == null && j.eta_min != null)
      .map((j) => { const w = winOf(Number(j.eta_min)); return put('jobs', { id: j.id, win_start: w[0], win_end: w[1] }); });
    return { ok: true, fixed: fixed.length, rows: rows({ jobs: fixed }) };
  });

  registerRpc('windows_switch', (a) => {
    if (!roles().includes('owner')) refuse('owner_only', 'Seul le propriétaire peut changer la façon de réserver.');
    const on = a.p_on === true;
    if (on === windowsOn()) return { ok: true, converted: 0 };
    // going back to blocks: the mode first, so the pretend block operations see blocks again
    const s = put('settings', { id: '1', booking: { ...booking(), windows_on: on } });
    const changed = convert(on);
    return { ok: true, converted: changed.length, rows: rows({ settings: s, jobs: table('jobs').filter((j) => !j.deleted_at && String(j.day) >= today()) }) };
  });

  // ?demo=owner&fenetres=1 : the demo opens in window mode (the address keeps it, like &texts=on)
  try {
    if (/[?&]fenetres(=1|=on)?(&|$)/.test(location.search)) {
      put('settings', { id: '1', booking: { ...booking(), windows_on: true, win_before_min: 60, win_after_min: 180, win_round_min: 60 } });
      convert(true);
      examples();
    }
  } catch (e) { console.warn('demo: fenêtres', e); }
}
