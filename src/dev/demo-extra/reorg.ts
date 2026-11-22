/* DEV ONLY — « Réorganiser la journée » (Part 28) in the demo: pretend day_order_preview and day_order_save, with the real
   names, arguments and answers (REARRANGE.md §1.4), believable on a handful of stops (the real ones are SQL, tested in
   tests/db/reorganiser.test.mjs). What they do, as the server does:
   - rights (demo-rules: the database's twin): on the team; each listed truck: owner, « Réserver » or one's own truck; a
     stop put on another truck, or « Laisser l'app choisir »: owner or « Réserver » only;
   - the basis (p_was): the stops of that day on the listed trucks as the draft saw them (truck, block, order, window,
     pin, status); changed meanwhile: the preview answers basis_ok false, the save refuses day_changed;
   - the coverage of the lists (changed), the vehicle that cannot do tire work (needs_truck), a truck that does not work
     that day (truck_off), a stop put on another vehicle past its hours (truck_ends);
   - the walk: the stops under way first, then the lists in order; a stop moved never waits, the others wait for their
     pinned minute, else the window they were told that day, else their window;
   - the judge: back to what he was told (win_back), a new window from the arrival (owner / « Réserver », switch
     « les plages ne bougent jamais » off), late / early otherwise, flexible ones given their window only when that day's
     evening lock is due, the pins that go, the trucks past their hours; warn first (p_accept) at the save;
   - the save writes the trucks, the orders (no order by hand), the pins of the stops moved cleared, the windows; a save
     by someone without « Réserver » writes no window and marks hand_at on the stops it left outside their window.
   Its refusals carry no detail (the demo's refusal has none): the screen still says them in words. */
import { registerRpc, find, table, put, rows, refuse, nowIso, type DemoRow } from '../fake-server';
import { can, isOwner, isStaff, myTruckIds } from '../demo-rules';
import { rangesOf } from './agenda';
import { windowsOn } from '../demo-windows';
import { addDays, today, nowMinute, windowFor } from '../../lib/dates';
import { saysNo } from '../../domain/jobs/told';

type Win = [number, number];
interface List { truck: string; block: string; jobs: string[] }
const BLOCKS: Record<string, Win> = { am: [480, 720], pm: [720, 960], eve: [960, 1200] };
const booking = () => ((find('settings', '1')?.booking || {}) as Record<string, unknown>);
const num = (v: unknown, d: number) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);
const span = (): Win => {
  const bl = (booking().blocks as { start: number; end: number }[] | undefined) || [];
  return bl.length ? [Math.min(...bl.map((b) => b.start)), Math.max(...bl.map((b) => b.end))] : [480, 1200];
};
const winOf = (eta: number): Win => windowFor(eta, { before: num(booking().win_before_min, 60), after: num(booking().win_after_min, 180), round: num(booking().win_round_min, 60), dayStart: span()[0], dayEnd: span()[1] });
const LIVE = ['en_route', 'on_site'];
const ofDay = (day: string) => table('jobs').filter((j) => j.day === day && !j.deleted_at);
const wasRow = (j: DemoRow) => [j.truck_id ?? null, j.block, j.stop_order ?? null, j.win_start ?? null, j.win_end ?? null, j.arrive_at ?? null, j.status];
/** the truck's hours that day (its first and last minute; today from now), null: it does not work */
function hoursOf(truck: string, day: string, block: string): Win | null {
  const rs = rangesOf(truck, day).filter(([a, b]) => b > a);
  if (!rs.length) return null;
  const [b0, b1] = block === 'day' ? span() : BLOCKS[block] || span();
  const a = Math.max(b0, Math.min(...rs.map((r) => r[0])));
  const b = Math.min(b1, Math.max(...rs.map((r) => r[1])));
  return b > a ? [day === today() ? Math.max(a, nowMinute()) : a, b] : null;
}
const lockDue = (day: string) => day === today() || (day === addDays(today(), 1) && nowMinute() >= num(booking().win_lock_min, 1080));
const empty = () => ({ windows: {} as Record<string, number>, flex: {} as Record<string, number>, late: {} as Record<string, number>, early: {} as Record<string, number>, pins: {} as Record<string, number>, over: {} as Record<string, number> });

