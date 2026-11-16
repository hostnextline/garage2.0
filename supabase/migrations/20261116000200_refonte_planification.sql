-- Part 26 — « Refonte », the planner: bookings, arrival windows, moves, order of the stops (database side).
--
-- Every function below is written in full from its LIVE text (the running body, read from the database), with only the
-- lines a verified finding of the audit of 2026-11-15 needs. Nothing is removed or renamed, no argument changes, every
-- answer keeps its fields (some gain new ones). Each operation now claims its id first (op_begin, Part 26 base): the
-- same request delivered twice at the same instant runs once.
--
-- 1. Nobody is thrown to « À placer » by somebody else's gesture: a block already started is never planned again
--    (« Ordre des arrêts », a move out of it), an operation on one appointment never un-places another one, an
--    automatic re-plan (address found, cancellation, the evening's lock) leaves a block as it is rather than un-place.
-- 2. « Plages d'arrivée »: the calendar's lattice, the stop numbers of a day already started, the hours with a break,
--    the flexible appointments (lock without pg_cron, who is still to be told), the switch back to the blocks (the
--    block of the arrival, the window kept, whom to call), a re-plan that would make a promised stop late (the stored
--    routes as the seed), « réservé quand même » in its window, the « garde-route » numbers of each window.
-- 3. Operations kept on a phone in the other mode are converted as the switch converts an appointment.
-- 4. « Peu importe » (car or truck), « Routes partagées » (my vehicle first), an estimate booked once, a vehicle that
--    loses the tire machine, what a move really changed (`tell`).
--
-- Sections: 0 helpers · 1 apply_plan · 2 set_stop_order · 3 move_job · 4 set_job_duration · 5 book_job · 6 flexible
-- windows · 7 suggest_windows_core, suggest_core · 8 windows_switch · 9 my_truck_ids, walk_in, job_step · 10 plan_route
-- (plan_block's body) and plan_block · 11 replan_block, replan_days · 12 trucks_kind_keep.
-- New refusal codes: quote_done (book_job), no_truck (walk_in). No new table, no new column.

-- ---------------------------------------------------------------------------------------------------------------------
-- 0. Small helpers of this Part (server only)
-- ---------------------------------------------------------------------------------------------------------------------

-- The plan of an operation asked by a person on ONE appointment (booking, move, order, length): written with the rule
-- « the others keep their place » (apply_plan reads garage.keep), put back as it was afterwards.
create or replace function public.apply_plan_keep(p_plan jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_was text := coalesce(current_setting('garage.keep', true), ''); n int;
begin
  perform set_config('garage.keep', 'on', true);
  n := public.apply_plan(p_plan);
  perform set_config('garage.keep', v_was, true);
  return n;
end $$;

-- An automatic re-plan (a cancellation, an address found later, the evening's lock): when the new plan would throw an
-- appointment that has a truck to « À placer », the block stays as it was (the rule the day's chain already follows):
-- nobody changes truck or place, only the arrival times are walked again in the stored order (route_retime), so a
-- position found still counts. A day of windows already started keeps its own rule (apply_plan never un-places there).
create or replace function public.replan_block_safe(p_day date, p_block text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_plan jsonb; v_today boolean; tk record;
begin
  if not public.block_open(p_day, p_block) then return jsonb_build_object('skipped', true, 'day', p_day, 'block', p_block); end if;
  perform public.lock_block(p_day, p_block);
  v_plan := public.plan_block(p_day, p_block);
  v_today := p_block = 'day' and p_day = public.local_today() and public.windows_on()
             and public.now_min() >= (select s.start_min from public.day_span() s);
  if not v_today and exists (select 1 from jsonb_array_elements_text(coalesce(v_plan->'over', '[]'::jsonb)) o
                             join public.jobs j on j.id = o::uuid where j.truck_id is not null) then
    for tk in select distinct j.truck_id from public.jobs j
              where j.day = p_day and j.block = p_block and j.deleted_at is null and j.status = 'booked' and j.truck_id is not null loop
      perform public.route_retime(tk.truck_id, p_day, p_block);
    end loop;
    return jsonb_build_object('skipped', true, 'kept', true, 'day', p_day, 'block', p_block);
  end if;
  perform public.apply_plan(v_plan);
  return v_plan;
end $$;

-- The block a window belongs to when the garage books by blocks: the block with those very hours, else the block of the
-- arrival the window was cut around (its start + « avant », win_for's rule), else the one that holds most of the window
-- (the earliest when two hold as much). No block touches it: null.
create or replace function public.block_of_window(p_ws integer, p_we integer) returns text
language sql stable security definer set search_path = public as $$
  select x.key from public.blocks_set() x
  where p_ws is not null and least(x.end_min, coalesce(p_we, p_ws + 1)) > greatest(x.start_min, p_ws)
  order by (x.start_min = p_ws and x.end_min = coalesce(p_we, x.end_min)) desc,
           (p_ws + public.bset('win_before_min', 60)::int >= x.start_min and p_ws + public.bset('win_before_min', 60)::int < x.end_min) desc,
           least(x.end_min, coalesce(p_we, p_ws + 1)) - greatest(x.start_min, p_ws) desc, x.pos
  limit 1
$$;

-- The arrival times of ONE truck's stops of a block, walked in the order they are numbered, nothing else touched: used
-- when the planner must not run (a block already started, an order by hand that would un-place somebody).
-- Started today: from now and from where the truck is (the stop it is at, else the last one it finished).
create or replace function public.route_retime(p_truck uuid, p_day date, p_block text) returns void
language plpgsql security definer set search_path = public as $$
declare b record; r record;
  v_speed numeric := public.bset('speed_kmh', 35); v_detour numeric := public.bset('detour', 1.3);
  v_stop numeric := public.bset('stop_min', 5); v_unknown numeric := public.bset('unknown_min', 20);
  v_started boolean; tm int; plat double precision; plng double precision; leg int; v_prev text;
begin
  select * into b from public.blocks() x where x.key = p_block;
  if not found or p_truck is null or p_day is null then return; end if;
  v_started := p_day = public.local_today() and public.now_min() >= b.start_min;
  if v_started then
    tm := (ceil(public.now_min() / 5.0) * 5)::int;
    select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into plat, plng from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.truck_id = p_truck and j.day = p_day and j.deleted_at is null and j.status = 'done'
      and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
    order by j.finished_at desc nulls last, j.stop_order desc nulls last limit 1;
  else
    tm := coalesce(public.ranges_first(public.truck_ranges(p_truck, p_day), b.start_min, b.end_min), b.start_min);
    select x.key into v_prev from public.blocks() x where x.pos = b.pos - 1;
    if v_prev is not null then
      select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into plat, plng from public.jobs j left join public.customers c on c.id = j.customer_id
      where j.truck_id = p_truck and j.day = p_day and j.block = v_prev and j.deleted_at is null and j.status not in ('cancelled','no_show')
        and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
      order by j.stop_order desc nulls last, j.eta_min desc nulls last limit 1;
    end if;
  end if;
  if plat is null then
    select coalesce((tr.start->>'lat')::double precision, h.lat), coalesce((tr.start->>'lng')::double precision, h.lng) into plat, plng
    from public.home_point() h left join public.trucks tr on tr.id = p_truck;
  end if;
  perform set_config('garage.rpc', 'on', true);
  for r in
    select j.id, j.status, j.duration_min, j.arrived_at, coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng,
           case when p_block = 'day' and public.windows_on() and not j.forced and j.manual_order is null then j.win_start end ws
    from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.truck_id = p_truck and j.day = p_day and j.block = p_block and j.deleted_at is null and j.status in ('en_route','on_site','booked')
    order by (j.status in ('en_route','on_site')) desc, j.stop_order nulls last, j.eta_min nulls last, j.created_at
  loop
    if r.status = 'on_site' then
      -- there already: only the work that is left
      tm := tm + greatest(0, r.duration_min - coalesce(floor(extract(epoch from (now() - r.arrived_at)) / 60)::int, 0));
    else
      leg := public.drive_min(plat, plng, r.lat, r.lng, v_speed, v_detour, v_unknown);
      tm := tm + leg;
      -- early at a stop with a window: the truck waits until it opens (as the planner)
      if r.status = 'booked' and r.ws is not null and tm < r.ws then tm := r.ws; end if;
      if r.status = 'booked' then
        update public.jobs set eta_min = tm, travel_min = leg + ceil(v_stop)::int
        where id = r.id and (eta_min, travel_min) is distinct from (tm, leg + ceil(v_stop)::int);
      end if;
      tm := tm + ceil(v_stop)::int + r.duration_min;
    end if;
    if r.lat is not null and r.lng is not null then plat := r.lat; plng := r.lng; end if;
  end loop;
end $$;

revoke all on function public.apply_plan_keep(jsonb) from public, anon, authenticated;
revoke all on function public.replan_block_safe(date, text) from public, anon, authenticated;
revoke all on function public.block_of_window(integer, integer) from public, anon, authenticated;
revoke all on function public.route_retime(uuid, date, text) from public, anon, authenticated;
grant execute on function public.apply_plan_keep(jsonb) to service_role;
grant execute on function public.replan_block_safe(date, text) to service_role;
grant execute on function public.block_of_window(integer, integer) to service_role;
grant execute on function public.route_retime(uuid, date, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Writing a plan: who may lose a place
-- ---------------------------------------------------------------------------------------------------------------------

-- apply_plan (live text) with three guards:
--   * a job en route / on site whose truck is no longer in the plan keeps its stop number and its times (they were
--     written null);
--   * only an appointment still « booked » is written (a « Je pars » that landed between the plan and the write wins);
--   * nobody is thrown to « À placer » in a block already started or of a past day, nor by an operation on ONE
--     appointment (garage.keep, see apply_plan_keep). Closing hours, a truck switched off, a new start: as before;
--   * window mode, today: the stops already done are numbered 1, 2, … in the order they were finished, the plan numbers
--     the others after them (they were numbered from 1 again while the done ones kept theirs).
create or replace function public.apply_plan(p_plan jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare k text; v jsonb; n int := 0; c int; d date := nullif(p_plan->>'day', '')::date; bk record; p jsonb; v_moved boolean := false; v_keep boolean;
begin
  perform set_config('garage.rpc', 'on', true);
  for k, v in select * from jsonb_each(coalesce(p_plan->'jobs', '{}')) loop
    if coalesce((v->>'fixed')::boolean, false) then
      update public.jobs set stop_order = (v->>'order')::int, eta_min = (v->>'eta')::int, travel_min = (v->>'travel')::int
      where id = k::uuid and v ? 'order' and (stop_order, eta_min, travel_min) is distinct from ((v->>'order')::int, (v->>'eta')::int, (v->>'travel')::int);
    else
      update public.jobs set truck_id = (v->>'truck')::uuid, stop_order = (v->>'order')::int, eta_min = (v->>'eta')::int, travel_min = (v->>'travel')::int,
        truck_pinned = truck_pinned and truck_id = (v->>'truck')::uuid
      where id = k::uuid and status = 'booked' and (truck_id, stop_order, eta_min, travel_min) is distinct from ((v->>'truck')::uuid, (v->>'order')::int, (v->>'eta')::int, (v->>'travel')::int);
    end if;
    get diagnostics c = row_count; n := n + c;
  end loop;
  v_keep := (p_plan->>'block' = 'day' and d is not null and d = public.local_today() and public.windows_on()
            and public.now_min() >= (select s.start_min from public.day_span() s))
            -- a block already started, or of a past day: its appointments stay on their truck
            or (d is not null and not public.block_open(d, p_plan->>'block'))
            -- an operation on one appointment: the others keep their place
            or coalesce(current_setting('garage.keep', true), '') = 'on';
  if not coalesce(v_keep, false) then
    update public.jobs set truck_id = null, stop_order = null, eta_min = null, travel_min = null, truck_pinned = false
    where id in (select x::uuid from jsonb_array_elements_text(coalesce(p_plan->'over', '[]')) x)
      and status = 'booked' and (truck_id is not null or stop_order is not null);
    get diagnostics c = row_count; n := n + c;
  end if;
  -- window mode, today: the stops already done keep 1, 2, … on their truck, in the order they were finished (the plan
  -- numbers the others after them)
  if p_plan->>'block' = 'day' and d is not null and d = public.local_today() and public.windows_on() then
    update public.jobs j set stop_order = q.rn
    from (select x.id, (row_number() over (partition by x.truck_id order by x.finished_at nulls last, x.stop_order nulls last, x.id))::int rn
          from public.jobs x where x.day = d and x.block = 'day' and x.status = 'done' and x.truck_id is not null and x.deleted_at is null) q
    where q.id = j.id and j.stop_order is distinct from q.rn;
  end if;

  if n > 0 and d is not null and coalesce(current_setting('garage.chain', true), '') <> 'on' then
    perform set_config('garage.chain', 'on', true);
    for bk in select b.key, b.start_min from public.blocks() b order by b.pos loop
      -- the block just written: again only when a block before it now ends elsewhere
      continue when bk.key = p_plan->>'block' and not v_moved;
      continue when not public.block_open(d, bk.key);
      continue when not exists (select 1 from public.jobs j where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked');
      continue when not pg_try_advisory_xact_lock(hashtext('block:' || d::text || ':' || bk.key));
      p := public.plan_block(d, bk.key);
      continue when exists (select 1 from jsonb_array_elements_text(coalesce(p->'over', '[]')) o join public.jobs j on j.id = o::uuid where j.truck_id is not null);
      if public.apply_plan(p) > 0 then v_moved := true; end if;
    end loop;
    perform set_config('garage.chain', '', true);
    perform set_config('garage.rpc', 'on', true);
  end if;
  return n;
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. « Ordre des arrêts »
-- ---------------------------------------------------------------------------------------------------------------------

-- The order of ONE truck's stops in ONE block (the checks of who may are done by set_stop_order).
-- The block is planned again only while it is open AND when that throws nobody to « À placer »; otherwise only this
-- truck's booked stops are numbered again (the list, then the others as they were) and timed again: nobody changes
-- truck, the other trucks are not touched, the stops en route / on site and the finished ones keep their numbers.
create or replace function public.stop_order_one(p_truck uuid, p_day date, p_block text, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_plan jsonb; v_direct boolean := true; v_base int;
begin
  perform public.lock_block(p_day, p_block);
  if exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.jobs j where j.id = x and j.truck_id = p_truck and j.day = p_day
             and j.block = p_block and j.deleted_at is null and j.status = 'booked')) then
    perform public.fail('changed', 'Un des rendez-vous n’est plus dans cette route (parti, fini ou déplacé). Rouvre la liste.');
  end if;
  perform set_config('garage.rpc', 'on', true);
  update public.jobs set manual_order = null
  where truck_id = p_truck and day = p_day and block = p_block and manual_order is not null and not (id = any(p_ids));
  update public.jobs j set manual_order = x.o from unnest(p_ids) with ordinality x(id, o) where j.id = x.id and j.manual_order is distinct from x.o::int;
  if public.block_open(p_day, p_block) then
    v_plan := public.plan_block(p_day, p_block);
    v_direct := not exists (select 1 from jsonb_array_elements(v_plan->'trucks') t where t->>'id' = p_truck::text)
      or exists (select 1 from jsonb_array_elements_text(coalesce(v_plan->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid where j.truck_id is not null);
    if not v_direct then perform public.apply_plan_keep(v_plan); end if;
  end if;
  if v_direct then
    select coalesce(max(j.stop_order), 0) into v_base from public.jobs j
    where j.truck_id = p_truck and j.day = p_day and j.block = p_block and j.deleted_at is null and j.status in ('en_route','on_site','done');
    update public.jobs j set stop_order = v_base + q.rn
    from (select x.id, (row_number() over (order by array_position(p_ids, x.id) nulls last, x.stop_order nulls last, x.eta_min nulls last, x.created_at))::int rn
          from public.jobs x where x.truck_id = p_truck and x.day = p_day and x.block = p_block and x.deleted_at is null and x.status = 'booked') q
    where q.id = j.id and j.stop_order is distinct from v_base + q.rn;
    perform public.route_retime(p_truck, p_day, p_block);
  end if;
end $$;
revoke all on function public.stop_order_one(uuid, date, text, uuid[]) from public, anon, authenticated;
grant execute on function public.stop_order_one(uuid, date, text, uuid[]) to service_role;

-- set_stop_order (live text): the claim first; a null truck is no longer « mine »; a block already started is not planned
-- again (stop_order_one); an order kept on a phone in the other mode is converted (a block's order → the day's,
-- the day's order → each block's own part of it) instead of « Bloc inconnu ».
create or replace function public.set_stop_order(p_op uuid, p_truck uuid, p_day date, p_block text, p_jobs uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_done jsonb; v_ids uuid[] := coalesce(p_jobs, '{}'); v_wm boolean; bk record; v_part uuid[]; v_rows jsonb := '[]'::jsonb; n int := 0;
begin
  v_done := public.op_begin(p_op, 'set_stop_order');
  if v_done is not null then return v_done; end if;
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi.'); end if;
  if not (public.is_owner() or public.can('book') or coalesce(p_truck = any(public.my_truck_ids()), false)) then
    perform public.fail('not_allowed', 'Tu ne peux pas changer l’ordre de ce camion. Parle au propriétaire.');
  end if;
  perform pg_advisory_xact_lock_shared(hashtext('windows_switch'));
  v_wm := public.windows_on();
  if p_day is null or p_truck is null
     or not (exists (select 1 from public.blocks() x where x.key = p_block)
             or (v_wm and exists (select 1 from public.blocks_set() x where x.key = p_block))
             or (not v_wm and p_block = 'day')) then
    perform public.fail('bad_block', 'Bloc inconnu.');
  end if;
  if p_day < public.local_today() then perform public.fail('past', 'Cette journée est passée.'); end if;
  if cardinality(v_ids) > 200 or cardinality(v_ids) <> cardinality(array(select distinct x from unnest(v_ids) x)) then
    perform public.fail('bad_list', 'La liste des arrêts n’est pas bonne.');
  end if;
  if not v_wm and p_block = 'day' then
    -- an order of the whole day, made while the garage booked by windows: each block takes its own part of it
    for bk in select x.key from public.blocks() x order by x.pos loop
      v_part := array(select u.x from unnest(v_ids) with ordinality u(x, o) join public.jobs j on j.id = u.x and j.day = p_day and j.block = bk.key order by u.o);
      n := n + cardinality(v_part);
      perform public.stop_order_one(p_truck, p_day, bk.key, v_part);
      v_rows := v_rows || public.block_rows(p_day, bk.key);
    end loop;
    if n <> cardinality(v_ids) then
      perform public.fail('changed', 'Un des rendez-vous n’est plus dans cette route (parti, fini ou déplacé). Rouvre la liste.');
    end if;
  else
    -- an order of one block, made while the garage booked by blocks: its stops are in the day's route now
    if v_wm then p_block := 'day'; end if;
    perform public.stop_order_one(p_truck, p_day, p_block, v_ids);
    v_rows := public.block_rows(p_day, p_block);
  end if;
  return public.op_save(p_op, 'set_stop_order', jsonb_build_object('ok', true, 'rows', jsonb_build_object('jobs', v_rows)));
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Moving an appointment
-- ---------------------------------------------------------------------------------------------------------------------

-- « Peu importe » (car or truck, nothing said): the planner tries the car first while it places the stops farthest
-- first, so the newcomer could take the car's last room before the car's own appointments were placed, and the block
-- answered « complet » while the truck was empty. The plan with the stop is made as before; when it does not fit, no
-- vehicle was named and the garage has both kinds working that block, it is made again for the truck.
create or replace function public.plan_extra(p_day date, p_block text, p_x jsonb, p_exclude uuid, p_plan0 jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p1 jsonb; p2 jsonb; v_kind text;
begin
  p1 := public.plan_block(p_day, p_block, p_x, p_exclude);
  if public.plan_fits(p_plan0, p1) or nullif(p_x->>'truck', '') is not null or coalesce((p_x->>'force')::boolean, false) then return p1; end if;
  v_kind := case when coalesce((p_x->>'need')::boolean, false) then 'truck'
                 when p_x ? 'kind' or p_x ? 'need' then nullif(p_x->>'kind', '')
                 else (select case when jj.needs_machine then 'truck' else jj.vehicle_kind end from public.jobs jj where jj.id = (p_x->>'id')::uuid) end;
  if v_kind is not null
     or not exists (select 1 from jsonb_array_elements(p1->'trucks') t where coalesce((t->>'machine')::boolean, true))
     or not exists (select 1 from jsonb_array_elements(p1->'trucks') t where not coalesce((t->>'machine')::boolean, true)) then
    return p1;
  end if;
  p2 := public.plan_block(p_day, p_block, p_x || jsonb_build_object('kind', 'truck'), p_exclude);
  return case when public.plan_fits(p_plan0, p2) then p2 else p1 end;
end $$;
revoke all on function public.plan_extra(date, text, jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.plan_extra(date, text, jsonb, uuid, jsonb) to service_role;

-- move_job (live text), with:
--   * the claim first, and never in the middle of the switch between blocks and windows;
--   * a job « À placer » is nobody's own (a null truck let the check through);
--   * a move kept on a phone in the other mode is converted (a block → the window of that block's hours; a window →
--     its block, the window kept on the job as what the customer was told) instead of bad_block;
--   * the job is read again once the blocks are locked, and only an appointment still « booked » is written;
--   * work for the tire machine is not put on the car (needs_truck, as when booking);
--   * the block it leaves is planned again only while it is open: a block already started (or a past day) keeps every
--     other appointment on its truck, only the hole in the numbers is closed (today);
--   * « réservé quand même » ends with a move: the job fits where it now is;
--   * the answer says what really changed: `changed` as before (the day or the block), and new `tell` (what the
--     customer was told is no longer true: day, block or window), `window_changed`, `truck_changed`, `was`, `now`.
create or replace function public.move_job(p_op uuid, p_job uuid, p_day date, p_block text, p_truck uuid, p_win_start integer, p_win_flex boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_done jsonb;
  j public.jobs; jn public.jobs; b record; v_lat double precision; v_lng double precision; v_plan0 jsonb; v_plan1 jsonb; v_res jsonb;
  v_wm boolean; v_ws int; v_we int; v_flex boolean := false; v_moved boolean; v_same boolean := true;
  v_x jsonb; v_eta int; sp record; v_blk record; v_wend int; v_pws int; v_pwe int; v_tell boolean; v_winch boolean;
begin
  v_done := public.op_begin(p_op, 'move_job');
  if v_done is not null then return v_done; end if;
  perform pg_advisory_xact_lock_shared(hashtext('windows_switch'));
  v_wm := public.windows_on();
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if not (public.can('book') or (p_truck is not null and coalesce(p_truck = any(public.my_truck_ids()), false) and coalesce(j.truck_id = any(public.my_truck_ids()), false))) then
    perform public.fail('not_allowed', 'Tu ne peux pas déplacer ce rendez-vous.');
  end if;
  if j.status <> 'booked' then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  -- a move made in the other mode (kept on a phone, or an app not yet up to date): converted as the switch converts a job
  if v_wm and p_block is distinct from 'day' then
    select * into v_blk from public.blocks_set() x where x.key = p_block;
    if found then
      p_block := 'day';
      if p_win_start is null and p_win_flex is null and (p_day is distinct from j.day or j.block <> 'day') then
        p_win_start := v_blk.start_min; v_wend := v_blk.end_min;
      end if;
    end if;
  elsif not v_wm and p_block = 'day' then
    if p_win_start is not null then
      p_block := coalesce(public.block_of_window(p_win_start, p_win_start + public.win_len()), p_block);
      if p_block <> 'day' and not exists (select 1 from public.blocks_set() x where x.key = p_block and x.start_min = p_win_start and x.end_min = p_win_start + public.win_len()) then
        v_pws := p_win_start; v_pwe := p_win_start + public.win_len();
      end if;
    elsif p_day = j.day and exists (select 1 from public.blocks() x where x.key = j.block) then
      p_block := j.block;
    end if;
  end if;
  select * into b from public.blocks() x where x.key = p_block;
  if not found then
    perform public.fail('bad_block', case when v_wm then 'Le garage donne maintenant une plage d’arrivée de 4 heures : choisis une plage au lieu d’un bloc.' else 'Bloc inconnu.' end);
  end if;
  if not public.block_open(p_day, p_block) then
    perform public.fail('block_started', case when v_wm then 'Cette journée est finie : choisis une autre journée.' else 'Ce bloc est déjà commencé.' end);
  end if;
  if p_truck is not null and j.needs_machine and exists (select 1 from public.trucks tr where tr.id = p_truck and not tr.tire_machine) then
    perform public.fail('needs_truck', 'Ce travail demande le camion (montage ou balancement des pneus) : la voiture ne peut pas le faire.');
  end if;
  -- the two blocks, always locked in the same order (day, then morning → evening); then the job as it is NOW
  perform public.lock_two(j.day, j.block, p_day, p_block);
  select * into jn from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if jn.status <> 'booked' then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  if (jn.day, jn.block) is distinct from (j.day, j.block) then
    perform public.fail('changed', 'Ce rendez-vous vient d’être déplacé par quelqu’un d’autre. Rouvre-le et recommence.');
  end if;
  j := jn;
  v_moved := j.day <> p_day or j.block <> p_block;
  if v_wm then
    if coalesce(p_win_flex, false) then
      v_flex := true; v_ws := null;
      v_same := j.win_flex;
      if v_same then v_ws := j.win_start; v_we := j.win_end; end if;       -- already flexible: its window, if fixed, stays
    elsif p_win_start is not null then
      v_flex := false; v_ws := p_win_start; v_we := coalesce(v_wend, p_win_start + public.win_len());
      v_same := not j.win_flex and j.win_start is not distinct from p_win_start;
      select * into sp from public.day_span();
      if v_ws < sp.start_min or v_we > greatest(sp.end_min, sp.start_min + public.win_len()) then
        perform public.fail('bad_window', 'Cette plage n’est pas dans les heures de la journée : choisis-en une autre.');
      end if;
      if p_day = public.local_today() and public.now_min() > v_we then
        perform public.fail('window_full', 'Cette plage n’est plus libre : choisis-en une autre.');
      end if;
    elsif p_win_flex is not null then
      v_flex := false; v_ws := null; v_same := false;                      -- a window cut around the planned arrival
    elsif not v_moved then
      v_flex := j.win_flex; v_ws := j.win_start; v_we := j.win_end;        -- the same day: what the customer was told
    else
      v_flex := j.win_flex; v_ws := null;
    end if;
    if v_moved and v_flex then v_ws := null; v_we := null; end if;         -- flexible on another day: fixed again later
  elsif not v_moved then
    v_pws := j.win_start; v_pwe := j.win_end;                              -- blocks, the same moment: what was told stays on the job
  end if;
  if not v_moved and v_same and p_truck is not distinct from (case when j.truck_pinned then j.truck_id end) then
    return public.op_save(p_op, 'move_job', jsonb_build_object('ok', true, 'unchanged', true, 'changed', false, 'tell', false,
      'rows', jsonb_build_object('jobs', jsonb_build_array(to_jsonb(j)))));
  end if;
  select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into v_lat, v_lng from public.customers c where c.id = j.customer_id;
  v_x := jsonb_build_object('id', j.id, 'lat', v_lat, 'lng', v_lng, 'dur', j.duration_min, 'truck', p_truck,
    -- a vehicle chosen by hand: its kind becomes the job's (work for the tire machine still needs the machine)
    'need', j.needs_machine, 'kind', case when p_truck is not null then (select case when tr.tire_machine then 'truck' else 'car' end from public.trucks tr where tr.id = p_truck) else j.vehicle_kind end)
    || case when v_wm then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end;
  v_plan0 := public.plan_block(p_day, p_block, null, j.id);
  v_plan1 := public.plan_extra(p_day, p_block, v_x, j.id, v_plan0);
  if jsonb_array_length(v_plan1->'trucks') = 0 then
    perform public.fail('block_closed', case when v_wm then 'Cette journée est fermée : aucun camion ne travaille.' else 'Ce bloc est fermé ce jour-là.' end);
  end if;
  if not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o))
     or public.plan_late_new(v_plan0, v_plan1) then
    if v_ws is not null then
      v_res := public.plan_block(p_day, p_block, v_x || jsonb_build_object('ws', null, 'we', null), j.id);
      if coalesce((v_res->'extra'->>'placed')::boolean, false)
         and not exists (select 1 from jsonb_array_elements_text(v_res->'over') o where not ((v_plan0->'over') ? o))
         and not public.plan_late_new(v_plan0, v_res) then
        perform public.fail('window_full', 'Cette plage n’est plus libre : choisis-en une autre.');
      end if;
    end if;
    perform public.fail('block_full', case when v_wm then 'Cette journée est complète : la route ne rentre plus dans le temps.' else 'Ce bloc est complet : la route ne rentre plus dans le temps.' end);
  end if;
  if p_truck is not null and (v_plan1->'extra'->>'truck')::uuid is distinct from p_truck then
    perform public.fail('truck_full', 'Ce camion n’a plus de place dans ce bloc.');
  end if;
  perform set_config('garage.rpc', 'on', true);
  update public.jobs set day = p_day, block = p_block, truck_id = (v_plan1->'extra'->>'truck')::uuid, truck_pinned = p_truck is not null,
    win_start = case when v_wm then v_ws else v_pws end, win_end = case when v_wm then v_we else v_pwe end, win_flex = v_flex,
    -- it fits where it now is: no longer « réservé quand même »
    forced = false,
    -- a new window is a new moment: the place chosen by hand in the route is forgotten, the customer is told again
    manual_order = case when v_wm and v_ws is distinct from win_start then null else manual_order end,
    confirm_sent_at = case when day <> p_day or block <> p_block or (v_ws is not null and v_ws is distinct from win_start) then null else confirm_sent_at end
  where id = j.id and status = 'booked';
  if not found then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  perform public.apply_plan_keep(v_plan1);
  if v_moved and exists (select 1 from public.blocks() x where x.key = j.block) then
    if public.block_open(j.day, j.block) then
      perform public.apply_plan_keep(public.plan_block(j.day, j.block));
    elsif j.day = public.local_today() and j.truck_id is not null and j.stop_order is not null then
      -- a block already started: nobody is planned again, the stops after it move up by one
      update public.jobs set stop_order = stop_order - 1
      where truck_id = j.truck_id and day = j.day and block = j.block and deleted_at is null and id <> j.id
        and status in ('booked','en_route','on_site') and stop_order > j.stop_order
        and not exists (select 1 from public.jobs o where o.truck_id = j.truck_id and o.day = j.day and o.block = j.block and o.deleted_at is null
                        and o.id <> j.id and o.status not in ('cancelled','no_show') and o.stop_order = j.stop_order);
    end if;
  end if;
  -- no window said: it is cut around the planned arrival (a flexible job only once its day is locked). Nothing moves.
  if v_wm and v_ws is null and (not v_flex or public.win_lock_due(p_day)) then
    perform set_config('garage.rpc', 'on', true);
    select x.eta_min into v_eta from public.jobs x where x.id = j.id;
    update public.jobs set win_start = w.win_start, win_end = w.win_end,
      confirm_sent_at = case when j.win_start is distinct from w.win_start then null else confirm_sent_at end
    from public.win_for(v_eta) w where id = j.id;
  end if;
  -- what really changed for the customer (the day, the block, the window): told again
  select * into jn from public.jobs where id = j.id;
  v_winch := (j.win_start, j.win_end) is distinct from (jn.win_start, jn.win_end);
  v_tell := v_moved or (v_wm and v_winch);
  if v_tell and jn.confirm_sent_at is not null then
    perform set_config('garage.rpc', 'on', true);
    update public.jobs set confirm_sent_at = null where id = j.id;
  end if;
  v_res := jsonb_build_object('ok', true, 'job_id', j.id, 'changed', v_moved, 'tell', v_tell, 'window_changed', v_winch,
    'truck_changed', j.truck_id is distinct from jn.truck_id,
    'was', jsonb_build_object('day', j.day, 'block', j.block, 'win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex, 'truck_id', j.truck_id),
    'now', jsonb_build_object('day', jn.day, 'block', jn.block, 'win_start', jn.win_start, 'win_end', jn.win_end, 'win_flex', jn.win_flex, 'truck_id', jn.truck_id),
    'rows', jsonb_build_object('jobs', public.block_rows(p_day, p_block) || case when v_moved then public.block_rows(j.day, j.block) else '[]'::jsonb end));
  return public.op_save(p_op, 'move_job', v_res);
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. A longer job
-- ---------------------------------------------------------------------------------------------------------------------

-- set_job_duration (live text): the claim first; a job « À placer » is nobody's own; the job is read again under the
-- lock; a longer job is refused when ANOTHER appointment would lose its place (or its window) for it, and the plan
-- really written is checked again (the first check plans the job apart, the plan written plans it as it is).
create or replace function public.set_job_duration(p_op uuid, p_job uuid, p_duration integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_done jsonb; j public.jobs; v_plan0 jsonb; v_plan jsonb; v_lat double precision; v_lng double precision; v_res jsonb;
  v_day date; v_block text; v_full text;
begin
  v_done := public.op_begin(p_op, 'set_job_duration');
  if v_done is not null then return v_done; end if;
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if not (public.can('book') or coalesce(j.truck_id = any(public.my_truck_ids()), false)) then perform public.fail('not_allowed', 'Tu ne peux pas changer ce rendez-vous.'); end if;
  p_duration := greatest(15, least(720, coalesce(p_duration, j.duration_min)));
  perform set_config('garage.rpc', 'on', true);
  v_day := j.day; v_block := j.block;
  if j.status = 'booked' and public.block_open(j.day, j.block) then
    perform public.lock_block(j.day, j.block);
    select * into j from public.jobs where id = p_job and deleted_at is null;
    if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
    if (j.day, j.block) is distinct from (v_day, v_block) then
      perform public.fail('changed', 'Ce rendez-vous vient d’être déplacé par quelqu’un d’autre. Rouvre-le et recommence.');
    end if;
  end if;
  if j.status = 'booked' and public.block_open(j.day, j.block) then
    v_full := case when j.block = 'day' then 'Avec cette durée, la job ne rentre plus dans la journée sans déranger un autre rendez-vous. Déplace-la ou raccourcis-la.'
                   else 'Avec cette durée, la job ne rentre plus dans le bloc. Déplace-la ou raccourcis-la.' end;
    select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into v_lat, v_lng from public.customers c where c.id = j.customer_id;
    v_plan0 := public.plan_block(j.day, j.block);
    v_plan := public.plan_block(j.day, j.block, jsonb_build_object('id', j.id, 'lat', v_lat, 'lng', v_lng, 'dur', p_duration, 'truck', case when j.truck_pinned then j.truck_id end), j.id);
    if p_duration > j.duration_min and (not coalesce((v_plan->'extra'->>'placed')::boolean, false)
        or exists (select 1 from jsonb_array_elements_text(coalesce(v_plan->'over', '[]'::jsonb)) o where o <> j.id::text and not (coalesce(v_plan0->'over', '[]'::jsonb) ? o))
        or exists (select 1 from jsonb_array_elements_text(coalesce(v_plan->'late', '[]'::jsonb)) o where o <> j.id::text and not (coalesce(v_plan0->'late', '[]'::jsonb) ? o))) then
      perform public.fail('block_full', v_full);
    end if;
    update public.jobs set duration_min = p_duration where id = j.id;
    v_plan := public.plan_block(j.day, j.block);
    if p_duration > j.duration_min and (
         exists (select 1 from jsonb_array_elements_text(coalesce(v_plan->'over', '[]'::jsonb)) o join public.jobs x on x.id = o::uuid
                 where x.truck_id is not null and not (coalesce(v_plan0->'over', '[]'::jsonb) ? o))
         or public.plan_late_new(v_plan0, v_plan)) then
      perform public.fail('block_full', v_full);
    end if;
    perform public.apply_plan_keep(v_plan);
  else
    -- a started block, or a job no longer booked: the length changes, nothing moves
    update public.jobs set duration_min = p_duration where id = j.id;
  end if;
  v_res := jsonb_build_object('ok', true, 'rows', jsonb_build_object('jobs', public.block_rows(j.day, j.block)));
  return public.op_save(p_op, 'set_job_duration', v_res);
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Booking
-- ---------------------------------------------------------------------------------------------------------------------

-- book_job (live text), with:
--   * the claim first, and never in the middle of the switch between blocks and windows;
--   * a booking kept on a phone in the other mode is converted as the switch converts a job (a block → the window of its
--     hours; a window → its block, the window kept on the job as what the customer was told) instead of bad_block;
--   * an estimate whose appointment is still on the agenda is not booked again (quote_done);
--   * « Peu importe » (car or truck): planned again for the truck when the car-first plan does not fit (plan_extra);
--   * nobody else loses a place for a booking (apply_plan_keep).
CREATE OR REPLACE FUNCTION public.book_job(p_op uuid, p_job jsonb, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_done jsonb;
  v_id uuid := coalesce(nullif(p_job->>'id', '')::uuid, gen_random_uuid());
  v_day date := (p_job->>'day')::date;
  v_block text := p_job->>'block';
  v_truck uuid := nullif(p_job->>'truck_id', '')::uuid;
  v_cust uuid := nullif(p_job->>'customer_id', '')::uuid;
  v_lat double precision; v_lng double precision; v_dur int; b record;
  v_plan0 jsonb; v_plan1 jsonb; v_res jsonb; it jsonb; k int := 0;
  v_force boolean := coalesce((p_job->>'force')::boolean, false); v_forced boolean := false; v_nofit boolean;
  v_need boolean := public.items_need_machine(p_items);
  v_kind text := case when p_job->>'vehicle_kind' in ('car', 'truck') then p_job->>'vehicle_kind' end;
  -- the windows (Part 25)
  v_wm boolean;
  v_ws int := nullif(p_job->>'win_start', '')::int; v_we int; v_flex boolean := coalesce((p_job->>'win_flex')::boolean, false);
  v_x jsonb; v_eta int; sp record;
  -- Part 26: a booking made in the other mode (kept on a phone); the window it was told, kept on a block job
  v_blk record; v_pws int; v_pwe int;
begin
  v_done := public.op_begin(p_op, 'book_job');
  if v_done is not null then return v_done; end if;
  -- never in the middle of the switch between blocks and windows
  perform pg_advisory_xact_lock_shared(hashtext('windows_switch'));
  v_wm := public.windows_on();
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi pour réserver.'); end if;
  if not (public.can('book') or (public.has_role('mechanic') and v_truck is not null and v_truck = any(public.my_truck_ids()))) then
    perform public.fail('not_allowed', 'Tu ne peux pas prendre de rendez-vous. Parle au propriétaire.');
  end if;
  if exists (select 1 from public.jobs where id = v_id) then perform public.fail('exists', 'Ce rendez-vous existe déjà.'); end if;
  if v_wm then
    if v_block is not null and v_block <> 'day' then
      -- a block (booked while the garage gave blocks): the window of that block's hours, as the switch converts a job
      select * into v_blk from public.blocks_set() x where x.key = v_block;
      if not found then
        perform public.fail('bad_block', 'Le garage donne maintenant une plage d’arrivée de 4 heures : choisis une plage au lieu d’un bloc.');
      end if;
      if v_ws is null and not v_flex then v_ws := v_blk.start_min; v_we := v_blk.end_min; end if;
    end if;
    v_block := 'day';
    if v_flex then v_ws := null; v_we := null; end if;
  else
    -- a window (booked while the garage gave windows): the block of that window; the window stays on the job as what
    -- the customer was told when it is not the block's own hours
    if v_block = 'day' and v_ws is not null and not v_flex then
      v_block := coalesce(public.block_of_window(v_ws, v_ws + public.win_len()), v_block);
      if v_block <> 'day' and not exists (select 1 from public.blocks_set() x where x.key = v_block and x.start_min = v_ws and x.end_min = v_ws + public.win_len()) then
        v_pws := v_ws; v_pwe := v_ws + public.win_len();
      end if;
    end if;
    v_ws := null; v_flex := false;
  end if;
  select * into b from public.blocks() x where x.key = v_block;
  if not found or v_day is null then perform public.fail('bad_block', 'Choisis la date et le bloc : matin, après-midi ou soir.'); end if;
  if not public.block_open(v_day, v_block) then
    perform public.fail('block_started', case when v_wm then 'Cette journée est finie : choisis une autre journée.' else 'Ce bloc est déjà commencé : choisis un autre bloc.' end);
  end if;
  if v_day > public.local_today() + public.bset('horizon_days', 120)::int then perform public.fail('too_far', 'Cette date est trop loin.'); end if;
  if v_cust is null or not exists (select 1 from public.customers c where c.id = v_cust and c.deleted_at is null) then
    perform public.fail('no_customer', 'Choisis le client avant de réserver.');
  end if;
  if not public.customer_visible(v_cust) then perform public.fail('not_allowed', 'Tu n’as pas accès à ce client.'); end if;
  select coalesce(nullif(p_job->>'lat', '')::double precision, c.lat), coalesce(nullif(p_job->>'lng', '')::double precision, c.lng)
    into v_lat, v_lng from public.customers c where c.id = v_cust;
  v_dur := coalesce(nullif(p_job->>'duration_min', '')::int,
    (select sum(coalesce((e->>'duration_min')::int, 0)) from jsonb_array_elements(p_items) e where coalesce(e->>'status', 'planned') = 'planned'), 60);
  v_dur := greatest(15, least(720, coalesce(nullif(v_dur, 0), 60)));

  -- an estimate already booked (its appointment still on the agenda) is not booked again
  if nullif(p_job->>'quote_id', '') is not null then
    perform 1 from public.quotes q where q.id = (p_job->>'quote_id')::uuid for update;   -- two devices booking it at once: one after the other
    if exists (select 1 from public.quotes q join public.jobs jq on jq.id = q.job_id
               where q.id = (p_job->>'quote_id')::uuid and jq.deleted_at is null and jq.status not in ('cancelled', 'no_show')) then
      perform public.fail('quote_done', 'Ce devis est déjà réservé : ouvre son rendez-vous.');
    end if;
  end if;

  if v_force and not (public.is_owner() or public.has_role('office')) then
    perform public.fail('not_allowed', 'Seuls le propriétaire et le bureau peuvent réserver dans un bloc complet.');
  end if;

  -- mounting or balancing tires: only a vehicle with the tire machine
  if v_need and (v_kind = 'car' or (v_truck is not null and not exists (select 1 from public.trucks tr where tr.id = v_truck and tr.tire_machine))) then
    perform public.fail('needs_truck', 'Ce travail demande le camion (montage ou balancement des pneus) : la voiture ne peut pas le faire.');
  end if;

  -- the window chosen: inside the day's hours, and not already over
  if v_ws is not null then
    select * into sp from public.day_span();
    v_we := coalesce(v_we, v_ws + public.win_len());
    if v_ws < sp.start_min or v_we > greatest(sp.end_min, sp.start_min + public.win_len()) then
      perform public.fail('bad_window', 'Cette plage n’est pas dans les heures de la journée : choisis-en une autre.');
    end if;
    if v_day = public.local_today() and public.now_min() > v_we then
      perform public.fail('window_full', 'Cette plage n’est plus libre : choisis-en une autre.');
    end if;
  end if;

  perform public.lock_block(v_day, v_block);
  v_x := jsonb_build_object('id', v_id, 'lat', v_lat, 'lng', v_lng, 'dur', v_dur, 'truck', v_truck, 'need', v_need, 'kind', v_kind)
    || case when v_wm then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end;
  v_plan0 := public.plan_block(v_day, v_block);
  v_plan1 := public.plan_extra(v_day, v_block, v_x, null, v_plan0);
  if jsonb_array_length(v_plan1->'trucks') = 0 then
    perform public.fail('block_closed', case when v_wm then 'Cette journée est fermée : aucun camion ne travaille.' else 'Ce bloc est fermé ce jour-là : aucun camion ne travaille.' end);
  end if;
  -- it fits when it is placed, nobody else loses a place (or a window), it is on the truck asked, and that truck stays inside
  -- its hours (a block with an appointment booked « quand même » is already past them: it takes no more)
  v_nofit := not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o))
     or public.plan_late_new(v_plan0, v_plan1)
     or (v_truck is not null and (v_plan1->'extra'->>'truck')::uuid is distinct from v_truck)
     or exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_plan1->'extra'->>'truck' and (x->>'left')::int < 0);
  if v_nofit and v_force then
    -- it does not fit: booked anyway, past the truck's hours, without taking the room of another appointment
    v_plan1 := public.plan_block(v_day, v_block, v_x || jsonb_build_object('force', true));
    v_forced := true;
  end if;
  if v_nofit and not v_forced and v_ws is not null
     and public.plan_fits(v_plan0, public.plan_block(v_day, v_block, v_x || jsonb_build_object('ws', null, 'we', null))) then
    -- the day still has room, but not inside the window chosen
    perform public.fail('window_full', 'Cette plage n’est plus libre : choisis-en une autre.');
  end if;
  if not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o))
     or (not v_forced and public.plan_late_new(v_plan0, v_plan1))
     or (not v_forced and v_truck is null and exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_plan1->'extra'->>'truck' and (x->>'left')::int < 0)) then
    perform public.fail('block_full', case when v_wm then 'Cette journée est complète : la route ne rentre plus dans le temps. Choisis une autre journée.'
      else 'Ce bloc est complet : la route ne rentre plus dans le temps. Choisis un autre bloc.' end);
  end if;
  if v_truck is not null and ((v_plan1->'extra'->>'truck')::uuid is distinct from v_truck
     or (not v_forced and exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_truck::text and (x->>'left')::int < 0))) then
    perform public.fail('truck_full', 'Ce camion n’a plus de place dans ce bloc. Laisse l’app choisir le camion, ou choisis un autre bloc.');
  end if;

  perform set_config('garage.rpc', 'on', true);
  insert into public.jobs (id, customer_id, vehicle_id, day, block, truck_id, truck_pinned, forced, duration_min, status, problem, notes,
    address, unit, postal_code, lat, lng, card_on_file, source, quote_id, created_by, needs_machine, vehicle_kind, win_start, win_end, win_flex)
  values (v_id, v_cust, nullif(p_job->>'vehicle_id', '')::uuid, v_day, v_block, (v_plan1->'extra'->>'truck')::uuid, v_truck is not null, v_forced, v_dur, 'booked',
    nullif(p_job->>'problem', ''), nullif(p_job->>'notes', ''), nullif(p_job->>'address', ''), nullif(p_job->>'unit', ''),
    nullif(p_job->>'postal_code', ''), nullif(p_job->>'lat', '')::double precision, nullif(p_job->>'lng', '')::double precision,
    coalesce((p_job->>'card_on_file')::boolean, false), coalesce(nullif(p_job->>'source', ''), 'phone'), nullif(p_job->>'quote_id', '')::uuid, auth.uid(), v_need, v_kind,
    coalesce(v_ws, v_pws), coalesce(v_we, v_pwe), v_flex);
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    k := k + 1;
    insert into public.job_items (id, job_id, kind, service_id, item_id, description, qty, unit_cents, taxable, duration_min, status, note, sort)
    values (coalesce(nullif(it->>'id', '')::uuid, gen_random_uuid()), v_id, coalesce(nullif(it->>'kind', ''), 'service'), nullif(it->>'service_id', '')::uuid,
      nullif(it->>'item_id', '')::uuid, it->>'description', coalesce((it->>'qty')::numeric, 1), coalesce((it->>'unit_cents')::int, 0),
      coalesce((it->>'taxable')::boolean, true), nullif(it->>'duration_min', '')::int, coalesce(nullif(it->>'status', ''), 'planned'), nullif(it->>'note', ''), k);
  end loop;
  if v_cust is not null and coalesce((p_job->>'card_on_file')::boolean, false) then
    update public.customers set card_on_file = true where id = v_cust and not card_on_file;
  end if;
  if nullif(p_job->>'quote_id', '') is not null then
    update public.quotes set status = 'converted', job_id = v_id where id = (p_job->>'quote_id')::uuid;
  end if;
  perform public.apply_plan_keep(v_plan1);
  -- no window chosen: it is cut around the planned arrival (a flexible job only once its day is locked). Nothing moves.
  if v_wm and v_ws is null and (not v_flex or public.win_lock_due(v_day)) then
    perform set_config('garage.rpc', 'on', true);
    select j.eta_min into v_eta from public.jobs j where j.id = v_id;
    update public.jobs set win_start = w.win_start, win_end = w.win_end from public.win_for(v_eta) w where id = v_id;
  end if;

  v_res := jsonb_build_object('ok', true, 'job_id', v_id, 'truck_id', v_plan1->'extra'->>'truck', 'forced', v_forced,
    'rows', jsonb_build_object('jobs', public.block_rows(v_day, v_block),
                               'job_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.job_items i where i.job_id = v_id)));
  if v_wm then
    v_res := v_res || (select jsonb_build_object('win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex, 'eta', j.eta_min) from public.jobs j where j.id = v_id);
  end if;
  return public.op_save(p_op, 'book_job', v_res);
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. « Flexible » appointments: the window fixed with or without pg_cron, and who is still to be told
-- ---------------------------------------------------------------------------------------------------------------------
--
-- The rule is the same as before: a flexible appointment gets its window today, and tomorrow's from `win_lock_min`
-- (18:00). What changes:
--   * lock_windows_due() may be called by ANY member of the team (and by the server: pg_cron, a service key). It is
--     safe at any frequency: it does only what is due, never early (win_lock_due), and nothing when nothing is due
--     (no lock taken, no re-plan: a flexible appointment « À placer » no longer re-plans the day every 10 minutes).
--     Without pg_cron, the app calls  rpc('lock_windows_due')  (no argument) when it opens and every 10 minutes while
--     it is open, and the server's nightly routine calls the same with the service key (see the report of Part 26).
--   * lock_windows(op, day), the button of Réglages, also fixes TODAY's flexible appointments still without a window.
--   * Both answer `untold`: the flexible appointments of those days whose window was fixed and whose « window » text
--     was never sent (the server cannot text: the app, or a server function, sends notify('window') for them).
--   * The day is planned again with the rule of the automatic re-plans: never an appointment thrown to « À placer ».

-- the flexible appointments of a day whose window was fixed (activity window_fixed) and never told since (no « window »
-- text sent after it)
create or replace function public.windows_untold(p_day date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(j.id order by j.eta_min, j.id), '[]'::jsonb)
  from public.jobs j
  where j.day = p_day and j.block = 'day' and j.status = 'booked' and j.deleted_at is null and j.win_flex and j.win_start is not null
    and exists (select 1 from public.activity a where a.entity = 'job' and a.entity_id = j.id and a.action = 'window_fixed'
                and not exists (select 1 from public.messages m where m.job_id = j.id and m.kind = 'window' and m.status = 'sent' and m.created_at >= a.at))
$$;
revoke all on function public.windows_untold(date) from public, anon, authenticated;
grant execute on function public.windows_untold(date) to service_role;

create or replace function public.lock_windows_core(p_day date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; v_ids jsonb := '[]'; n int := 0; w record;
begin
  if not public.windows_on() or p_day is null or p_day < public.local_today() then return jsonb_build_object('fixed', 0, 'jobs', '[]'::jsonb); end if;
  -- nothing to fix (a flexible job « À placer » has no arrival to cut a window around): no lock, no re-plan
  if not exists (select 1 from public.jobs j where j.day = p_day and j.block = 'day' and j.status = 'booked' and j.deleted_at is null and j.win_flex and j.win_start is null and j.truck_id is not null) then
    return jsonb_build_object('fixed', 0, 'jobs', '[]'::jsonb);
  end if;
  perform public.lock_block(p_day, 'day');
  if not exists (select 1 from public.jobs j where j.day = p_day and j.block = 'day' and j.status = 'booked' and j.deleted_at is null and j.win_flex and j.win_start is null and j.truck_id is not null) then
    return jsonb_build_object('fixed', 0, 'jobs', '[]'::jsonb);
  end if;
  -- the arrivals as they are now (a plan that would throw an appointment to « À placer » is not written)
  perform public.replan_block_safe(p_day, 'day');
  perform set_config('garage.rpc', 'on', true);
  for r in select j.id, j.eta_min from public.jobs j
           where j.day = p_day and j.block = 'day' and j.status = 'booked' and j.deleted_at is null and j.win_flex and j.win_start is null and j.eta_min is not null
           order by j.eta_min, j.id loop
    select * into w from public.win_for(r.eta_min);
    update public.jobs set win_start = w.win_start, win_end = w.win_end where id = r.id;
    insert into public.activity (entity, entity_id, action, data)
    values ('job', r.id, 'window_fixed', jsonb_build_object('day', p_day, 'win_start', w.win_start, 'win_end', w.win_end));
    v_ids := v_ids || to_jsonb(r.id); n := n + 1;
  end loop;
  return jsonb_build_object('fixed', n, 'jobs', v_ids);
end $function$;

create or replace function public.lock_windows(p_op uuid, p_day date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_done jsonb; v_res jsonb; v_t jsonb;
begin
  v_done := public.op_begin(p_op, 'lock_windows');
  if v_done is not null then return v_done; end if;
  if not (public.is_owner() or public.has_role('office')) then
    perform public.fail('not_allowed', 'Seuls le propriétaire et le bureau fixent les plages d’arrivée.');
  end if;
  if p_day is null or p_day < public.local_today() then perform public.fail('past', 'Cette journée est passée.'); end if;
  v_res := public.lock_windows_core(p_day);
  -- today's flexible appointments still without a window are fixed too (the evening's lock was missed)
  if p_day <> public.local_today() then
    v_t := public.lock_windows_core(public.local_today());
    v_res := jsonb_build_object('fixed', (v_res->>'fixed')::int + (v_t->>'fixed')::int, 'jobs', (v_res->'jobs') || (v_t->'jobs'));
  end if;
  v_res := v_res || jsonb_build_object('untold', public.windows_untold(p_day)
    || case when p_day <> public.local_today() then public.windows_untold(public.local_today()) else '[]'::jsonb end);
  return public.op_save(p_op, 'lock_windows', v_res || jsonb_build_object('ok', true, 'rows', jsonb_build_object('jobs', public.block_rows(p_day, 'day'))));
end $function$;

create or replace function public.lock_windows_due()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a jsonb; b jsonb := jsonb_build_object('fixed', 0, 'jobs', '[]'::jsonb); v_today date := public.local_today(); v_tomorrow boolean;
begin
  -- the server (pg_cron, a service key) or any member of the team
  if auth.uid() is not null and not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi.'); end if;
  if not public.windows_on() then return jsonb_build_object('fixed', 0, 'jobs', '[]'::jsonb, 'untold', '[]'::jsonb); end if;
  v_tomorrow := public.win_lock_due(v_today + 1);
  a := public.lock_windows_core(v_today);
  if v_tomorrow then b := public.lock_windows_core(v_today + 1); end if;
  perform set_config('garage.rpc', '', true);
  return jsonb_build_object('fixed', (a->>'fixed')::int + (b->>'fixed')::int, 'jobs', (a->'jobs') || (b->'jobs'),
    'untold', public.windows_untold(v_today) || case when v_tomorrow then public.windows_untold(v_today + 1) else '[]'::jsonb end);
end $function$;
revoke all on function public.lock_windows_due() from public, anon;
grant execute on function public.lock_windows_due() to authenticated, service_role;

-- with pg_cron, the routine runs every 10 minutes (the same schedule as Part 25; cron.schedule with a name replaces it)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('garage-lock-windows', '*/10 * * * *', 'select public.lock_windows_due()');
  end if;
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. The moments offered
-- ---------------------------------------------------------------------------------------------------------------------

-- suggest_windows_core (live text): the windows tried are exactly the ones win_for cuts for the day's quarter hours (the
-- booking calendar opens a quarter hour T when the server lists windowOf(T)): with « avant » 30 or 45, or a day that
-- starts at 7 h 30, the calendar was nearly empty. « Peu importe » plans again for the truck (plan_extra). Each window
-- also says what it adds to the driving of the day (`add_min`, `add_km`, `day_min`, `hop_min`, `stops`, `far`: the
-- « garde-route » of suggest_core, for the window mode: x-dualmode-01, server side).
CREATE OR REPLACE FUNCTION public.suggest_windows_core(p_lat double precision, p_lng double precision, p_duration integer, p_day date, p_exclude uuid DEFAULT NULL::uuid, p_need boolean DEFAULT false, p_kind text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p0 jsonb; p1 jsonb; out jsonb := '[]'; used0 int; used1 int; wait0 int; wait1 int; near int; v_near numeric := public.bset('near_km', 5);
  x uuid := '00000000-0000-4000-8000-000000000000';
  v_need boolean := coalesce(p_need, false) or coalesce((select j.needs_machine from public.jobs j where j.id = p_exclude), false);
  v_kind text := coalesce(case when p_kind in ('car', 'truck') then p_kind end, (select j.vehicle_kind from public.jobs j where j.id = p_exclude));
  v_dur int := greatest(15, least(720, coalesce(p_duration, 60)));
  v_len int := public.win_len(); v_step int := greatest(public.bset('win_round_min', 60)::int, 15); v_ws int; sp record; k int := 0;
  v_starts int[];
  -- « garde-route » (Part 26): what each window adds to the driving of the day, as suggest_core says it for a day
  v_maxhop numeric := public.bset('max_hop_min', 35); v_maxday numeric := public.bset('max_day_drive_min', 105);
  v_x jsonb := jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng); v_w0 jsonb := '{}'::jsonb;
  tk record; w0 jsonb; w1 jsonb; v_truck text; min0 int; min1 int; km0 numeric; km1 numeric; v_day int; v_hop int; v_stops int; v_far text;
begin
  if not public.windows_on() or p_day is null or not public.block_open(p_day, 'day') then return '[]'::jsonb; end if;
  if p_day > public.local_today() + public.bset('horizon_days', 120)::int then return '[]'::jsonb; end if;
  select * into sp from public.day_span();
  p0 := public.plan_block(p_day, 'day', null, p_exclude);
  if jsonb_array_length(p0->'trucks') = 0 then return '[]'::jsonb; end if;
  select coalesce(sum((t->>'used')::int), 0), coalesce(sum(coalesce((t->>'wait')::int, 0)), 0) into used0, wait0 from jsonb_array_elements(p0->'trucks') t;
  select count(*) into near from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.day = p_day and j.block = 'day' and j.deleted_at is null and j.status not in ('cancelled','no_show')
      and (p_exclude is null or j.id <> p_exclude)
      and public.km_between(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)) <= v_near;
  -- Part 26: the windows offered are exactly the ones win_for cuts for an arrival on the day's quarter hours (the app asks
  -- for windowOf(T) of each quarter hour T), whatever « avant », the rounding and the day's first hour: one lattice
  v_starts := array(select distinct w.win_start from generate_series(sp.start_min, sp.end_min, 15) t(m) cross join lateral public.win_for(t.m) w
                    where w.win_start is not null order by 1);
  foreach v_ws in array v_starts loop
    exit when k >= 100;
    k := k + 1;
    if not (p_day = public.local_today() and public.now_min() > v_ws + v_len) then
      -- « Peu importe »: the truck when the car-first plan does not fit (Part 26)
      p1 := public.plan_extra(p_day, 'day', jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', v_dur, 'need', v_need, 'kind', v_kind,
        'ws', v_ws, 'we', v_ws + v_len), p_exclude, p0);
      if public.plan_fits(p0, p1) then
        select coalesce(sum((t->>'used')::int), 0), coalesce(sum(coalesce((t->>'wait')::int, 0)), 0) into used1, wait1 from jsonb_array_elements(p1->'trucks') t;
        -- the whole day of the vehicles, without and with the appointment (the day without it once per vehicle)
        v_truck := p1->'extra'->>'truck'; min0 := 0; min1 := 0; km0 := 0; km1 := 0; v_day := null; v_hop := null; v_stops := 0;
        for tk in select (e->>'id')::uuid id from jsonb_array_elements(p1->'trucks') e loop
          w0 := v_w0->(tk.id::text);
          if w0 is null then w0 := public.day_drive(p_day, tk.id, p0, null, p_exclude); v_w0 := v_w0 || jsonb_build_object(tk.id::text, w0); end if;
          w1 := public.day_drive(p_day, tk.id, p1, v_x, p_exclude);
          min0 := min0 + (w0->>'min')::int; min1 := min1 + (w1->>'min')::int;
          km0 := km0 + (w0->>'km')::numeric; km1 := km1 + (w1->>'km')::numeric;
          if tk.id::text = v_truck then
            v_day := (w1->>'min')::int; v_hop := (w1->>'hop')::int; v_stops := greatest(0, (w1->>'stops')::int - 1);
          end if;
        end loop;
        v_far := case when p_lat is null or p_lng is null or v_stops = 0 then null
                      when v_maxhop > 0 and v_hop is not null and v_hop > v_maxhop then 'hop'
                      when v_maxday > 0 and v_day > v_maxday then 'day' end;
        out := out || jsonb_build_array(jsonb_build_object('day', p_day, 'block', 'day', 'pos', k, 'drive_min', greatest(0, used1 - used0 - v_dur - (wait1 - wait0)),
          'wait_min', greatest(0, wait1 - wait0), 'near', near, 'truck', p1->'extra'->>'truck',
          'left', (select max((t->>'left')::int) from jsonb_array_elements(p1->'trucks') t),
          'eta', (p1->'extra'->>'eta')::int, 'win_start', v_ws, 'win_end', v_ws + v_len,
          'add_min', greatest(0, min1 - min0), 'add_km', greatest(0, round(km1 - km0, 1)), 'day_min', v_day, 'hop_min', v_hop, 'stops', v_stops, 'far', v_far));
      end if;
    end if;
  end loop;
  return coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(out) e
    order by (e->>'drive_min')::int + (e->>'wait_min')::int, (e->>'win_start')::int) q), '[]'::jsonb);
end $function$;

-- suggest_core (live text): « Peu importe » plans again for the truck when the car-first plan does not fit (plan_extra).
CREATE OR REPLACE FUNCTION public.suggest_core(p_lat double precision, p_lng double precision, p_duration integer, p_from date DEFAULT NULL::date, p_days integer DEFAULT 14, p_exclude uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 6, p_need boolean DEFAULT false, p_kind text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d date; b record; v_from date := greatest(coalesce(p_from, public.local_today()), public.local_today());
  p0 jsonb; p1 jsonb; out jsonb := '[]'; used0 int; used1 int; near int; v_near numeric := public.bset('near_km', 5);
  x uuid := '00000000-0000-4000-8000-000000000000';
  -- the vehicle: what the work needs and what the person chose; moving a job, what the job already says
  v_need boolean := coalesce(p_need, false) or coalesce((select j.needs_machine from public.jobs j where j.id = p_exclude), false);
  v_kind text := coalesce(case when p_kind in ('car', 'truck') then p_kind end, (select j.vehicle_kind from public.jobs j where j.id = p_exclude));
  -- the whole day (Part 25, « garde-route »)
  v_maxhop numeric := public.bset('max_hop_min', 35);
  v_maxday numeric := public.bset('max_day_drive_min', 105);
  v_x jsonb := jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng);
  tk record; w0 jsonb; w1 jsonb; v_truck text; min0 int; min1 int; km0 numeric; km1 numeric; v_day int; v_hop int; v_stops int; v_far text;
  -- « plages d'arrivée »
  v_wm boolean := public.windows_on(); wait0 int; wait1 int; v_eta int; v_row jsonb;
begin
  for d in select generate_series(v_from, v_from + greatest(1, least(p_days, 60)) - 1, interval '1 day')::date loop
    for b in select * from public.blocks() loop
      if not public.block_open(d, b.key) then continue; end if;
      p0 := public.plan_block(d, b.key, null, p_exclude);
      if jsonb_array_length(p0->'trucks') = 0 then continue; end if;
      -- « Peu importe »: the truck when the car-first plan does not fit (Part 26)
      p1 := public.plan_extra(d, b.key, jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', p_duration, 'need', v_need, 'kind', v_kind)
        || case when v_wm then jsonb_build_object('ws', null, 'we', null) else '{}'::jsonb end, p_exclude, p0);
      if not coalesce((p1->'extra'->>'placed')::boolean, false) then continue; end if;
      if exists (select 1 from jsonb_array_elements_text(p1->'over') o where not ((p0->'over') ? o)) then continue; end if;
      if public.plan_late_new(p0, p1) then continue; end if;
      -- the truck it goes on must stay inside its hours (as book_job asks)
      if exists (select 1 from jsonb_array_elements(p1->'trucks') t where t->>'id' = p1->'extra'->>'truck' and (t->>'left')::int < 0) then continue; end if;
      select coalesce(sum((t->>'used')::int), 0), coalesce(sum(coalesce((t->>'wait')::int, 0)), 0) into used0, wait0 from jsonb_array_elements(p0->'trucks') t;
      select coalesce(sum((t->>'used')::int), 0), coalesce(sum(coalesce((t->>'wait')::int, 0)), 0) into used1, wait1 from jsonb_array_elements(p1->'trucks') t;
      select count(*) into near from public.jobs j left join public.customers c on c.id = j.customer_id
        where j.day = d and j.block = b.key and j.deleted_at is null and j.status not in ('cancelled','no_show')
          and (p_exclude is null or j.id <> p_exclude)
          and public.km_between(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)) <= v_near;
      -- the whole day of the vehicles of the block, without and with the appointment
      v_truck := p1->'extra'->>'truck'; min0 := 0; min1 := 0; km0 := 0; km1 := 0; v_day := null; v_hop := null; v_stops := 0;
      for tk in select (e->>'id')::uuid id from jsonb_array_elements(p1->'trucks') e loop
        w0 := public.day_drive(d, tk.id, p0, null, p_exclude);
        w1 := public.day_drive(d, tk.id, p1, v_x, p_exclude);
        min0 := min0 + (w0->>'min')::int; min1 := min1 + (w1->>'min')::int;
        km0 := km0 + (w0->>'km')::numeric; km1 := km1 + (w1->>'km')::numeric;
        if tk.id::text = v_truck then
          v_day := (w1->>'min')::int; v_hop := (w1->>'hop')::int; v_stops := greatest(0, (w1->>'stops')::int - 1);
        end if;
      end loop;
      v_far := case when p_lat is null or p_lng is null or v_stops = 0 then null
                    when v_maxhop > 0 and v_hop is not null and v_hop > v_maxhop then 'hop'
                    when v_maxday > 0 and v_day > v_maxday then 'day' end;
      v_row := jsonb_build_object('day', d, 'block', b.key, 'pos', b.pos, 'drive_min', greatest(0, used1 - used0 - p_duration - (wait1 - wait0)),
        'near', near, 'truck', v_truck, 'left', (select max((t->>'left')::int) from jsonb_array_elements(p1->'trucks') t),
        'add_min', greatest(0, min1 - min0), 'add_km', greatest(0, round(km1 - km0, 1)), 'day_min', v_day, 'hop_min', v_hop, 'stops', v_stops, 'far', v_far);
      if v_wm then
        v_eta := (p1->'extra'->>'eta')::int;
        v_row := v_row || jsonb_build_object('eta', v_eta, 'wait_min', greatest(0, wait1 - wait0))
          || coalesce((select jsonb_build_object('win_start', w.win_start, 'win_end', w.win_end) from public.win_for(v_eta) w), '{}'::jsonb);
      end if;
      out := out || jsonb_build_array(v_row);
    end loop;
  end loop;
  -- the moments that are not far first, then the least driving added over the day (and the least waiting, with windows)
  return coalesce((select jsonb_agg(e order by o) from (select e, row_number() over (
      order by (e->>'far' is not null), (e->>'add_min')::int + coalesce((e->>'wait_min')::int, 0), (e->>'near')::int desc, e->>'day', (e->>'pos')::int) o
    from jsonb_array_elements(out) e) q where o <= greatest(1, p_limit)), '[]'::jsonb);
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. The switch between blocks and windows
-- ---------------------------------------------------------------------------------------------------------------------

-- windows_switch (live text), with:
--   * the claim first;
--   * back to the blocks: a job goes to the block of its planned arrival (as the owner is told), not to the block of its
--     window's start; the window the customer was told stays on the job when it is not the block's own hours (the app
--     shows a block job by its block: nothing changes on the screens), so the way back to the windows gives it again;
--   * the answer lists whom to call (`to_call`: the window told is not inside the block, also in activity
--     « window_to_block ») and the days left as they were (`kept`); `converted` counts the appointments still to come.
CREATE OR REPLACE FUNCTION public.windows_switch(p_op uuid, p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_done jsonb; v_today date := public.local_today(); n int := 0; d date; bk record; p jsonb;
  v_chain text := coalesce(current_setting('garage.chain', true), '');
  -- Part 26: whom to call (the window told is not inside the block they go back to), the days left as they were
  v_call jsonb := '[]'::jsonb; v_kept jsonb := '[]'::jsonb;
begin
  v_done := public.op_begin(p_op, 'windows_switch');
  if v_done is not null then return v_done; end if;
  if not public.is_owner() then perform public.fail('not_allowed', 'Seul le propriétaire change la façon de donner les heures aux clients.'); end if;
  if p_on is null then perform public.fail('bad_mode', 'Choisis : les plages d’arrivée, ou les blocs.'); end if;
  perform pg_advisory_xact_lock(hashtext('windows_switch'));
  if public.windows_on() = p_on then
    return public.op_save(p_op, 'windows_switch', jsonb_build_object('ok', true, 'converted', 0, 'unchanged', true, 'on', p_on));
  end if;
  perform set_config('garage.rpc', 'on', true);
  if p_on then
    select count(*) into n from public.jobs j where j.day >= v_today and j.block <> 'day' and j.deleted_at is null and j.status = 'booked';
    -- a window still kept on the job (what the customer was told before a switch back to the blocks) is its window again
    update public.jobs j set block = 'day',
      win_start = case when j.win_start is not null and j.win_end is not null and j.win_start < x.end_min and j.win_end > x.start_min then j.win_start else x.start_min end,
      win_end = case when j.win_start is not null and j.win_end is not null and j.win_start < x.end_min and j.win_end > x.start_min then j.win_end else x.end_min end,
      win_flex = false
      from public.blocks_set() x where x.key = j.block and j.day >= v_today and j.block <> 'day';
  else
    select count(*) into n from public.jobs j where j.day >= v_today and j.block = 'day' and j.deleted_at is null and j.status = 'booked';
    update public.jobs j set
      block = coalesce(
        -- a window that is a block's very hours (a job that came from a block) goes back to that very block; else the block
        -- of its planned arrival when the arrival is inside the window; else the block of the window (block_of_window)
        (select x.key from public.blocks_set() x where j.win_start = x.start_min and j.win_end = x.end_min order by x.pos limit 1),
        (select x.key from public.blocks_set() x where j.eta_min >= x.start_min and j.eta_min < x.end_min
           and (j.win_start is null or (j.eta_min >= j.win_start and j.eta_min <= j.win_end)) order by x.pos limit 1),
        public.block_of_window(j.win_start, j.win_end),
        (select x.key from public.blocks_set() x where j.eta_min >= x.start_min and j.eta_min < x.end_min order by x.pos limit 1),
        (select x.key from public.blocks_set() x order by x.pos limit 1), 'am'),
      win_flex = false
    where j.day >= v_today and j.block = 'day';
    -- what each customer was told: kept on the job when it is not the block's own hours (the switch back to the windows
    -- gives it again); the ones whose window is not inside their block are to be called
    perform set_config('garage.rpc', 'on', true);
    select coalesce(jsonb_agg(jsonb_build_object('job_id', j.id, 'day', j.day, 'block', j.block, 'win_start', j.win_start, 'win_end', j.win_end,
             'customer_id', j.customer_id, 'truck_id', j.truck_id) order by j.day, j.win_start, j.id), '[]'::jsonb) into v_call
    from public.jobs j join public.blocks_set() x on x.key = j.block
    where j.day >= v_today and j.deleted_at is null and j.status = 'booked' and j.win_start is not null and j.win_end is not null
      and (j.win_start < x.start_min or j.win_end > x.end_min);
    insert into public.activity (actor, entity, entity_id, action, data)
    select auth.uid(), 'job', (c->>'job_id')::uuid, 'window_to_block', c - 'job_id' from jsonb_array_elements(v_call) c;
    update public.jobs j set win_start = null, win_end = null
      from public.blocks_set() x where x.key = j.block and j.day >= v_today and j.win_start is not null
        and (j.status <> 'booked' or (j.win_start = x.start_min and j.win_end = x.end_min));
  end if;
  perform set_config('garage.windows', 'on', true);
  update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{windows_on}', to_jsonb(p_on)) where id = 1;
  perform set_config('garage.windows', '', true);
  perform set_config('garage.rpc', 'on', true);
  -- the stops of each truck numbered again inside their new block, by arrival (for the blocks that are not planned again)
  update public.jobs j set stop_order = q.rn
    from (select x.id, (row_number() over (partition by x.day, x.block, x.truck_id order by x.eta_min nulls last, x.stop_order nulls last, x.created_at))::int rn
          from public.jobs x where x.day >= v_today and x.deleted_at is null and x.truck_id is not null and x.stop_order is not null
            and x.status not in ('cancelled', 'no_show')) q
    where q.id = j.id and j.stop_order is distinct from q.rn;
  -- the coming days, in block order, each block from the new end of the one before (as replan_days does)
  perform set_config('garage.chain', 'on', true);
  for d in select distinct j.day from public.jobs j where j.day >= v_today and j.status = 'booked' and j.deleted_at is null order by 1 loop
    for bk in select x.key from public.blocks() x order by x.pos loop
      continue when not public.block_open(d, bk.key);
      continue when not exists (select 1 from public.jobs j where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked');
      perform public.lock_block(d, bk.key);
      p := public.plan_block(d, bk.key);
      if exists (select 1 from jsonb_array_elements_text(coalesce(p->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid where j.truck_id is not null) then
        v_kept := v_kept || jsonb_build_object('day', d, 'block', bk.key);
        continue;
      end if;
      perform public.apply_plan(p);
    end loop;
  end loop;
  perform set_config('garage.chain', v_chain, true);
  insert into public.activity (actor, entity, entity_id, action, data)
  values (auth.uid(), 'settings', null, 'windows_switch', jsonb_build_object('on', p_on, 'converted', n, 'to_call', jsonb_array_length(v_call), 'kept', v_kept));
  return public.op_save(p_op, 'windows_switch', jsonb_build_object('ok', true, 'converted', n, 'on', p_on, 'to_call', v_call, 'kept', v_kept));
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. « My vehicle », work on the spot, the steps of a job
-- ---------------------------------------------------------------------------------------------------------------------

-- my_truck_ids (live text): in the order of Horaires, so « the first of my vehicles » is always the same one.
CREATE OR REPLACE FUNCTION public.my_truck_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- in a fixed order (the order of Horaires), so « the first of my vehicles » is always the same one (Part 26)
  select coalesce(array_agg(t.id order by t.sort, t.name, t.id), '{}') from public.trucks t
   where t.deleted_at is null
     and (t.driver_id = auth.uid()
       or (public.has_role('mechanic') and coalesce((select (st.booking->>'shared_routes')::boolean from public.settings st where st.id = 1), false)))
$function$;

-- walk_in (live text, patched in place by Part 25): the claim first; no vehicle said: the vehicle I drive, never an
-- arbitrary one with « Routes partagées » (several vehicles and none driven: no_truck, the vehicle must be said).
CREATE OR REPLACE FUNCTION public.walk_in(p_op uuid, p_job jsonb, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_done jsonb; v_id uuid := coalesce(nullif(p_job->>'id', '')::uuid, gen_random_uuid());
  v_truck uuid := nullif(p_job->>'truck_id', '')::uuid; v_block text; v_now int := public.now_min(); it jsonb; k int := 0; v_dur int;
begin
  v_done := public.op_begin(p_op, 'walk_in');
  if v_done is not null then return v_done; end if;
  if not public.is_field() then perform public.fail('not_allowed', 'Tu ne peux pas ouvrir une job.'); end if;
  if v_truck is null then
    -- Part 26: the vehicle I drive; with « Routes partagées » every vehicle is « mine », so it must be said when I drive
    -- none of them and there are several (never an arbitrary one)
    select t.id into v_truck from public.trucks t where t.driver_id = auth.uid() and t.active and t.deleted_at is null order by t.sort, t.name, t.id limit 1;
    if v_truck is null and cardinality(public.my_truck_ids()) > 1
       and coalesce((select (st.booking->>'shared_routes')::boolean from public.settings st where st.id = 1), false) then
      perform public.fail('no_truck', 'Choisis le véhicule de cette job : la voiture ou le camion.');
    end if;
    if v_truck is null then v_truck := (public.my_truck_ids())[1]; end if;
  end if;
  if v_truck is not null and not (v_truck = any(public.my_truck_ids()) or public.can('book') or public.is_owner()) then
    perform public.fail('not_allowed', 'Ce camion n’est pas le tien.');
  end if;
  if nullif(p_job->>'customer_id', '') is null then perform public.fail('no_customer', 'Choisis le client (ou crée sa fiche).'); end if;
  if not public.customer_visible((p_job->>'customer_id')::uuid) then perform public.fail('not_allowed', 'Tu n’as pas accès à ce client.'); end if;
  select x.key into v_block from public.blocks() x where v_now >= x.start_min and v_now < x.end_min;
  if public.windows_on() then v_block := 'day'; elsif v_block is null then v_block := case when v_now < 720 then 'am' when v_now < 960 then 'pm' else 'eve' end; end if;
  v_dur := greatest(15, least(720, coalesce(nullif(p_job->>'duration_min', '')::int,
    (select sum(coalesce((e->>'duration_min')::int, 0)) from jsonb_array_elements(p_items) e), 60)));
  perform set_config('garage.rpc', 'on', true);
  insert into public.jobs (id, customer_id, vehicle_id, day, block, truck_id, truck_pinned, duration_min, status, problem, notes,
    address, unit, postal_code, lat, lng, source, quote_id, arrived_at, started_at, created_by)
  values (v_id, (p_job->>'customer_id')::uuid, nullif(p_job->>'vehicle_id', '')::uuid, public.local_today(), v_block, v_truck, v_truck is not null,
    v_dur, 'on_site', nullif(p_job->>'problem', ''), nullif(p_job->>'notes', ''), nullif(p_job->>'address', ''), nullif(p_job->>'unit', ''),
    nullif(p_job->>'postal_code', ''), nullif(p_job->>'lat', '')::double precision, nullif(p_job->>'lng', '')::double precision,
    case when nullif(p_job->>'quote_id', '') is null then 'walk_in' else 'quote' end, nullif(p_job->>'quote_id', '')::uuid, now(), now(), auth.uid());
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    k := k + 1;
    insert into public.job_items (id, job_id, kind, service_id, item_id, description, qty, unit_cents, taxable, duration_min, status, sort)
    values (coalesce(nullif(it->>'id', '')::uuid, gen_random_uuid()), v_id, coalesce(nullif(it->>'kind', ''), 'service'), nullif(it->>'service_id', '')::uuid,
      nullif(it->>'item_id', '')::uuid, it->>'description', coalesce((it->>'qty')::numeric, 1), coalesce((it->>'unit_cents')::int, 0),
      coalesce((it->>'taxable')::boolean, true), nullif(it->>'duration_min', '')::int, 'done', k);
  end loop;
  if nullif(p_job->>'quote_id', '') is not null then
    update public.quotes set status = 'converted', job_id = v_id where id = (p_job->>'quote_id')::uuid;
  end if;
  return public.op_save(p_op, 'walk_in', jsonb_build_object('ok', true, 'job_id', v_id, 'rows', public.job_payload(v_id)));
end $function$;

-- job_step (live text, patched in place by Parts 24 quater and 25): the claim first; a cancellation or a « Client
-- absent » plans the block again without throwing anybody to « À placer », then the blocks after it from where the truck
-- now ends (sql-planner-1 B7); « Remettre à l'agenda » only when nobody else loses a place (or a window) for it, as a
-- booking.
CREATE OR REPLACE FUNCTION public.job_step(p_op uuid, p_job uuid, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_done jsonb; j public.jobs; inv public.invoices; v_lost int; b record; v_plan jsonb; v_lat double precision; v_lng double precision;
  v_plan0 jsonb;
begin
  v_done := public.op_begin(p_op, 'job_step');
  if v_done is not null then return v_done; end if;
  select * into j from public.jobs where id = p_job and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cette job n’existe plus.'); end if;
  if not public.job_actor(j) then perform public.fail('not_allowed', 'Cette job n’est pas à toi.'); end if;
  perform set_config('garage.rpc', 'on', true);
  inv := public.job_invoice(j.id);
  v_lost := coalesce(nullif(p_data->>'lost_cents', '')::int,
    (select coalesce(sum(round(i.qty * i.unit_cents)), 0)::int from public.job_items i where i.job_id = j.id and i.deleted_at is null and i.status in ('planned','done','approved')));

  case p_action
  when 'leave' then
    if j.status <> 'booked' then perform public.fail('bad_step', 'Cette job est déjà partie.'); end if;
    if exists (select 1 from public.jobs o where o.id <> j.id and o.day = j.day and o.truck_id is not distinct from j.truck_id and j.truck_id is not null
                 and o.status = 'on_site' and o.deleted_at is null and not public.job_paid(o.id) and not o.pay_later) then
      perform public.fail('unpaid_here', 'La job d’avant n’est pas encore payée : encaisse-la avant de partir.');
    end if;
    update public.jobs set status = 'en_route', started_at = now() where id = j.id;
  when 'arrive' then
    if j.status <> 'en_route' then perform public.fail('bad_step', 'Touche d’abord « Je pars ».'); end if;
    update public.jobs set status = 'on_site', arrived_at = now() where id = j.id;
    update public.trips set status = 'arrived', ended_at = now() where job_id = j.id and status = 'active';
  when 'finish' then
    if j.status not in ('on_site','en_route') then perform public.fail('bad_step', 'Cette job n’est pas sur place.'); end if;
    if not public.job_paid(j.id) then
      if coalesce((p_data->>'pay_later')::boolean, false) then
        if not (public.is_owner() or public.can('edit_invoices')) then
          perform public.fail('pay_first', 'Paiement requis avant de partir. Seul le bureau peut laisser partir sans paiement.');
        end if;
        if inv.id is null or inv.status = 'draft' then perform public.fail('invoice_first', 'Termine la facture d’abord.'); end if;
        update public.jobs set pay_later = true, pay_later_reason = nullif(p_data->>'reason', '') where id = j.id;
      else
        perform public.fail('pay_first', 'Paiement requis avant de partir : encaisse la facture.');
      end if;
    end if;
    update public.jobs set status = 'done', finished_at = now(), arrived_at = coalesce(arrived_at, now()) where id = j.id;
    update public.trips set status = 'arrived', ended_at = now() where job_id = j.id and status = 'active';
    perform public.use_parts(j.id, p_data->'parts');
  when 'cancel' then
    if j.status not in ('booked','en_route') then perform public.fail('bad_step', 'Cette job ne peut plus être annulée.'); end if;
    update public.jobs set status = 'cancelled', cancelled_at = now(), lost_cents = v_lost, lost_reason = nullif(p_data->>'reason', '') where id = j.id;
    update public.trips set status = 'cancelled', ended_at = now() where job_id = j.id and status = 'active';
    perform public.replan_block_safe(j.day, j.block);
    -- the blocks after it are planned again from where the truck now ends (the chain of apply_plan runs only when a row
    -- of the block changed: the last stop of a block taken away changed none)
    perform public.replan_block_safe(j.day, x.key) from public.blocks() x where x.pos > public.block_pos(j.block) order by x.pos;
  when 'no_show' then
    if j.status not in ('booked','en_route','on_site') then perform public.fail('bad_step', 'Cette job ne peut plus passer à « Client absent ».'); end if;
    update public.jobs set status = 'no_show', cancelled_at = now(), lost_cents = v_lost, lost_reason = nullif(p_data->>'reason', '') where id = j.id;
    update public.customers set no_shows = no_shows + 1 where id = j.customer_id;
    update public.trips set status = 'cancelled', ended_at = now() where job_id = j.id and status = 'active';
    perform public.replan_block_safe(j.day, j.block);
    perform public.replan_block_safe(j.day, x.key) from public.blocks() x where x.pos > public.block_pos(j.block) order by x.pos;
  when 'reopen' then
    if j.status not in ('cancelled','no_show') then perform public.fail('bad_step', 'Cette job est déjà à l’agenda.'); end if;
    select * into b from public.blocks() x where x.key = j.block;
    if not public.block_open(j.day, j.block) then
      perform public.fail('block_started', 'Ce bloc est passé : déplace la job vers un autre moment.');
    end if;
    perform public.lock_block(j.day, j.block);
    select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into v_lat, v_lng from public.customers c where c.id = j.customer_id;
    v_plan0 := public.plan_block(j.day, j.block, null, j.id);
    v_plan := public.plan_block(j.day, j.block, jsonb_build_object('id', j.id, 'lat', v_lat, 'lng', v_lng, 'dur', j.duration_min), j.id);
    if not coalesce((v_plan->'extra'->>'placed')::boolean, false)
       or exists (select 1 from jsonb_array_elements_text(coalesce(v_plan->'over', '[]'::jsonb)) o where not (coalesce(v_plan0->'over', '[]'::jsonb) ? o))
       or public.plan_late_new(v_plan0, v_plan) then
      perform public.fail('block_full', case when j.block = 'day' then 'Cette journée est complète maintenant : déplace la job vers un autre moment.'
                                             else 'Ce bloc est complet maintenant : déplace la job vers un autre moment.' end);
    end if;
    if j.status = 'no_show' then update public.customers set no_shows = greatest(0, no_shows - 1) where id = j.customer_id; end if;
    update public.jobs set status = 'booked', cancelled_at = null, lost_cents = null, lost_reason = null, started_at = null, arrived_at = null where id = j.id;
    perform public.apply_plan_keep(public.plan_block(j.day, j.block));
  when 'back' then
    if j.status = 'en_route' then
      update public.jobs set status = 'booked', started_at = null where id = j.id;
      update public.trips set status = 'cancelled', ended_at = now() where job_id = j.id and status = 'active';
    elsif j.status = 'on_site' then
      update public.jobs set status = 'en_route', arrived_at = null where id = j.id;
    elsif j.status = 'done' and (public.is_owner() or public.can('book')) then
      update public.jobs set status = 'on_site', finished_at = null where id = j.id;
    else perform public.fail('bad_step', 'Rien à défaire.'); end if;
  when 'waiver' then
    if nullif(p_data->>'signer', '') is null then perform public.fail('signer', 'Écris le nom de la personne qui signe.'); end if;
    update public.jobs set waiver_signed_at = now(), waiver_signer = p_data->>'signer', waiver_version = nullif(p_data->>'version', ''),
      waiver_attachment = nullif(p_data->>'attachment_id', '')::uuid where id = j.id;
  else
    perform public.fail('bad_step', 'Étape inconnue.');
  end case;
  return public.op_save(p_op, 'job_step', jsonb_build_object('ok', true, 'action', p_action, 'rows', public.job_payload(j.id)));
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 10. The plan of a block: the stored routes as the seed, hours with a break, the stops already done
-- ---------------------------------------------------------------------------------------------------------------------

-- the earliest moment from p_tm where a stop of p_need minutes starts and ends inside one stretch of hours (null: none)
create or replace function public.ranges_fit(p_ranges jsonb, p_tm integer, p_need integer) returns integer
language sql immutable set search_path = public, extensions as $$
  select min(greatest(p_tm, (r->>0)::int)) from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) r
  where (r->>1)::int - greatest(p_tm, (r->>0)::int) >= greatest(coalesce(p_need, 0), 0)
$$;

-- route_walk (Part 25) that also knows the truck's stretches of hours (p_ranges, null = one stretch, as before): a stop
-- reached in a break, or that would not end before the break, waits for the next stretch (not counted as waiting for a
-- window); no stretch left: -1. p_windows false: the windows are not looked at (only the hours).
create or replace function public.route_walk_in(p_ids jsonb, p_pts jsonb, p_start integer, p_hlat double precision, p_hlng double precision,
  p_speed numeric, p_detour numeric, p_unknown numeric, p_stop numeric, p_fixed integer, p_ranges jsonb, p_windows boolean) returns integer
language plpgsql immutable set search_path = public, extensions as $$
declare plat double precision := p_hlat; plng double precision := p_hlng; clat double precision; clng double precision;
  tm int := coalesce(p_start, 0); v_wait int := 0; k int := 0; id text; v jsonb; v_ws int; v_we int; v_fit int;
begin
  for id in select e from jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) with ordinality q(e, o) order by o loop
    k := k + 1; v := p_pts->id; v_ws := null; v_we := null;
    clat := (v->>'lat')::double precision; clng := (v->>'lng')::double precision;
    tm := tm + public.drive_min(plat, plng, clat, clng, p_speed, p_detour, p_unknown);
    if k > coalesce(p_fixed, 0) then
      if coalesce(p_windows, false) then
        v_ws := (v->>'ws')::int; v_we := (v->>'we')::int;
        if v_ws is not null and tm < v_ws then v_wait := v_wait + (v_ws - tm); tm := v_ws; end if;
      end if;
      if p_ranges is not null and jsonb_typeof(p_ranges) = 'array' then
        v_fit := public.ranges_fit(p_ranges, tm, ceil(p_stop)::int + coalesce((v->>'dur')::int, 0));
        if v_fit is null then return -1; end if;
        tm := v_fit;
      end if;
      if v_we is not null and tm > v_we and not coalesce((v->>'late')::boolean, false) then return -1; end if;
    end if;
    tm := tm + ceil(p_stop)::int + coalesce((v->>'dur')::int, 0);
    if clat is not null then plat := clat; plng := clng; end if;
  end loop;
  return v_wait;
end $$;

-- the appointments a plan puts late although their stored route reaches them in their window (the stop being added aside)
create or replace function public.plan_late_stored(p_plan jsonb, p_xid text) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from jsonb_array_elements_text(coalesce(p_plan->'late', '[]'::jsonb)) o
  join public.jobs j on j.id::text = o
  where o is distinct from p_xid and j.status = 'booked' and j.deleted_at is null and j.truck_id is not null
    and j.eta_min is not null and j.win_end is not null and j.eta_min <= j.win_end
$$;

revoke all on function public.ranges_fit(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.route_walk_in(jsonb, jsonb, integer, double precision, double precision, numeric, numeric, numeric, numeric, integer, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.plan_late_stored(jsonb, text) from public, anon, authenticated;
grant execute on function public.ranges_fit(jsonb, integer, integer) to service_role;
grant execute on function public.route_walk_in(jsonb, jsonb, integer, double precision, double precision, numeric, numeric, numeric, numeric, integer, jsonb, boolean) to service_role;
grant execute on function public.plan_late_stored(jsonb, text) to service_role;

-- plan_route = the live text of plan_block, with:
--   * p_seed true (window mode): the booked stops already on a truck of the plan stay on it in their order (a truck whose
--     stored route no longer holds is planned again like before); the other stops and the one being added are inserted
--     where every window holds. p_seed null: as before, then, when that plan makes late an appointment that its stored
--     route reaches in its window (a cancellation, a booking, a position found), the seeded plan when it makes fewer
--     late (sql-windows-02);
--   * window mode, hours with a break (lunch, a split shift): each truck walks its stretches of hours one after the other,
--     a stop starts and ends inside one stretch (they were one continuous stretch: sql-windows-05, x-dualmode-08);
--   * window mode, today: the stops are numbered after the ones the truck already finished (sql-windows-03, x-dualmode-06);
--   * window mode, booked « quand même »: placed after the other stops, inside its window where every other window still
--     holds, else late, else at the end past the hours as before (it was always the last stop of the whole day:
--     sql-windows-04); it never holds another stop to anything;
--   * window mode, a day already started: an appointment that no longer fits stays on its truck (apply_plan) and now
--     counts there, at the end, late, so its time is not sold again to a same-day booking (sql-windows-09).
create or replace function public.plan_route(p_day date, p_block text, p_extra jsonb, p_exclude uuid, p_seed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare jkind text; carfirst boolean;
  b record;
  v_speed numeric := public.bset('speed_kmh', 35);
  v_detour numeric := public.bset('detour', 1.3);
  v_stop numeric := public.bset('stop_min', 5);
  v_unknown numeric := public.bset('unknown_min', 20);
  v_minblock numeric := public.bset('min_block_min', 45);
  v_hlat double precision; v_hlng double precision;
  v_today date := public.local_today();
  v_from int;
  trucks jsonb := '[]';
  pts jsonb := '{}';
  over jsonb := '[]';
  free jsonb := '[]';
  out_jobs jsonb := '{}';
  r record; rg jsonb; cap int; ti int; n int; pos int; cand jsonb; rc int; base int; durs int; used int; cost numeric;
  best_ti int; best_pos int; best_cost numeric; best_cand jsonb; jid text; jdur int; jtruck text; pinned boolean; placed boolean;
  t jsonb; tm int; plat double precision; plng double precision; clat double precision; clng double precision; leg int; k int;
  hl double precision; hg double precision; el double precision; eg double precision; rce int; basee int;
  v_forced jsonb := '[]'; v_tail jsonb;
  v_prev text; v_next text; v_from_kind text;
  -- the windows (Part 25)
  v_wm boolean := false;          -- window mode: the one block of the day
  v_win boolean := false;         -- a stop of this plan has a window
  v_w int := 0; v_bw int := 0; v_wt int; v_try int; v_late jsonb := '[]'; v_xid text := p_extra->>'id';
  v_ws int; v_we int; v_dur int; v_start int; v_nf int;
  -- Part 26: the stored routes as the seed (p_seed), hours with a break (a truck's 'rg'), the stops already done today
  v_seed boolean := false; v_seedfree jsonb := '{}'; fe jsonb; v_res jsonb; v_alt jsonb; v_dn int; v_fit int;
  v_pastend jsonb := '[]';        -- booked « quand même » and placed past the hours (they go at the end)
begin
  select * into b from public.blocks() x where x.key = p_block;
  if not found then raise exception 'Bloc inconnu : %', p_block using errcode = '22023'; end if;
  v_wm := p_block = 'day' and public.windows_on();
  v_seed := coalesce(p_seed, false) and v_wm;
  select h.lat, h.lng into v_hlat, v_hlng from public.home_point() h;
  v_from := case when p_day = v_today then (ceil(public.now_min() / 5.0) * 5)::int when p_day < v_today then 1440 else 0 end;

  select x.key into v_prev from public.blocks() x where x.pos = b.pos - 1;
  select x.key into v_next from public.blocks() x where x.pos = b.pos + 1;

  -- trucks working this block, each with where it leaves from and where its next block starts
  for r in select tr.id, tr.start, tr.tire_machine from public.trucks tr where tr.active and tr.deleted_at is null order by tr.sort, tr.name, tr.id loop
    rg := public.ranges_from(public.truck_ranges(r.id, p_day), v_from);
    cap := public.ranges_overlap(rg, b.start_min, b.end_min);
    if cap >= least(v_minblock, b.end_min - b.start_min) or (cap > 0 and exists (select 1 from public.jobs j where j.truck_id = r.id and j.day = p_day and j.block = p_block and j.status in ('en_route','on_site') and j.deleted_at is null)) then
      -- leaves from its last stop of the block before (done or not), else its own start, else « Départ des camions »
      hl := null; hg := null; el := null; eg := null;
      if v_prev is not null then
        select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into hl, hg from public.jobs j left join public.customers c on c.id = j.customer_id
        where j.truck_id = r.id and j.day = p_day and j.block = v_prev and j.deleted_at is null and j.status not in ('cancelled','no_show')
          and (p_exclude is null or j.id <> p_exclude) and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
        order by j.stop_order desc nulls last, j.eta_min desc nulls last limit 1;
      end if;
      -- window mode, today: from where the truck is now (the stop it is at, else the last one it finished)
      if v_wm and p_day = v_today then
        select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into hl, hg from public.jobs j left join public.customers c on c.id = j.customer_id
        where j.truck_id = r.id and j.day = p_day and j.block = p_block and j.deleted_at is null and j.status in ('on_site','done')
          and (p_exclude is null or j.id <> p_exclude) and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
        order by (j.status = 'on_site') desc, j.finished_at desc nulls last, j.stop_order desc nulls last limit 1;
      end if;
      v_from_kind := case when hl is not null then 'prev' when r.start is not null then 'own' else 'home' end;
      if hl is null then hl := coalesce((r.start->>'lat')::double precision, v_hlat); hg := coalesce((r.start->>'lng')::double precision, v_hlng); end if;
      -- tries to finish close to its first stop of the next block
      if v_next is not null then
        select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into el, eg from public.jobs j left join public.customers c on c.id = j.customer_id
        where j.truck_id = r.id and j.day = p_day and j.block = v_next and j.deleted_at is null and j.status not in ('cancelled','no_show','done')
          and (p_exclude is null or j.id <> p_exclude) and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
        order by j.stop_order nulls last, j.eta_min nulls last limit 1;
      end if;
      trucks := trucks || jsonb_build_array(jsonb_build_object('id', r.id, 'machine', r.tire_machine, 'cap', cap, 'start', coalesce(public.ranges_first(rg, b.start_min, b.end_min), b.start_min),
        'hlat', hl, 'hlng', hg, 'from', v_from_kind, 'elat', el, 'elng', eg, 'stops', '[]'::jsonb, 'nfixed', 0, 'durs', 0)
        -- window mode, hours with a break (lunch, a split shift): its stretches of hours, walked one after the other (Part 26)
        || coalesce((select jsonb_build_object('rg', jsonb_agg(jsonb_build_array(greatest((x->>0)::int, b.start_min), least((x->>1)::int, b.end_min)) order by (x->>0)::int))
                     from jsonb_array_elements(rg) x where v_wm and least((x->>1)::int, b.end_min) > greatest((x->>0)::int, b.start_min)
                     having count(*) > 1), '{}'::jsonb));
    end if;
  end loop;

  -- the jobs of the block
  for r in
    select j.id, j.truck_id, j.truck_pinned, j.forced, j.status, j.duration_min, j.stop_order, j.manual_order,
           case when j.needs_machine then 'truck' else j.vehicle_kind end kind,
           coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng,
           j.win_start, j.win_end, j.arrived_at, j.eta_min
    from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.day = p_day and j.block = p_block and j.deleted_at is null and j.status not in ('cancelled','no_show','done')
      and (p_exclude is null or j.id <> p_exclude)
    order by (j.status in ('en_route','on_site')) desc, j.manual_order nulls last, j.stop_order nulls last, j.created_at
  loop
    v_dur := r.duration_min;
    -- window mode, today: a job under way counts only the time it still needs
    if v_wm and p_day = v_today and r.status = 'on_site' and r.arrived_at is not null then
      v_dur := greatest(0, r.duration_min - floor(extract(epoch from (now() - r.arrived_at)) / 60)::int);
    end if;
    pts := pts || jsonb_build_object(r.id::text, jsonb_build_object('lat', r.lat, 'lng', r.lng, 'dur', v_dur)
      || case when v_wm and r.status = 'booked' and not coalesce(r.forced, false) and r.win_start is not null and r.win_end is not null
              then jsonb_build_object('ws', r.win_start, 'we', r.win_end)
              -- booked « quand même » (Part 26): placed after every other stop of the plan, inside its window when it fits,
              -- else late, else at the end (it never holds another stop to anything)
              when v_wm and r.status = 'booked' and r.win_start is not null and r.win_end is not null
              then jsonb_build_object('ws', r.win_start, 'we', r.win_end) else '{}'::jsonb end
      || case when v_wm and p_day = v_today and r.status = 'on_site' and r.eta_min is not null then jsonb_build_object('eta0', r.eta_min) else '{}'::jsonb end);
    if v_wm and r.status = 'booked' and r.win_start is not null and r.win_end is not null then v_win := true; end if;
    -- on the way or there: stays where it is, before the others. Put in order by hand (Part 21): right after, in that
    -- order, on its truck when that truck works the block (else the planner places it like the others)
    ti := null;
    if r.status in ('en_route','on_site') or r.manual_order is not null then
      for k in 0 .. jsonb_array_length(trucks) - 1 loop if trucks->k->>'id' = r.truck_id::text then ti := k; end if; end loop;
    end if;
    if r.status in ('en_route','on_site') or ti is not null then
      if ti is not null then
        trucks := jsonb_set(trucks, array[ti::text, 'stops'], (trucks->ti->'stops') || to_jsonb(r.id::text));
        trucks := jsonb_set(trucks, array[ti::text, 'nfixed'], to_jsonb((trucks->ti->>'nfixed')::int + 1));
        trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb((trucks->ti->>'durs')::int + v_dur));
      end if;
      out_jobs := out_jobs || jsonb_build_object(r.id::text, jsonb_build_object('truck', r.truck_id, 'fixed', true));
    else
      -- « farthest first »: from the nearest start of the trucks working the block
      fe := jsonb_build_object('id', r.id::text, 'truck', case when r.truck_pinned then r.truck_id::text end, 'forced', r.forced, 'kind', r.kind,
        'dist', coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, r.lat, r.lng)) from jsonb_array_elements(trucks) x),
                         public.km_between(v_hlat, v_hlng, r.lat, r.lng), 0));
      -- the stored routes as the seed (Part 26): a booked stop already on a truck of the plan stays there, in its order
      ti := null;
      if v_seed and r.status = 'booked' and r.truck_id is not null and not coalesce(r.forced, false) then
        for k in 0 .. jsonb_array_length(trucks) - 1 loop
          if trucks->k->>'id' = r.truck_id::text
             and not ((r.kind = 'truck' and not coalesce((trucks->k->>'machine')::boolean, true)) or (r.kind = 'car' and coalesce((trucks->k->>'machine')::boolean, true))) then ti := k; end if;
        end loop;
      end if;
      if ti is not null then
        trucks := jsonb_set(trucks, array[ti::text, 'stops'], (trucks->ti->'stops') || to_jsonb(r.id::text));
        trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb((trucks->ti->>'durs')::int + v_dur));
        v_seedfree := v_seedfree || jsonb_build_object(r.id::text, fe);
      else
        free := free || jsonb_build_array(fe);
      end if;
    end if;
  end loop;

  if v_seed then
    for ti in 0 .. jsonb_array_length(trucks) - 1 loop
      t := trucks->ti;
      continue when not exists (select 1 from jsonb_array_elements_text(t->'stops') s where v_seedfree ? s);
      hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision;
      v_w := public.route_walk_in(t->'stops', pts, (t->>'start')::int, hl, hg, v_speed, v_detour, v_unknown, v_stop, (t->>'nfixed')::int, t->'rg', true);
      if v_w < 0 or (t->>'durs')::int + public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) + v_w > (t->>'cap')::int then
        free := free || (select coalesce(jsonb_agg(v_seedfree->s order by o), '[]'::jsonb) from jsonb_array_elements_text(t->'stops') with ordinality q(s, o) where v_seedfree ? s);
        trucks := jsonb_set(trucks, array[ti::text, 'stops'], (select coalesce(jsonb_agg(to_jsonb(s) order by o), '[]'::jsonb) from jsonb_array_elements_text(t->'stops') with ordinality q(s, o) where not (v_seedfree ? s)));
        trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb(public.durs_of(trucks->ti->'stops', pts)));
      end if;
    end loop;
  end if;

  if p_extra is not null then
    clat := (p_extra->>'lat')::double precision; clng := (p_extra->>'lng')::double precision;
    -- its window: said with the call (ws / we), else the one the job already has; booked « quand même »: none
    v_ws := null; v_we := null;
    if v_wm and not coalesce((p_extra->>'force')::boolean, false) then
      if p_extra ? 'ws' then
        v_ws := nullif(p_extra->>'ws', '')::int; v_we := nullif(p_extra->>'we', '')::int;
      else
        select jj.win_start, jj.win_end into v_ws, v_we from public.jobs jj where jj.id = (p_extra->>'id')::uuid and not jj.forced;
      end if;
    end if;
    pts := pts || jsonb_build_object(p_extra->>'id', jsonb_build_object('lat', clat, 'lng', clng, 'dur', coalesce((p_extra->>'dur')::int, 60))
      || case when v_ws is not null and v_we is not null then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end);
    if v_ws is not null and v_we is not null then v_win := true; end if;
    free := free || jsonb_build_array(jsonb_build_object('id', p_extra->>'id', 'truck', nullif(p_extra->>'truck', ''), 'forced', coalesce((p_extra->>'force')::boolean, false),
      -- which vehicle: said with the booking (`need`: the tire machine; `kind`: the person's choice), else as the job already is
      'kind', case when coalesce((p_extra->>'need')::boolean, false) then 'truck'
                   when p_extra ? 'kind' or p_extra ? 'need' then nullif(p_extra->>'kind', '')
                   else (select case when jj.needs_machine then 'truck' else jj.vehicle_kind end from public.jobs jj where jj.id = (p_extra->>'id')::uuid) end,
      'dist', coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, clat, clng)) from jsonb_array_elements(trucks) x),
                       public.km_between(v_hlat, v_hlng, clat, clng), 0)));
  end if;

  v_forced := (select coalesce(jsonb_agg(e->'id'), '[]'::jsonb) from jsonb_array_elements(free) e where coalesce((e->>'forced')::boolean, false));
  -- pinned jobs first, then the farthest first; the ones booked « quand même » last (they never take the room of another).
  -- Window mode: the stop being added goes after the appointments already there (it never takes a window from them), and
  -- the stops with a promised window before the flexible ones.
  for r in select e from jsonb_array_elements(free) e
           order by coalesce((e->>'forced')::boolean, false), (v_wm and v_xid is not null and e->>'id' = v_xid),
                    (e->>'truck' is not null) desc, (v_wm and (pts->(e->>'id')->>'ws') is null), (e->>'dist')::numeric desc, e->>'id' loop
    jid := r.e->>'id'; jtruck := r.e->>'truck'; pinned := jtruck is not null;
    -- the vehicle (Part 24 terdecies): 'truck' = only one with the tire machine, 'car' = only one without; nothing said: the
    -- car first (a vehicle with the machine costs 10000 more, so it is taken only when no car can take the job)
    jkind := r.e->>'kind';
    carfirst := jkind is null and exists (select 1 from jsonb_array_elements(trucks) x where not coalesce((x->>'machine')::boolean, true));
    jdur := (pts->jid->>'dur')::int;
    best_ti := null; best_cost := null; best_cand := null;
    -- the windows: 1 = every window holds; 2 = this job may arrive after its own (an appointment already booked is placed
    -- late rather than thrown to « À placer »); 3 = the windows are not looked at. The stop being added only gets 1.
    v_try := 1;
    loop
    for ti in 0 .. jsonb_array_length(trucks) - 1 loop
      t := trucks->ti;
      if (jkind = 'truck' and not coalesce((t->>'machine')::boolean, true)) or (jkind = 'car' and coalesce((t->>'machine')::boolean, true)) then continue; end if; hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision; el := (t->>'elat')::double precision; eg := (t->>'elng')::double precision;
      if pinned and t->>'id' <> jtruck then continue; end if;
      n := jsonb_array_length(t->'stops');
      durs := (t->>'durs')::int;
      base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
      basee := public.route_min_to(t->'stops', pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
      v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int; v_bw := 0;
      if (v_win and v_try < 3) or t ? 'rg' then v_bw := greatest(0, public.route_walk_in(t->'stops', pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3)); end if;
      for pos in (t->>'nfixed')::int .. n loop
        cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                  select x, case when o <= pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                  union all select to_jsonb(jid), pos + 1) q);
        rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        rce := public.route_min_to(cand, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        v_w := 0;
        if (v_win and v_try < 3) or t ? 'rg' then
          v_w := public.route_walk_in(cand, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3);
          continue when v_w < 0;
        end if;
        used := durs + jdur + rc + v_w;
        if used <= (t->>'cap')::int then
          cost := (rce - basee) + (v_w - v_bw) + 0.2 * used + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
          if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_pos := pos; end if;
        end if;
      end loop;
    end loop;
    if best_ti is null and pinned and not coalesce((r.e->>'forced')::boolean, false) then
      -- the truck it was put on can no longer take it: try every truck before giving up
      for ti in 0 .. jsonb_array_length(trucks) - 1 loop
        t := trucks->ti;
        if (jkind = 'truck' and not coalesce((t->>'machine')::boolean, true)) or (jkind = 'car' and coalesce((t->>'machine')::boolean, true)) then continue; end if; hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision; el := (t->>'elat')::double precision; eg := (t->>'elng')::double precision;
        n := jsonb_array_length(t->'stops'); durs := (t->>'durs')::int;
        base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        basee := public.route_min_to(t->'stops', pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int; v_bw := 0;
        if (v_win and v_try < 3) or t ? 'rg' then v_bw := greatest(0, public.route_walk_in(t->'stops', pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3)); end if;
        for pos in (t->>'nfixed')::int .. n loop
          cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                    select x, case when o <= pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                    union all select to_jsonb(jid), pos + 1) q);
          rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
          rce := public.route_min_to(cand, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
          v_w := 0;
          if (v_win and v_try < 3) or t ? 'rg' then
            v_w := public.route_walk_in(cand, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3);
            continue when v_w < 0;
          end if;
          used := durs + jdur + rc + v_w;
          if used <= (t->>'cap')::int then
            cost := (rce - basee) + (v_w - v_bw) + 0.2 * used + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
            if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_pos := pos; end if;
          end if;
        end loop;
      end loop;
    end if;
    if best_ti is null and not (pinned and coalesce((r.e->>'forced')::boolean, false)) then
      -- no room as the stops go: each truck again, its stops in a better order (the truck it was put on first).
      -- The order that ends near the next block only when it fits; else the shortest order inside the block.
      for ti in 0 .. jsonb_array_length(trucks) - 1 loop
        t := trucks->ti;
        if (jkind = 'truck' and not coalesce((t->>'machine')::boolean, true)) or (jkind = 'car' and coalesce((t->>'machine')::boolean, true)) then continue; end if; hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision; el := (t->>'elat')::double precision; eg := (t->>'elng')::double precision; durs := (t->>'durs')::int;
        base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        basee := public.route_min_to(t->'stops', pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        cand := public.route_improve((t->'stops') || to_jsonb(jid), (t->>'nfixed')::int, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        if durs + jdur + rc > (t->>'cap')::int and el is not null and eg is not null then
          cand := public.route_improve((t->'stops') || to_jsonb(jid), (t->>'nfixed')::int, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
          rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        end if;
        rce := public.route_min_to(cand, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int; v_w := 0; v_bw := 0;
        if (v_win and v_try < 3) or t ? 'rg' then
          -- the better order drives less but knows nothing of the windows: taken only when they all hold
          v_w := public.route_walk_in(cand, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3);
          continue when v_w < 0;
          v_bw := greatest(0, public.route_walk_in(t->'stops', pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3));
        end if;
        used := durs + jdur + rc + v_w;
        if used <= (t->>'cap')::int then
          cost := (rce - basee) + (v_w - v_bw) + 0.2 * used + case when pinned and t->>'id' <> jtruck then 100000 else 0 end + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
          if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_cand := cand; end if;
        end if;
      end loop;
    end if;
    exit when best_ti is not null or not v_win or v_try >= 3 or jid is not distinct from v_xid
      -- booked « quand même »: window mode, it is tried inside its window, then late (Part 26); else straight to the end
      or (coalesce((r.e->>'forced')::boolean, false) and not (v_wm and v_try = 1 and (pts->jid->>'we') is not null));
    if v_try = 1 and (pts->jid->>'we') is not null then
      v_try := 2; pts := jsonb_set(pts, array[jid, 'late'], 'true'::jsonb);
    else
      v_try := 3;
    end if;
    end loop;
    if best_ti is null and coalesce((r.e->>'forced')::boolean, false) then
      -- booked « quand même » in a full block: at the end of the route of the truck where it adds the least driving, past its
      -- hours (the truck it was put on, if it works the block); the customers already booked keep their times
      for ti in 0 .. jsonb_array_length(trucks) - 1 loop
        t := trucks->ti;
        if (jkind = 'truck' and not coalesce((t->>'machine')::boolean, true)) or (jkind = 'car' and coalesce((t->>'machine')::boolean, true)) then continue; end if; hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision; el := (t->>'elat')::double precision; eg := (t->>'elng')::double precision;
        n := jsonb_array_length(t->'stops');
        base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        rc := public.route_min((t->'stops') || to_jsonb(jid), pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        cost := (rc - base) + case when pinned and t->>'id' <> jtruck then 100000 else 0 end + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
        if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_pos := n; end if;
      end loop;
      if best_ti is not null then v_pastend := v_pastend || to_jsonb(jid); end if;
    end if;
    if best_ti is null then
      over := over || to_jsonb(jid);
    else
      t := trucks->best_ti;
      cand := coalesce(best_cand, (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                select x, case when o <= best_pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                union all select to_jsonb(jid), best_pos + 1) q));
      trucks := jsonb_set(trucks, array[best_ti::text, 'stops'], cand);
      trucks := jsonb_set(trucks, array[best_ti::text, 'durs'], to_jsonb(durs_of(cand, pts)));
    end if;
  end loop;

  -- window mode, a day already started (Part 26): an appointment that no longer fits stays on its truck (apply_plan never
  -- un-places it there), so it counts there, at the end of the route past the hours, late, instead of in « over »: the
  -- time it needs is not sold again to a same-day booking
  if v_wm and p_day = v_today and jsonb_array_length(over) > 0 then
    for jid in select o from jsonb_array_elements_text(over) o loop
      continue when jid is not distinct from v_xid;
      ti := null;
      for k in 0 .. jsonb_array_length(trucks) - 1 loop
        if trucks->k->>'id' = (select j.truck_id::text from public.jobs j where j.id::text = jid and j.status = 'booked') then ti := k; end if;
      end loop;
      continue when ti is null;
      trucks := jsonb_set(trucks, array[ti::text, 'stops'], (trucks->ti->'stops') || to_jsonb(jid));
      trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb((trucks->ti->>'durs')::int + coalesce((pts->jid->>'dur')::int, 0)));
      pts := jsonb_set(pts, array[jid, 'late'], 'true'::jsonb);
      v_forced := v_forced || to_jsonb(jid); v_pastend := v_pastend || to_jsonb(jid);
      over := over - jid;
    end loop;
  end if;

  -- each truck's stops in the order that drives the least (from where it is, toward its next block), then arrival times, drive of each leg, what is left.
  -- Ending near the next block never costs room in this block: when that order no longer fits in the truck's hours,
  -- the shortest order inside the block (it never drives more than the order the stops were put in, which fits).
  for ti in 0 .. jsonb_array_length(trucks) - 1 loop
    hl := (trucks->ti->>'hlat')::double precision; hg := (trucks->ti->>'hlng')::double precision;
    el := (trucks->ti->>'elat')::double precision; eg := (trucks->ti->>'elng')::double precision;
    -- the stops booked « quand même » (not on the way or there) stay at the end, in the order they were added (window mode:
    -- only the ones placed past the hours; the others are where they fit, Part 26)
    v_tail := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(trucks->ti->'stops') with ordinality s(x, o)
               where o > (trucks->ti->>'nfixed')::int and v_forced @> jsonb_build_array(x) and (not v_wm or v_pastend @> jsonb_build_array(x)));
    cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(trucks->ti->'stops') with ordinality s(x, o)
             where not (v_tail @> jsonb_build_array(x)));
    t := public.route_improve(cand, (trucks->ti->>'nfixed')::int, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
    if el is not null and eg is not null
       and (trucks->ti->>'durs')::int + public.route_min(t || v_tail, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) > (trucks->ti->>'cap')::int then
      t := public.route_improve(cand, (trucks->ti->>'nfixed')::int, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
    end if;
    if v_win or trucks->ti ? 'rg' then
      -- the order that drives the least is kept only when every window still holds and it costs no more driving + waiting
      -- than the order the stops were put in (which holds them)
      v_start := (trucks->ti->>'start')::int; v_nf := (trucks->ti->>'nfixed')::int;
      v_w := public.route_walk_in(t || v_tail, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, trucks->ti->'rg', v_win);
      v_bw := public.route_walk_in(cand || v_tail, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, trucks->ti->'rg', v_win);
      if v_bw >= 0 and (v_w < 0 or public.route_min(t || v_tail, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) + v_w
                                 > public.route_min(cand || v_tail, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) + v_bw) then
        t := cand;
      end if;
    end if;
    trucks := jsonb_set(trucks, array[ti::text, 'stops'], t || v_tail);
    t := trucks->ti; tm := (t->>'start')::int; plat := hl; plng := hg; k := 0; v_wt := 0;
    -- window mode, today: the stops come after the ones this truck already finished (they keep 1, 2, …: Part 26)
    v_dn := case when v_wm and p_day = v_today then (select count(*)::int from public.jobs j where j.truck_id = (t->>'id')::uuid and j.day = p_day
                   and j.block = p_block and j.status = 'done' and j.deleted_at is null and (p_exclude is null or j.id <> p_exclude)) else 0 end;
    for jid in select jsonb_array_elements_text(t->'stops') loop
      k := k + 1;
      clat := (pts->jid->>'lat')::double precision; clng := (pts->jid->>'lng')::double precision;
      leg := public.drive_min(plat, plng, clat, clng, v_speed, v_detour, v_unknown);
      tm := tm + leg;
      if v_win and k > (t->>'nfixed')::int then
        -- early at a stop with a window: the truck waits until it opens
        v_ws := (pts->jid->>'ws')::int; v_we := (pts->jid->>'we')::int;
        if v_ws is not null and tm < v_ws then v_wt := v_wt + (v_ws - tm); tm := v_ws; end if;
        if t ? 'rg' then tm := coalesce(public.ranges_fit(t->'rg', tm, ceil(v_stop)::int + (pts->jid->>'dur')::int), tm); end if;
        if v_we is not null and tm > v_we then v_late := v_late || to_jsonb(jid); end if;
      elsif t ? 'rg' and k > (t->>'nfixed')::int then
        tm := coalesce(public.ranges_fit(t->'rg', tm, ceil(v_stop)::int + (pts->jid->>'dur')::int), tm);
      end if;
      out_jobs := out_jobs || jsonb_build_object(jid, coalesce(out_jobs->jid, '{}'::jsonb) || jsonb_build_object('truck', t->>'id', 'order', k + v_dn, 'eta', coalesce((pts->jid->>'eta0')::int, tm), 'travel', leg + ceil(v_stop)::int));
      tm := tm + ceil(v_stop)::int + (pts->jid->>'dur')::int;
      if clat is not null then plat := clat; plng := clng; end if;
    end loop;
    used := (t->>'durs')::int + public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) + v_wt;
    trucks := jsonb_set(trucks, array[ti::text], (t - 'nfixed' - 'durs' - 'rg') || jsonb_build_object('used', used, 'left', (t->>'cap')::int - used, 'wait', v_wt));
  end loop;

  placed := p_extra is not null and (out_jobs ? (p_extra->>'id'));
  v_res := jsonb_build_object('day', p_day, 'block', p_block, 'trucks', trucks, 'jobs', out_jobs, 'over', over, 'late', v_late,
    'extra', case when p_extra is null then null else jsonb_build_object('placed', placed, 'truck', out_jobs->(p_extra->>'id')->>'truck', 'eta', out_jobs->(p_extra->>'id')->>'eta') end);
  -- Part 26 (window mode): this plan makes late an appointment that its stored route reaches in its window: the plan seeded
  -- with the stored routes (they stay, the new stop goes where every window holds) is taken when it makes fewer late
  if p_seed is null and v_wm and public.plan_late_stored(v_res, v_xid) > 0 then
    v_alt := public.plan_route(p_day, p_block, p_extra, p_exclude, true);
    if public.plan_late_stored(v_alt, v_xid) < public.plan_late_stored(v_res, v_xid)
       and not exists (select 1 from jsonb_array_elements_text(coalesce(v_alt->'over', '[]'::jsonb)) o where not (coalesce(v_res->'over', '[]'::jsonb) ? o) and o is distinct from v_xid) then
      return v_alt;
    end if;
  end if;
  return v_res;
end $function$;
revoke all on function public.plan_route(date, text, jsonb, uuid, boolean) from public, anon, authenticated;
grant execute on function public.plan_route(date, text, jsonb, uuid, boolean) to service_role;

-- plan_block: the same arguments and answer as before, through plan_route
create or replace function public.plan_block(p_day date, p_block text, p_extra jsonb default null::jsonb, p_exclude uuid default null::uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  return public.plan_route(p_day, p_block, p_extra, p_exclude, null);
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 11. The automatic re-plans
-- ---------------------------------------------------------------------------------------------------------------------

-- replan_block (live text): an automatic re-plan (a position found in the background, work that now needs the tire
-- machine) leaves the block as it was rather than throw an appointment that has a truck to « À placer »
-- (sql-planner-1 B4, sql-planner-2 B6). replan_days (the hours, a truck switched off, a start moved) keeps the rule of
-- before: a job that fits nowhere any more goes to « À placer » (garage.unplace).
CREATE OR REPLACE FUNCTION public.replan_block(p_day date, p_block text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_plan jsonb;
begin
  -- a block already started (or past) is left as it is: its jobs stay on their truck, in their order
  if not public.block_open(p_day, p_block) then return jsonb_build_object('skipped', true, 'day', p_day, 'block', p_block); end if;
  -- Part 26: an automatic re-plan (a position found, work that now needs the tire machine, …) never throws an appointment
  -- that has a truck to « À placer »: the block stays as it was. Only a change of the hours, of a truck or of the start
  -- does (replan_days).
  if coalesce(current_setting('garage.unplace', true), '') <> 'on' then return public.replan_block_safe(p_day, p_block); end if;
  perform public.lock_block(p_day, p_block);
  v_plan := public.plan_block(p_day, p_block);
  perform public.apply_plan(v_plan);
  return v_plan;
end $function$;

CREATE OR REPLACE FUNCTION public.replan_days(p_days date[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d date; b record; n int := 0; v_chain text := coalesce(current_setting('garage.chain', true), '');
  v_unplace text := coalesce(current_setting('garage.unplace', true), '');
begin
  perform set_config('garage.chain', 'on', true);
  -- the hours, a truck or the start changed: a job that no longer fits anywhere goes to « À placer », as before (Part 26)
  perform set_config('garage.unplace', 'on', true);
  foreach d in array p_days loop
    for b in select x.key, x.start_min from public.blocks() x order by x.pos loop
      if not public.block_open(d, b.key) then continue; end if;
      if exists (select 1 from public.jobs j where j.day = d and j.block = b.key and j.deleted_at is null and j.status = 'booked') then
        perform public.replan_block(d, b.key); n := n + 1;
      end if;
    end loop;
  end loop;
  perform set_config('garage.chain', v_chain, true);
  perform set_config('garage.unplace', v_unplace, true);
  return n;
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 12. A vehicle that gets or loses the tire machine
-- ---------------------------------------------------------------------------------------------------------------------

-- trucks_kind_keep (live text): only the appointments still to come take the vehicle's new kind (every job it ever did
-- was rewritten, and downloaded again by every phone); losing the machine plans its coming work for the machine again
-- (sql-planner-2-06; the list to show before saving needs an RPC and a sheet in the app: not done here).
CREATE OR REPLACE FUNCTION public.trucks_kind_keep()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_days date[];
begin
  -- only the appointments still to come take the vehicle's new kind: its history is not rewritten (Part 26)
  update public.jobs set vehicle_kind = case when new.tire_machine then 'truck' else 'car' end
   where truck_id = new.id and deleted_at is null and status = 'booked' and day >= public.local_today()
     and vehicle_kind is distinct from case when new.tire_machine then 'truck' else 'car' end;
  -- the vehicle no longer has the tire machine: its coming work for the machine is planned again, on a vehicle that has
  -- it, else « À placer » (it stayed on the car until something else re-planned its block)
  if coalesce(old.tire_machine, true) and not coalesce(new.tire_machine, true) then
    select coalesce(array_agg(distinct j.day order by j.day), '{}') into v_days from public.jobs j
    where j.truck_id = new.id and j.needs_machine and j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today();
    if cardinality(v_days) > 0 then
      perform public.replan_days(v_days);
      perform set_config('garage.rpc', '', true);
    end if;
  end if;
  return null;
end $function$;
