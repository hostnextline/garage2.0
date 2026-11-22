-- ---------- « Un déplacement tombe exactement où on pointe » (Hassan, 2026-11-21; STATE.md « exact move », S1 – S9) ----------
-- « when i move an appointement, i want it to move exactly where i point it to move, but the rest stays the same. keep
-- showing the timeframe of 1h before and 2 hours after ». Until now a move by hand sent only the start of a 4-hour window:
-- the planner then planned the whole day again, so the appointment landed anywhere in the 4 hours (measured: 60 min before
-- to 95 min after the minute pointed) and the other stops changed order and times.
-- S1: jobs.arrive_at = the minute of the day the person pointed (« Heure pointée »). Written by the server only (no column
-- grant: a person's columns are listed in 20261104000200_access.sql), backed up with the job (the backups take every column).
-- null on every appointment until a move with a minute is made: a job without it is planned exactly as before (S9).
alter table public.jobs add column if not exists arrive_at integer check (arrive_at between 0 and 1439);
-- @@ the generator puts what is above right after the columns of Part 27, what is below at the end of the migration @@

-- ---------- the move with a minute pointed (S2 – S5, S8) ----------
-- move_job with 8 arguments (S2): (p_op, p_job, p_day, p_block, p_truck, p_win_start, p_win_flex, p_exact jsonb), p_exact
-- with NO default (a call with the old app's 5 or 7 names finds the old functions only: PostgREST would find a call
-- ambiguous if it had one). p_exact = { at: minute of the day, late_ok: [the ids the person accepted late after the
-- warning] }; null = the 7-argument move. With a minute, p_block / p_win_start / p_win_flex are not used: the minute decides.
-- Window mode: the appointment goes on its truck (the one picked, else its own) that day, arriving at that minute exactly;
-- its window is win_for(minute) (the garage's rule: 13 h → 12 h – 16 h, unchanged); every other stop of that truck's day keeps
-- its order and is held « not before its stored arrival »; the day is walked once with the planner's own walk (route_hold
-- = route_retime). The day it left keeps its order and its times. Every other truck is not touched.
-- Blocks mode (the way back): no time is told to the customer: the move to the block of that minute, its truck kept (the
-- one picked, else its own when it works that block), the answer says exact: false.
-- The answer (S3, the move and its preview alike): what move_job answers (ok, job_id, changed, tell, window_changed,
-- truck_changed, was, now, rows) + exact: true, at, stops: [{ id, day, truck_id, order_before, order_after, eta_before,
-- eta_after, win_start, win_end, delay_min, late, late_min, measured }] (every booked stop of the truck-days the move
-- touches, the moved one included), over_hours (minutes past the truck's hours, 0), earliest (the earliest that truck can
-- be there at or after the minute pointed: the earliest place over its day), earliest_keep (the same with nobody's time
-- changed; null when no place does that).
--   late = arrives after its window's end (a stop pinned earlier: after ITS minute), and did not before (or later than
--   before), from a measured arrival only (S8); late_min = by how much.
-- Refusals (S4), nothing written, each with its words (French here; the app has both languages, src/i18n errors):
--   arrive_late: the truck cannot be there at that minute (detail: { earliest, earliest_keep }: the earliest minutes AT OR
--     AFTER the one pointed, the second with nobody's time changed);
--   late_changed: a stop would be late, or the truck would end past its hours, and it is not in late_ok (the moved one's
--     own id accepts the hours) (detail: { late: [{ id, late_min }], over_hours });
--   pick_truck: its truck (or the one picked) does not work that day;
--   and move_job's own: not_found, not_allowed (the very rule of move_job), not_booked, changed, block_started,
--   needs_truck, bad_window (a minute outside the day).
-- « Vraies routes » on (S8): an arrival counted with a trip not measured is never refused nor said late (measured: false);
-- a place is out only when its lower bound (every trip not measured counted 0) is after the minute (verify-on F1).

-- exact_works(truck, day, block): that vehicle works that block of that day, the rule plan_route_core uses to put a vehicle
-- in its plan (its hours there, from now on for today, hold at least min_block_min, or it holds a stop under way)
create or replace function public.exact_works(p_truck uuid, p_day date, p_block text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trucks tr
    cross join (select x.key, x.start_min, x.end_min from public.blocks() x where x.key = p_block) b
    cross join lateral (select public.ranges_overlap(public.ranges_from(public.truck_ranges(tr.id, p_day),
        case when p_day = public.local_today() then (ceil(public.now_min() / 5.0) * 5)::int when p_day < public.local_today() then 1440 else 0 end),
        b.start_min, b.end_min) cap) g
    where tr.id = p_truck and tr.active and tr.deleted_at is null
      and (g.cap >= least(public.bset('min_block_min', 45), b.end_min - b.start_min)
           or (g.cap > 0 and exists (select 1 from public.jobs j where j.truck_id = tr.id and j.day = p_day and j.block = b.key
                                     and j.status in ('en_route', 'on_site') and j.deleted_at is null))))
$$;

-- exact_try(job, day, truck, minute, order, holds): the appointment put on that vehicle's day at that minute (its window cut
-- from the minute: win_for), that day's booked stops numbered in that order after the ones done or under way, and the day
-- walked with the planner's walk, each stop of `holds` not before its minute (route_hold). That truck's ORDER BY HAND stays
-- (verify-off H1, verify-on F6: the other stops are planned as today): when the place chosen is before a stop of it, the
-- moved appointment joins it there (renumbered in the order chosen; every walk waits for its minute there), else it stays
-- out of it (the planner puts it after those stops, at its minute). Written: the caller undoes it (exact_run) or keeps it
-- (exact_place)
create or replace function public.exact_try(p_job uuid, p_day date, p_truck uuid, p_at integer, p_order uuid[], p_hold jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_base int; w record; v_pos int;
begin
  perform set_config('garage.rpc', 'on', true);
  select * into w from public.win_for(p_at);
  update public.jobs set day = p_day, block = 'day', truck_id = p_truck, truck_pinned = true, win_start = w.win_start, win_end = w.win_end,
    win_flex = false, arrive_at = p_at, forced = false, manual_order = null
  where id = p_job;
  -- that truck's order by hand: the moved one joins it when a stop of it comes after the place chosen
  v_pos := array_position(p_order, p_job);
  if exists (select 1 from unnest(p_order) with ordinality x(id, o) join public.jobs y on y.id = x.id
             where x.o > v_pos and y.id <> p_job and y.manual_order is not null) then
    update public.jobs j set manual_order = q.n::int
    from (select x.id, row_number() over (order by x.o) n from unnest(p_order) with ordinality x(id, o) join public.jobs y on y.id = x.id
          where y.id = p_job or y.manual_order is not null) q
    where j.id = q.id and j.manual_order is distinct from q.n::int;
  end if;
  select coalesce(max(j.stop_order), 0) into v_base from public.jobs j
  where j.truck_id = p_truck and j.day = p_day and j.block = 'day' and j.deleted_at is null and j.status in ('en_route', 'on_site', 'done');
  update public.jobs j set stop_order = v_base + x.o::int from unnest(p_order) with ordinality x(id, o)
  where j.id = x.id and j.stop_order is distinct from v_base + x.o::int;
  perform public.route_hold(p_truck, p_day, 'day', p_hold);
end $$;

-- exact_view(truck, day, job, minute, before, hours' end): that truck's day as it now stands, judged against `before`
-- ({ id: { eta, ws, we, at } }, read before the move): { eta, sure: the moved one's arrival (sure: measured, or the switch
-- off), late: [{ id, late_min }] (the others made late), delay (minutes later, all added), moved (how many arrive at
-- another minute), drive (the day's travel), over (minutes past the truck's hours, from a sure arrival only) }
create or replace function public.exact_view(p_truck uuid, p_day date, p_job uuid, p_at integer, p_before jsonb, p_hend integer) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select x.id, x.eta_min ea, x.travel_min tr, x.stop_order oa,
           case when public.roads_on() then coalesce(x.eta_measured, false) else true end sure,
           x.eta_min + ceil(public.bset('stop_min', 5))::int + x.duration_min fin,
           (p_before->x.id::text->>'eta')::int eb, coalesce(x.arrive_at, x.win_end) lim
    from public.jobs x
    where x.truck_id = p_truck and x.day = p_day and x.block = 'day' and x.deleted_at is null and x.status = 'booked'),
  t as (select * from s where s.id <> p_job),
  l as (select f.fin, f.sure from s f order by f.fin desc nulls last limit 1)
  select jsonb_build_object(
    'eta', (select s.ea from s where s.id = p_job),
    'sure', coalesce((select s.sure from s where s.id = p_job), true),
    'late', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'late_min', t.ea - t.lim) order by t.oa) from t
                      where t.sure and t.lim is not null and t.ea > t.lim and (t.eb is null or t.eb <= t.lim or t.ea > t.eb)), '[]'::jsonb),
    'delay', coalesce((select sum(greatest(0, t.ea - t.eb)) from t where t.eb is not null), 0),
    'moved', coalesce((select count(*) from t where t.eb is distinct from t.ea), 0),
    'drive', coalesce((select sum(s.tr) from s), 0),
    'over', coalesce((select case when l.sure then greatest(0, l.fin - p_hend) else 0 end from l), 0))