function core(a: Record<string, unknown>, save: boolean) {
  const day = typeof a.p_day === 'string' ? a.p_day : '';
  if (!day) refuse('bad_block', 'Bloc inconnu.');
  if (day < today()) refuse('past', 'Cette journée est passée.');
  if (!isStaff()) refuse('not_allowed', 'Connecte-toi.');
  const book = isOwner() || can('book');
  const auto = a.p_auto === true;
  const wm = windowsOn();
  const rewin = book && !saysNo(booking().rewin);
  const mine = myTruckIds();
  const all = ofDay(day);
  let lists = Array.isArray(a.p_lists) ? (a.p_lists as List[]) : null;
  if (save && (!lists || !a.p_was)) refuse('bad_list', 'La liste des arrêts n’est pas bonne.');
  if (auto && !book) refuse('not_allowed', 'Seuls le propriétaire et le bureau changent un arrêt de camion.');
  const trucks = lists ? [...new Set(lists.map((l) => l.truck))]
    : table('trucks').filter((t) => t.active && !t.deleted_at && (hoursOf(t.id, day, 'day') || all.some((j) => j.truck_id === t.id && j.status === 'booked'))).map((t) => t.id);
  for (const tr of trucks) if (!(book || mine.includes(tr))) refuse('not_allowed', 'Tu ne peux pas changer l’ordre de ce camion. Parle au propriétaire.');
  // the basis: the draft's day is the day now
  const was = a.p_was && typeof a.p_was === 'object' ? a.p_was as Record<string, unknown[]> : null;
  if (was) {
    const cur = all.filter((j) => trucks.includes(String(j.truck_id)) && (j.status === 'booked' || LIVE.includes(String(j.status))));
    const gone = Object.keys(was).filter((id) => !cur.some((j) => j.id === id));
    const added = cur.filter((j) => !(j.id in was)).map((j) => j.id);
    const changed = cur.filter((j) => j.id in was && JSON.stringify(wasRow(j)) !== JSON.stringify(was[j.id])).map((j) => j.id);
    if (gone.length + added.length + changed.length) {
      if (!save) return { ok: true, day, basis_ok: false, gone, new: added, changed, by: null };
      refuse('day_changed', 'La journée a changé pendant que tu la réorganisais : je l’ai rechargée. Regarde, puis enregistre de nouveau.');
    }
  }
  const booked = (tr: string, block: string) => all.filter((j) => j.truck_id === tr && j.block === block && j.status === 'booked')
    .sort((x, y) => num(x.stop_order, 99) - num(y.stop_order, 99) || num(x.eta_min, 9999) - num(y.eta_min, 9999));
  // « Laisser l'app choisir »: the planner's order (the windows in the order they open, the flexible ones last)
  if (!lists) lists = trucks.map((tr) => ({ truck: tr, block: wm ? 'day' : 'am', jobs: booked(tr, wm ? 'day' : 'am').sort((x, y) => num(x.win_start, 2000) - num(y.win_start, 2000)).map((j) => j.id) }));
  // the coverage of the lists
  const listed = lists.flatMap((l) => l.jobs);
  if (new Set(listed).size !== listed.length || listed.length > 200) refuse('bad_list', 'La liste des arrêts n’est pas bonne.');
  for (const l of lists) {
    if (wm && l.block !== 'day') refuse('bad_block', 'Bloc inconnu.');
    const missing = booked(l.truck, l.block).filter((j) => !lists!.some((x) => x.block === l.block && x.jobs.includes(j.id)));
    const extra = l.jobs.filter((id) => { const j = find('jobs', id); return !j || j.day !== day || j.status !== 'booked' || j.deleted_at || j.block !== l.block || !trucks.includes(String(j.truck_id)); });
    if (missing.length || extra.length) refuse('changed', 'Un rendez-vous de cette journée a changé (parti, fini, déplacé ou nouveau). Rouvre la journée.');
  }
  // the targets
  for (const l of lists) for (const id of l.jobs) {
    const j = find('jobs', id)!;
    if (j.truck_id === l.truck) continue;
    if (!book) refuse('not_allowed', 'Seuls le propriétaire et le bureau changent un arrêt de camion.');
    const tr = find('trucks', l.truck);
    if (!hoursOf(l.truck, day, l.block)) refuse('truck_off', `${tr?.name ?? 'Ce camion'} ne travaille pas ce jour-là.`);
    if (j.needs_machine === true && tr?.tire_machine === false) refuse('needs_truck', 'Ce travail demande le camion (montage ou balancement des pneus) : la voiture ne peut pas le faire.');
  }
  const moved = new Set(Array.isArray(a.p_moved) ? (a.p_moved as string[]) : []);
  // the walk and the judge
  const acc = empty();
  const stops: Record<string, unknown>[] = [];
  const sums: Record<string, unknown>[] = [];
  const writes: { id: string; patch: Record<string, unknown> }[] = [];
  for (const l of lists) {
    const hrs = hoursOf(l.truck, day, l.block) || (l.block === 'day' ? span() : BLOCKS[l.block] || span());
    let t = hrs[0];
    for (const j of all.filter((x) => x.truck_id === l.truck && x.block === l.block && LIVE.includes(String(x.status)))) t = Math.max(t, num(j.eta_min, t) + num(j.duration_min, 60));
    let drive = 0;
    l.jobs.forEach((id, i) => {
      const j = find('jobs', id)!;
      const travel = num(j.travel_min, 18);
      const ws = j.win_start == null ? null : Number(j.win_start), we = j.win_end == null ? null : Number(j.win_end);
      const told: Win | null = j.told_at && j.told_day === day && j.told_start != null && j.told_end != null ? [Number(j.told_start), Number(j.told_end)] : null;
      // held to what he was told only when it starts earlier than his planned window (never a later start: review R1)
      const hold = moved.has(id) ? null : j.arrive_at != null ? Number(j.arrive_at) : told && rewin && ws != null && told[0] < ws ? told[0] : ws;
      let eta = t + travel;
      if (hold != null && eta < hold) eta = hold;
      t = Math.max(t, eta + num(j.duration_min, 60));
      drive += travel;
      let newWin: Win | null = null, back = false, flexFixed = false, flexLater = false, late = 0, early = 0, pinLost: number | null = null;
      if (wm && l.block === 'day') {
        if (ws != null && we != null) {
          if (rewin) {
            if (told && eta >= told[0] && eta <= told[1]) { if (told[0] !== ws || told[1] !== we) { newWin = told; back = true; } }
            else if (eta < ws || eta > we) { newWin = winOf(eta); back = !!told && newWin[0] === told[0] && newWin[1] === told[1]; if (!back) acc.windows[id] = newWin[0]; }
          } else if (eta > we) late = eta - we; else if (eta < ws) early = ws - eta;
        } else if (rewin) {
          if (lockDue(day)) { newWin = winOf(eta); flexFixed = true; acc.flex[id] = newWin[0]; } else flexLater = true;
        }
      } else if (BLOCKS[l.block] && eta > BLOCKS[l.block][1]) late = eta - BLOCKS[l.block][1];
      if (late) acc.late[id] = late;
      if (early) acc.early[id] = early;
      if (j.arrive_at != null && (moved.has(id) || eta > Number(j.arrive_at))) { pinLost = Number(j.arrive_at); acc.pins[id] = pinLost; }
      // another vehicle past its hours: refused (its kind holds for every later plan)
      if (j.truck_id !== l.truck && eta + num(j.duration_min, 60) > hrs[1]) {
        const tr = find('trucks', l.truck);
        refuse('truck_ends', `${tr?.name ?? 'Ce véhicule'} finit à ${Math.floor(hrs[1] / 60)} h ce jour-là : ${String(find('customers', j.customer_id)?.first_name ?? `#${String(j.number)}`)} n’y entre pas.`);
      }
      stops.push({
        id, truck_id: l.truck, truck_before: j.truck_id, block: l.block, order: i + 1, order_before: j.stop_order ?? null, eta, eta_before: j.eta_min ?? null,
        measured: null, win: ws != null && we != null ? [ws, we] : null, new_win: newWin, win_back: back, flex_fixed: flexFixed, flex_later: flexLater,
        late_min: late || null, early_min: early || null, pin: pinLost == null ? j.arrive_at ?? null : null, pin_lost: pinLost, pin_moved: pinLost != null && moved.has(id)
      });
      writes.push({ id, patch: {
        truck_id: l.truck, ...(j.truck_id !== l.truck ? { truck_pinned: !auto } : {}), stop_order: i + 1, manual_order: null, eta_min: eta, travel_min: travel,
        ...(moved.has(id) ? { arrive_at: null, forced: false } : pinLost != null ? { arrive_at: null } : {}),
        ...(newWin ? { win_start: newWin[0], win_end: newWin[1] } : {}),
        ...(!rewin && (late || early) ? { hand_at: nowIso() } : {})
      } });
    });
    const over = Math.max(0, t - hrs[1]);
    if (over) acc.over[l.truck] = over;
    sums.push({ id: l.truck, block: l.block, hours_end: hrs[1], finish: t, over_min: over, drive_min: drive, unmeasured: 0 });
  }
  const answer = { ok: true, day, basis_ok: true, mode: wm ? 'windows' : 'blocks', roads: false, rewin, auto, lists, stops, trucks: sums, accept: acc, due_after: 0 };
  if (!save) return answer;
  // warn first: every new window, flex window and pin as shown; late, early, past-hours shown and at most 5 min worse
  const got = (a.p_accept && typeof a.p_accept === 'object' ? a.p_accept : {}) as Record<string, Record<string, number> | undefined>;
  const same = (k: 'windows' | 'flex' | 'pins') => Object.entries(acc[k]).every(([id, v]) => got[k]?.[id] === v);
  const within = (k: 'late' | 'early' | 'over') => Object.entries(acc[k]).every(([id, v]) => got[k]?.[id] != null && v <= Number(got[k]![id]) + 5);
  if (!(same('windows') && same('flex') && same('pins') && within('late') && within('early') && within('over'))) {
    refuse('outcome_changed', 'Depuis la vérification, la journée donnerait d’autres heures. Regarde de nouveau avant d’enregistrer.');
  }
  const out = writes.map((w) => put('jobs', { id: w.id, ...w.patch }));
  return { ...answer, saved: true, rows: rows({ jobs: out }) };
}

export function load() {
  registerRpc('day_order_preview', (a) => core(a, false));
  registerRpc('day_order_save', (a) => core(a, true));
}
