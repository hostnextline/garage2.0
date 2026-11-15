/* DEV ONLY — « Plages d'arrivée » (Part 25) in the demo: the pretend server knows the window mode.
   - ?demo=owner&fenetres=1 opens the demo with the mode already on (the coming pretend appointments converted, a few
     examples: windows that follow no block, « flexible » ones, one « hors plage » on today's route).
   - Réglages → Réservations switches it on and off like the real thing (windows_switch), « Fixer les plages de demain »
     (lock_windows), and the booking operations take and give windows while the mode is on.
   While the mode is off every operation goes to the pretend operation that was there before: the block demo is unchanged.
   installWindows() is called by demo.ts AFTER the sections' own operations (demo-extra) are registered, so it wraps them. */
import { registerRpc, rpcOf, put, find, table, rows, refuse, type DemoRow } from './fake-server';
import { addDays, today, nowMinute, windowFor } from '../lib/dates';
import { rangesOf, renumber, km, pointOf, HOME } from './demo-extra/agenda';
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
  win: j.win_start != null && j.win_end != null ? [Number(j.win_start), Number(j.win_end)] : null,
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
    const drive = here ? Math.max(5, Math.ceil((Math.min(km(HOME, here), ...pts.map((q) => km(q, here))) * 1.3) / 35 * 60)) : 18;
    const near = here ? pts.filter((q) => km(q, here) <= 5).length : 0;
    const seq = order(js.map((j) => toStop(j, td.start)), td.start);
    for (const c of choices(seq, { id: 'new', dur, travel: drive }, td.start, td.end, winOf)) out.push({ truck: tr.id, choice: c, drive, near, left: Math.max(0, td.end - c.end) });
  }
  return out.sort((a, b) => (a.drive + a.choice.wait) - (b.drive + b.choice.wait) || b.near - a.near || a.choice.eta - b.choice.eta);
}
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
      changed.push(put('jobs', { id: j.id, block: holds(j.eta_min) || holds(j.win_start) || 'am', win_start: null, win_end: null, win_flex: false, manual_order: null }));
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

export function installWindows() {
  const before = { book: rpcOf('book_job'), move: rpcOf('move_job'), suggest: rpcOf('suggest_blocks'), stops: rpcOf('set_stop_order') };

  registerRpc('book_job', (a) => {
    const j = a.p_job as DemoRow & { day: string; block: string; customer_id: string; truck_id?: string; duration_min?: number; win_start?: number | null; win_flex?: boolean; force?: boolean };
    if (!windowsOn()) {
      if (j.block === 'day') refuse('bad_block', 'Choisis la date et le bloc : matin, après-midi ou soir.');
      return before.book!(a);
    }
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
    const j = find('jobs', a.p_job);
    if (!j) refuse('not_found', 'Ce rendez-vous n’existe plus.');
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
    put('jobs', { id: j.id, day, block: 'day', truck_id: p.truck, truck_pinned: !!wanted, stop_order: 99, manual_order: null, forced: false,
      win_start: p.win?.[0] ?? null, win_end: p.win?.[1] ?? null, win_flex: p.flex, ...(same ? {} : { confirm_sent_at: null }) });
    const changed = [...replanDay(day), ...(from !== day ? replanDay(from) : [])];
    settle(j.id);
    return { ok: true, job_id: j.id, changed: true, rows: rows({ jobs: changed.length ? changed : [find('jobs', j.id)!] }) };
  });

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
    [...named, ...booked.filter((j) => !ids.includes(j.id))].forEach((j, i) => put('jobs', { id: j.id, manual_order: ids.length ? i + 1 : null }));
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