$$;

-- exact_run: exact_try, then exact_view, then everything undone (an error raised on purpose and caught at once: every row
-- written in the block is taken back; the activity of the trial is not written at all, so no number is spent: garage.trial
-- is read by log_activity). → the view, with the place tried (pos) and the order
create or replace function public.exact_run(p_job uuid, p_day date, p_truck uuid, p_at integer, p_order uuid[], p_hold jsonb,
  p_before jsonb, p_hend integer, p_pos integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_done boolean := false;
begin
  begin
    perform set_config('garage.trial', 'on', true);
    perform public.exact_try(p_job, p_day, p_truck, p_at, p_order, p_hold);
    v := public.exact_view(p_truck, p_day, p_job, p_at, p_before, p_hend)
         || jsonb_build_object('pos', p_pos, 'order', to_jsonb(p_order), 'wait', p_hold->p_job::text);
    v_done := true;
    raise exception 'exact_run: undone' using errcode = 'P0001', hint = 'exact_undone';
  exception when others then
    if not v_done then raise; end if;
  end;
  return v;
end $$;

-- the minute as people read it: 13 h 05
create or replace function public.exact_hm(p_min integer) returns text language sql immutable as $$
  select case when p_min is null then '—' else format('%s h %s', p_min / 60, lpad((p_min % 60)::text, 2, '0')) end
$$;

-- exact_place(job, day, truck, minute, late_ok, check): the move with a minute, window mode (see the head of this part).
-- Every place of the truck's day after its stops under way is TRIED (exact_run: written, judged, undone), once with the
-- appointment not waiting (where it can be the earliest) and once held at the minute; kept: the places where it arrives at
-- the minute (or, « Vraies routes » on, where that is not known and its lower bound is not after it: never refused from a
-- guess, nor taken when even the bound proves it cannot), the best one: the fewest made
-- late (the truck past its hours counts as one), then the least delay added, then the least driving, then the earliest
-- place. Then written that way. check: refuse « late_changed » (the move); false: say it (the preview)
create or replace function public.exact_place(p_job uuid, p_day date, p_truck uuid, p_at integer, p_late_ok jsonb, p_check boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.jobs; jn public.jobs; v_truck uuid; sp record; w record; b record;
  v_others uuid[]; n int; p int; v_order uuid[]; v_hold jsonb; v_before jsonb; v_bold jsonb := '{}'::jsonb; v_c jsonb; v_c0 jsonb;
  v_cs jsonb := '[]'::jsonb; v_c0s jsonb := '[]'::jsonb; v_best jsonb; v_earliest int; v_keep int; v_hend int; v_bad jsonb;
  v_moved boolean; v_left boolean; v_winch boolean; v_tell boolean; v_on boolean := public.roads_on(); v_view jsonb; v_base int;
  v_oldhold jsonb; v_ok jsonb := coalesce(p_late_ok, '[]'::jsonb); v_stops jsonb; v_res jsonb; v_lo jsonb; v_next text;
begin
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if j.status <> 'booked' then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  select * into sp from public.day_span();
  if p_at < sp.start_min or p_at >= sp.end_min then
    perform public.fail('bad_window', 'Cette heure n’est pas dans les heures de la journée : choisis-en une autre.');
  end if;
  if not public.block_open(p_day, 'day') then perform public.fail('block_started', 'Cette journée est finie : choisis une autre journée.'); end if;
  v_truck := coalesce(p_truck, j.truck_id);
  if v_truck is null then
    -- (verify-on F8) « À placer »: it has no truck, so the words say to pick one
    perform public.fail('pick_truck', 'Ce rendez-vous n’est sur aucun camion : choisis le camion qui ira à cette heure.');
  end if;
  if not public.exact_works(v_truck, p_day, 'day') then
    perform public.fail('pick_truck', 'Son camion ne travaille pas ce jour-là : choisis un camion qui travaille.');
  end if;
  if j.needs_machine and exists (select 1 from public.trucks tr where tr.id = v_truck and not tr.tire_machine) then
    perform public.fail('needs_truck', 'Ce travail demande le camion (montage ou balancement des pneus) : la voiture ne peut pas le faire.');
  end if;
  -- the two days, always locked in the same order (day, then morning → evening); then the job as it is NOW (move_job's rule)
  perform public.lock_two(j.day, j.block, p_day, 'day');
  select * into jn from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if jn.status <> 'booked' then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  if (jn.day, jn.block) is distinct from (j.day, j.block) then
    perform public.fail('changed', 'Ce rendez-vous vient d’être déplacé par quelqu’un d’autre. Rouvre-le et recommence.');
  end if;
  j := jn;
  v_moved := j.day <> p_day or j.block <> 'day';
  v_left := j.truck_id is not null and (j.truck_id, j.day, j.block) is distinct from (v_truck, p_day, 'day');
  select * into w from public.win_for(p_at);
  if not v_moved and j.truck_id = v_truck and j.truck_pinned and j.arrive_at = p_at and j.eta_min = p_at
     and (j.win_start, j.win_end) is not distinct from (w.win_start, w.win_end) then
    return jsonb_build_object('ok', true, 'unchanged', true, 'changed', false, 'tell', false, 'exact', true, 'at', p_at,
      'stops', '[]'::jsonb, 'over_hours', 0, 'earliest', null, 'earliest_keep', null,
      'rows', jsonb_build_object('jobs', jsonb_build_array(to_jsonb(j))));
  end if;
  -- the truck's day as it is: its booked stops in their order (without this one), each held at its stored arrival
  v_others := array(select x.id from public.jobs x
                    where x.truck_id = v_truck and x.day = p_day and x.block = 'day' and x.deleted_at is null and x.status = 'booked' and x.id <> j.id
                    order by x.stop_order nulls last, x.eta_min nulls last, x.created_at);
  n := coalesce(cardinality(v_others), 0);
  select coalesce(jsonb_object_agg(x.id::text, x.eta_min) filter (where x.eta_min is not null), '{}'::jsonb) into v_hold
  from public.jobs x where x.id = any(v_others);
  select coalesce(jsonb_object_agg(x.id::text, jsonb_build_object('order', x.stop_order, 'eta', x.eta_min)), '{}'::jsonb) into v_before
  from public.jobs x where x.id = any(v_others) or x.id = j.id;
  if v_left then
    select coalesce(jsonb_object_agg(x.id::text, jsonb_build_object('order', x.stop_order, 'eta', x.eta_min, 'travel', x.travel_min)), '{}'::jsonb) into v_bold
    from public.jobs x where x.truck_id = j.truck_id and x.day = j.day and x.block = j.block and x.deleted_at is null and x.status = 'booked' and x.id <> j.id;
  end if;
  select * into b from public.blocks() x where x.key = 'day';
  select least(coalesce(max((x->>1)::int), b.end_min), b.end_min) into v_hend from jsonb_array_elements(public.truck_ranges(v_truck, p_day)) x;
  -- every place, tried
  for p in 0 .. n loop
    v_order := coalesce(v_others[1:p], '{}') || array[j.id] || coalesce(v_others[p + 1:n], '{}');
    v_c0 := public.exact_run(j.id, p_day, v_truck, p_at, v_order, v_hold || jsonb_build_object(j.id::text, 0), v_before, v_hend, p);
    v_c := case when (v_c0->>'eta')::int >= p_at then v_c0
                else public.exact_run(j.id, p_day, v_truck, p_at, v_order, v_hold || jsonb_build_object(j.id::text, p_at), v_before, v_hend, p) end;
    -- (verify-on F1) « Vraies routes » on, a place whose arrival counts a trip not measured and comes after the minute: its
    -- lower bound (every trip not measured counted 0, the others still held at their arrival: route_hold with
    -- garage.exact_low). Only when even that bound is after the minute is the place out: that is a fact, not a guess (S8)
    if v_on and not (v_c->>'sure')::boolean and (v_c->>'eta')::int > p_at then
      perform set_config('garage.exact_low', 'on', true);
      v_lo := public.exact_run(j.id, p_day, v_truck, p_at, v_order, v_hold || jsonb_build_object(j.id::text, p_at), v_before, v_hend, p);
      perform set_config('garage.exact_low', '', true);
      v_c := v_c || jsonb_build_object('low', (v_lo->>'eta')::int);
    end if;
    v_c0s := v_c0s || jsonb_build_array(v_c0);
    v_cs := v_cs || jsonb_build_array(v_c);
  end loop;
  -- (verify-off M1, verify-on F2) the earliest the truck can be there AT OR AFTER the minute pointed: over the places held at
  -- that minute (a minute in the truck's break, or a job that does not end before it: the first minute after the break),
  -- never a minute before the one pointed; earliest_keep: the same with nobody's time changed
  select min((c->>'eta')::int) into v_earliest from jsonb_array_elements(v_cs) c;
  select min((c->>'eta')::int) into v_keep from jsonb_array_elements(v_cs) c
  where (c->>'moved')::int = 0 and jsonb_array_length(c->'late') = 0 and (c->>'over')::int = 0;
  select c into v_best from jsonb_array_elements(v_cs) c
  where (c->>'eta')::int = p_at or (not (c->>'sure')::boolean and coalesce((c->>'low')::int, p_at) <= p_at)
  order by ((c->>'eta')::int > p_at), case when (c->>'eta')::int > p_at then (c->>'eta')::int end nulls first,
           jsonb_array_length(c->'late') + case when (c->>'over')::int > 0 then 1 else 0 end,
           (c->>'delay')::int, (c->>'drive')::int, (c->>'pos')::int
  limit 1;
  if v_best is null then
    raise exception using errcode = 'P0001', hint = 'arrive_late',
      message = format('Le camion ne peut pas être là à %s : au plus tôt %s.', public.exact_hm(p_at), public.exact_hm(v_earliest)),
      detail = jsonb_build_object('earliest', v_earliest, 'earliest_keep', v_keep)::text;
  end if;
  if p_check then
    select jsonb_agg(e) into v_bad from jsonb_array_elements(v_best->'late') e where not (v_ok ? (e->>'id'));
    if v_bad is not null or ((v_best->>'over')::int > 0 and not (v_ok ? j.id::text)) then
      raise exception using errcode = 'P0001', hint = 'late_changed',
        message = 'La journée a changé depuis la vérification : ce déplacement mettrait un autre client en retard (ou le camion après ses heures). Vérifie de nouveau.',
        detail = jsonb_build_object('late', v_best->'late', 'over_hours', (v_best->>'over')::int)::text;
    end if;
  end if;
  -- written: the place chosen, the others held at their arrival
  perform public.exact_try(j.id, p_day, v_truck, p_at, array(select (x #>> '{}')::uuid from jsonb_array_elements(v_best->'order') x),
    v_hold || jsonb_build_object(j.id::text, p_at));
  -- the day it left: same order (the hole closed), same times (each held at its arrival, each trip as it was), only the trip
  -- after the hole is new
  if v_left then
    if public.block_open(j.day, j.block) then
      select coalesce(max(x.stop_order), 0) into v_base from public.jobs x
      where x.truck_id = j.truck_id and x.day = j.day and x.block = j.block and x.deleted_at is null and x.status in ('en_route', 'on_site', 'done');
      update public.jobs x set stop_order = v_base + q.rn
      from (select y.id, (row_number() over (order by y.stop_order nulls last, y.eta_min nulls last, y.created_at))::int rn
            from public.jobs y where y.truck_id = j.truck_id and y.day = j.day and y.block = j.block and y.deleted_at is null and y.status = 'booked') q
      where q.id = x.id and x.stop_order is distinct from v_base + q.rn;
      select coalesce(jsonb_object_agg(k, (v->>'eta')::int) filter (where v->>'eta' is not null), '{}'::jsonb) into v_oldhold from jsonb_each(v_bold) e(k, v);
      -- (verify-on F4) and each trip as it was, but the one right after the hole: a stop without a position after the moved
      -- one made the walk count the next trip from another place (the last place known), so later stops got later
      select k into v_next from jsonb_each(v_bold) e(k, v) where (v->>'order')::int > j.stop_order order by (v->>'order')::int limit 1;
      select v_oldhold || jsonb_build_object('_legs', coalesce(jsonb_object_agg(k, greatest(0, (v->>'travel')::int - ceil(public.bset('stop_min', 5))::int))
               filter (where v->>'travel' is not null and k <> v_next), '{}'::jsonb)) into v_oldhold from jsonb_each(v_bold) e(k, v);
      perform public.route_hold(j.truck_id, j.day, j.block, v_oldhold);
    elsif j.day = public.local_today() and j.stop_order is not null then
      -- a day already started: nobody is walked again, the stops after it move up by one (move_job's rule)
      update public.jobs set stop_order = stop_order - 1
      where truck_id = j.truck_id and day = j.day and block = j.block and deleted_at is null and id <> j.id
        and status in ('booked','en_route','on_site') and stop_order > j.stop_order
        and not exists (select 1 from public.jobs o where o.truck_id = j.truck_id and o.day = j.day and o.block = j.block and o.deleted_at is null
                        and o.id <> j.id and o.status not in ('cancelled','no_show') and o.stop_order = j.stop_order);
    end if;
  end if;
  -- what really changed for the customer (the day, the window): told again
  select * into jn from public.jobs where id = j.id;
  v_winch := (j.win_start, j.win_end) is distinct from (jn.win_start, jn.win_end);
  v_tell := v_moved or v_winch;
  if v_tell and jn.confirm_sent_at is not null then
    perform set_config('garage.rpc', 'on', true);
    update public.jobs set confirm_sent_at = null where id = j.id;
    select * into jn from public.jobs where id = j.id;
  end if;
  v_view := public.exact_view(v_truck, p_day, j.id, p_at, v_before, v_hend);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'day', x.day, 'truck_id', x.truck_id,
           'order_before', (q.bf->>'order')::int, 'order_after', x.stop_order, 'eta_before', (q.bf->>'eta')::int, 'eta_after', x.eta_min,
           'win_start', x.win_start, 'win_end', x.win_end,
           'delay_min', greatest(0, coalesce(x.eta_min - (q.bf->>'eta')::int, 0)),
           'late', q.late, 'late_min', case when q.late then x.eta_min - q.lim else 0 end,
           'measured', case when v_on then coalesce(x.eta_measured, false) end)
           order by x.day, (x.truck_id = v_truck) desc, x.stop_order nulls last, x.id), '[]'::jsonb) into v_stops
  from public.jobs x
  cross join lateral (select coalesce(v_before->x.id::text, v_bold->x.id::text) bf, coalesce(x.arrive_at, x.win_end) lim) q0
  cross join lateral (select q0.bf, q0.lim,
      (case when v_on then coalesce(x.eta_measured, false) else true end) and q0.lim is not null and x.eta_min > q0.lim
      and (x.id = j.id or (q0.bf->>'eta') is null or (q0.bf->>'eta')::int <= q0.lim or x.eta_min > (q0.bf->>'eta')::int) late) q
  where x.deleted_at is null and x.status = 'booked'
    and (x.id = j.id or (x.truck_id = v_truck and x.day = p_day and x.block = 'day')
         or (v_left and x.truck_id = j.truck_id and x.day = j.day and x.block = j.block));
  v_res := jsonb_build_object('ok', true, 'job_id', j.id, 'changed', v_moved, 'tell', v_tell, 'window_changed', v_winch,
    'truck_changed', j.truck_id is distinct from jn.truck_id,
    'was', jsonb_build_object('day', j.day, 'block', j.block, 'win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex, 'truck_id', j.truck_id),
    'now', jsonb_build_object('day', jn.day, 'block', jn.block, 'win_start', jn.win_start, 'win_end', jn.win_end, 'win_flex', jn.win_flex, 'truck_id', jn.truck_id),
    'exact', true, 'at', p_at, 'stops', v_stops, 'over_hours', (v_view->>'over')::int, 'earliest', v_earliest, 'earliest_keep', v_keep,
    'rows', jsonb_build_object('jobs', public.block_rows(p_day, 'day') || case when v_moved then public.block_rows(j.day, j.block) else '[]'::jsonb end));
  perform set_config('garage.rpc', '', true);
  return v_res;
end $$;

-- exact_move(job, day, truck, minute, late_ok, check): the move with a minute, both modes. The right first, word for word
-- move_job's (« book », or the person's own truck named and the job on a truck of theirs)
create or replace function public.exact_move(p_job uuid, p_day date, p_truck uuid, p_at integer, p_late_ok jsonb, p_check boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.jobs; v_block text; v_truck uuid;
begin
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if not (public.can('book') or (p_truck is not null and coalesce(p_truck = any(public.my_truck_ids()), false) and coalesce(j.truck_id = any(public.my_truck_ids()), false))) then
    perform public.fail('not_allowed', 'Tu ne peux pas déplacer ce rendez-vous.');
  end if;
  if p_at is null or p_at < 0 or p_at > 1439 then perform public.fail('bad_window', 'Cette heure n’est pas bonne : choisis-en une autre.'); end if;
  if public.windows_on() then return public.exact_place(p_job, p_day, p_truck, p_at, p_late_ok, p_check); end if;
  -- blocks: the block that holds that minute; its truck kept (the one picked, else its own when it works that block)
  select x.key into v_block from public.blocks() x where p_at >= x.start_min and p_at < x.end_min order by x.pos limit 1;
  if v_block is null then perform public.fail('bad_window', 'Cette heure n’est dans aucun bloc : choisis-en une autre.'); end if;
  v_truck := coalesce(p_truck, case when j.truck_id is not null and public.exact_works(j.truck_id, p_day, v_block) then j.truck_id end);
  return public.move_job(null::uuid, p_job, p_day, v_block, v_truck) || jsonb_build_object('exact', false, 'at', p_at);
end $$;

-- move_job with 8 arguments (S2): the claim first (op_begin), as every operation; p_exact null → the 7-argument move
create or replace function public.move_job(p_op uuid, p_job uuid, p_day date, p_block text, p_truck uuid, p_win_start integer, p_win_flex boolean, p_exact jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_done jsonb; v_res jsonb; v_at integer;
begin
  v_done := public.op_begin(p_op, 'move_job');
  if v_done is not null then return v_done; end if;
  if p_exact is null or jsonb_typeof(p_exact) = 'null' then
    v_res := public.move_job(null::uuid, p_job, p_day, p_block, p_truck, p_win_start, p_win_flex);
    return public.op_save(p_op, 'move_job', v_res);
  end if;
  if jsonb_typeof(p_exact) = 'object' and jsonb_typeof(p_exact->'at') = 'number'
     and (p_exact->>'at')::numeric between 0 and 1439 and (p_exact->>'at')::numeric = floor((p_exact->>'at')::numeric) then
    v_at := (p_exact->>'at')::int;
  end if;
  -- (a minute that is not a whole minute of the day stays null: exact_move refuses it « bad_window », after the right)
  -- never in the middle of the switch between blocks and windows (as every booking and move)
  perform pg_advisory_xact_lock_shared(hashtext('windows_switch'));
  v_res := public.exact_move(p_job, p_day, p_truck, v_at,
    case when jsonb_typeof(p_exact->'late_ok') = 'array' then p_exact->'late_ok' else '[]'::jsonb end, true);
  return public.op_save(p_op, 'move_job', v_res);
end $$;

-- move_preview(job, day, truck, minute) (S5): what that move would answer, nothing written (the move itself, every late
-- accepted, inside a block always undone, as the other previews: tests/db/exact-move.test.mjs), « Vraies routes » on or
-- off, windows or blocks. Its refusals are the move's (thrown, the same hint, words and detail), but « late_changed »:
-- the preview SAYS who would be late (stops[].late, over_hours) instead
create or replace function public.move_preview(p_job uuid, p_day date, p_truck uuid, p_at integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb; v_done boolean := false;
begin
  perform pg_advisory_xact_lock_shared(hashtext('windows_switch'));
  begin
    perform set_config('garage.trial', 'on', true);
    v_out := public.exact_move(p_job, p_day, p_truck, p_at, null, false);
    v_done := true;
    raise exception 'move_preview: undone' using errcode = 'P0001', hint = 'preview_undone';
  exception when others then
    if not v_done then raise; end if;
  end;
  return v_out;
end $$;

-- rights: the app calls move_job (8 arguments) and move_preview (this form); each checks the right of the move inside.
-- The rest is the server's own
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array['exact_works', 'exact_try', 'exact_view', 'exact_run', 'exact_hm',
             'exact_place', 'exact_move', 'route_hold'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
revoke all on function public.move_job(uuid, uuid, date, text, uuid, integer, boolean, jsonb) from public, anon;
grant execute on function public.move_job(uuid, uuid, date, text, uuid, integer, boolean, jsonb) to authenticated, service_role;
revoke all on function public.move_preview(uuid, date, uuid, integer) from public, anon;
grant execute on function public.move_preview(uuid, date, uuid, integer) to authenticated, service_role;
