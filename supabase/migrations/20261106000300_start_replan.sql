-- Part 17: the trucks' starting point and a better order of the stops.
-- 1. « Départ des camions » (Réglages, Réservations): when the starting point moves, or a number of the route estimate
--    changes (speed, detour, minutes per stop, unknown drive, free time, the blocks), every coming block with booked
--    appointments is re-planned at once, the same as after a change of hours (blocks already started today are left
--    alone: replan_days). Only the name on the map changed: nothing is re-planned.
-- 2. The planner still puts each appointment where it adds the least driving (cheapest insertion), then improves the
--    route of each truck: a piece of the route driven the other way, or one stop moved elsewhere, as long as it saves
--    minutes (route_improve). Appointments on the way or there stay first, in their order. An appointment that fits
--    nowhere as the stops go is tried again with the stops of each truck in a better order.

-- ---------- a better order for the stops of one truck ----------
-- p_ids: the stops in order; the first p_fixed stay where they are (on the way, on site). Returns the stops in the
-- order that drives the least (home → stops, no return leg), never a longer one than given.
create or replace function public.route_improve(p_ids jsonb, p_fixed int, p_pts jsonb, p_hlat double precision, p_hlng double precision,
  p_speed numeric, p_detour numeric, p_unknown numeric, p_stop numeric) returns jsonb
language plpgsql immutable set search_path = public, extensions as $$
declare
  ids text[] := array(select e from jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) with ordinality q(e, o) order by o);
  n int := cardinality(ids);
  f int := least(greatest(coalesce(p_fixed, 0), 0), cardinality(ids));
  best int; c int; cand text[]; rest text[]; x text; i int; k int; better boolean := true; passes int := 0;
begin
  if n - f < 2 then return to_jsonb(ids); end if;
  best := public.route_min(to_jsonb(ids), p_pts, p_hlat, p_hlng, p_speed, p_detour, p_unknown, p_stop);
  while better and passes < 25 loop
    better := false; passes := passes + 1;
    -- a piece of the route driven the other way (the route does not come back: its end may turn too)
    for i in f + 1 .. n - 1 loop
      for k in i + 1 .. n loop
        cand := ids[1:i - 1] || array(select ids[p] from generate_series(i, k) p order by p desc) || ids[k + 1:n];
        c := public.route_min(to_jsonb(cand), p_pts, p_hlat, p_hlng, p_speed, p_detour, p_unknown, p_stop);
        if c < best then ids := cand; best := c; better := true; end if;
      end loop;
    end loop;
    -- one stop moved elsewhere
    for i in f + 1 .. n loop
      for k in f + 1 .. n loop
        continue when k = i;
        x := ids[i];
        rest := ids[1:i - 1] || ids[i + 1:n];
        cand := (rest[1:k - 1] || x) || rest[k:n - 1];
        c := public.route_min(to_jsonb(cand), p_pts, p_hlat, p_hlng, p_speed, p_detour, p_unknown, p_stop);
        if c < best then ids := cand; best := c; better := true; end if;
      end loop;
    end loop;
  end loop;
  return to_jsonb(ids);
end $$;

/* ---------- the planner ----------
   plan_block(day, block, extra, exclude) → {
     trucks: [{id, cap, start, used, left, stops: [job ids in order]}],
     jobs:   {job_id: {truck, order, eta, travel, fixed}},
     over:   [job ids that fit nowhere],
     extra:  {placed, truck}
   }
   - trucks: in service, with working hours inside the block (today: only what is left from now);
   - jobs already en route / on site stay on their truck, first; finished ones no longer count;
   - a job put on a truck by hand stays there while that truck works the block;
   - the others go, farthest first, where they add the least driving (cheapest insertion), as long as
     durations + driving fit in the truck's hours; a job that fits nowhere is tried again with the stops of each
     truck in a better order. The rest is "over" (« À placer »);
   - then each truck's stops are put in the order that drives the least (route_improve). */
create or replace function public.plan_block(p_day date, p_block text, p_extra jsonb default null, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
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
begin
  select * into b from public.blocks() x where x.key = p_block;
  if not found then raise exception 'Bloc inconnu : %', p_block using errcode = '22023'; end if;
  select h.lat, h.lng into v_hlat, v_hlng from public.home_point() h;
  v_from := case when p_day = v_today then (ceil(public.now_min() / 5.0) * 5)::int when p_day < v_today then 1440 else 0 end;

  -- trucks working this block
  for r in select tr.id from public.trucks tr where tr.active and tr.deleted_at is null order by tr.sort, tr.name, tr.id loop
    rg := public.ranges_from(public.truck_ranges(r.id, p_day), v_from);
    cap := public.ranges_overlap(rg, b.start_min, b.end_min);
    if cap >= least(v_minblock, b.end_min - b.start_min) or (cap > 0 and exists (select 1 from public.jobs j where j.truck_id = r.id and j.day = p_day and j.block = p_block and j.status in ('en_route','on_site') and j.deleted_at is null)) then
      trucks := trucks || jsonb_build_array(jsonb_build_object('id', r.id, 'cap', cap, 'start', coalesce(public.ranges_first(rg, b.start_min, b.end_min), b.start_min), 'stops', '[]'::jsonb, 'nfixed', 0, 'durs', 0));
    end if;
  end loop;

  -- the jobs of the block
  for r in
    select j.id, j.truck_id, j.truck_pinned, j.status, j.duration_min, j.stop_order,
           coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng
    from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.day = p_day and j.block = p_block and j.deleted_at is null and j.status not in ('cancelled','no_show','done')
      and (p_exclude is null or j.id <> p_exclude)
    order by (j.status in ('en_route','on_site')) desc, j.stop_order nulls last, j.created_at
  loop
    pts := pts || jsonb_build_object(r.id::text, jsonb_build_object('lat', r.lat, 'lng', r.lng, 'dur', r.duration_min));
    if r.status in ('en_route','on_site') then
      -- stays where it is, before the others
      ti := null;
      for k in 0 .. jsonb_array_length(trucks) - 1 loop if trucks->k->>'id' = r.truck_id::text then ti := k; end if; end loop;
      if ti is not null then
        trucks := jsonb_set(trucks, array[ti::text, 'stops'], (trucks->ti->'stops') || to_jsonb(r.id::text));
        trucks := jsonb_set(trucks, array[ti::text, 'nfixed'], to_jsonb((trucks->ti->>'nfixed')::int + 1));
        trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb((trucks->ti->>'durs')::int + r.duration_min));
      end if;
      out_jobs := out_jobs || jsonb_build_object(r.id::text, jsonb_build_object('truck', r.truck_id, 'fixed', true));
    else
      free := free || jsonb_build_array(jsonb_build_object('id', r.id::text, 'truck', case when r.truck_pinned then r.truck_id::text end,
        'dist', coalesce(public.km_between(v_hlat, v_hlng, r.lat, r.lng), 0)));
    end if;
  end loop;

  if p_extra is not null then
    pts := pts || jsonb_build_object(p_extra->>'id', jsonb_build_object('lat', (p_extra->>'lat')::double precision, 'lng', (p_extra->>'lng')::double precision, 'dur', coalesce((p_extra->>'dur')::int, 60)));
    free := free || jsonb_build_array(jsonb_build_object('id', p_extra->>'id', 'truck', nullif(p_extra->>'truck', ''),
      'dist', coalesce(public.km_between(v_hlat, v_hlng, (p_extra->>'lat')::double precision, (p_extra->>'lng')::double precision), 0)));
  end if;

  -- pinned jobs first, then the farthest first
  for r in select e from jsonb_array_elements(free) e order by (e->>'truck' is not null) desc, (e->>'dist')::numeric desc, e->>'id' loop
    jid := r.e->>'id'; jtruck := r.e->>'truck'; pinned := jtruck is not null;
    jdur := (pts->jid->>'dur')::int;
    best_ti := null; best_cost := null; best_cand := null;
    for ti in 0 .. jsonb_array_length(trucks) - 1 loop
      t := trucks->ti;
      if pinned and t->>'id' <> jtruck then continue; end if;
      n := jsonb_array_length(t->'stops');
      durs := (t->>'durs')::int;
      base := public.route_min(t->'stops', pts, v_hlat, v_hlng, v_speed, v_detour, v_unknown, v_stop);
      for pos in (t->>'nfixed')::int .. n loop
        cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                  select x, case when o <= pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                  union all select to_jsonb(jid), pos + 1) q);
        rc := public.route_min(cand, pts, v_hlat, v_hlng, v_speed, v_detour, v_unknown, v_stop);
        used := durs + jdur + rc;
        if used <= (t->>'cap')::int then
          cost := (rc - base) + 0.2 * used;
          if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_pos := pos; end if;
        end if;
      end loop;
    end loop;
    if best_ti is null and pinned then
      -- the truck it was put on can no longer take it: try every truck before giving up
      for ti in 0 .. jsonb_array_length(trucks) - 1 loop
        t := trucks->ti; n := jsonb_array_length(t->'stops'); durs := (t->>'durs')::int;
        base := public.route_min(t->'stops', pts, v_hlat, v_hlng, v_speed, v_detour, v_unknown, v_stop);
        for pos in (t->>'nfixed')::int .. n loop
          cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                    select x, case when o <= pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                    union all select to_jsonb(jid), pos + 1) q);
          rc := public.route_min(cand, pts, v_hlat, v_hlng, v_speed, v_detour, v_unknown, v_stop);
          used := durs + jdur + rc;
          if used <= (t->>'cap')::int then
            cost := (rc - base) + 0.2 * used;
            if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_pos := pos; end if;
          end if;
        end loop;
      end loop;
    end if;
    if best_ti is null then
      -- no room as the stops go: each truck again, its stops in a better order (the truck it was put on first)
      for ti in 0 .. jsonb_array_length(trucks) - 1 loop
        t := trucks->ti; durs := (t->>'durs')::int;
        base := public.route_min(t->'stops', pts, v_hlat, v_hlng, v_speed, v_detour, v_unknown, v_stop);
        cand := public.route_improve((t->'stops') || to_jsonb(jid), (t->>'nfixed')::int, pts, v_hlat, v_hlng, v_speed, v_detour, v_unknown, v_stop);
        rc := public.route_min(cand, pts, v_hlat, v_hlng, v_speed, v_detour, v_unknown, v_stop);
        used := durs + jdur + rc;
        if used <= (t->>'cap')::int then
          cost := (rc - base) + 0.2 * used + case when pinned and t->>'id' <> jtruck then 100000 else 0 end;
          if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_cand := cand; end if;
        end if;
      end loop;
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

  -- each truck's stops in the order that drives the least, then arrival times, drive of each leg, what is left
  for ti in 0 .. jsonb_array_length(trucks) - 1 loop
    trucks := jsonb_set(trucks, array[ti::text, 'stops'],
      public.route_improve(trucks->ti->'stops', (trucks->ti->>'nfixed')::int, pts, v_hlat, v_hlng, v_speed, v_detour, v_unknown, v_stop));
    t := trucks->ti; tm := (t->>'start')::int; plat := v_hlat; plng := v_hlng; k := 0;
    for jid in select jsonb_array_elements_text(t->'stops') loop
      k := k + 1;
      clat := (pts->jid->>'lat')::double precision; clng := (pts->jid->>'lng')::double precision;
      leg := public.drive_min(plat, plng, clat, clng, v_speed, v_detour, v_unknown);
      tm := tm + leg;
      out_jobs := out_jobs || jsonb_build_object(jid, coalesce(out_jobs->jid, '{}'::jsonb) || jsonb_build_object('truck', t->>'id', 'order', k, 'eta', tm, 'travel', leg + ceil(v_stop)::int));
      tm := tm + ceil(v_stop)::int + (pts->jid->>'dur')::int;
      if clat is not null then plat := clat; plng := clng; end if;
    end loop;
    used := (t->>'durs')::int + public.route_min(t->'stops', pts, v_hlat, v_hlng, v_speed, v_detour, v_unknown, v_stop);
    trucks := jsonb_set(trucks, array[ti::text], (t - 'nfixed' - 'durs') || jsonb_build_object('used', used, 'left', (t->>'cap')::int - used));
  end loop;

  placed := p_extra is not null and (out_jobs ? (p_extra->>'id'));
  return jsonb_build_object('day', p_day, 'block', p_block, 'trucks', trucks, 'jobs', out_jobs, 'over', over,
    'extra', case when p_extra is null then null else jsonb_build_object('placed', placed, 'truck', out_jobs->(p_extra->>'id')->>'truck', 'eta', out_jobs->(p_extra->>'id')->>'eta') end);
end $$;

-- ---------- the starting point or the numbers change: the coming blocks are planned again ----------
-- what the planner reads in the « booking » settings (the name and the written address of the start do not count)
create or replace function public.plan_inputs(p_booking jsonb) returns jsonb language sql immutable set search_path = public, extensions as $$
  select jsonb_build_object('lat', p_booking->'home'->'lat', 'lng', p_booking->'home'->'lng', 'speed', p_booking->'speed_kmh',
    'detour', p_booking->'detour', 'stop', p_booking->'stop_min', 'unknown', p_booking->'unknown_min',
    'min_block', p_booking->'min_block_min', 'blocks', p_booking->'blocks')
$$;
create or replace function public.settings_replan() returns trigger language plpgsql security definer set search_path = public as $$
declare v_days date[];
begin
  if public.plan_inputs(old.booking) is not distinct from public.plan_inputs(new.booking) then return null; end if;
  select coalesce(array_agg(distinct j.day), '{}') into v_days from public.jobs j
  where j.day >= public.local_today() and j.status = 'booked' and j.deleted_at is null;
  perform public.replan_days(v_days);
  perform set_config('garage.rpc', '', true);
  return null;
end $$;
create or replace trigger settings_replan after update of booking on public.settings
  for each row execute function public.settings_replan();

-- the server's own building blocks are not callable from the app (Part 13)
revoke all on function public.route_improve(jsonb, int, jsonb, double precision, double precision, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.route_improve(jsonb, int, jsonb, double precision, double precision, numeric, numeric, numeric, numeric) to service_role;
revoke all on function public.plan_inputs(jsonb) from public, anon, authenticated;
grant execute on function public.plan_inputs(jsonb) to service_role;
revoke all on function public.settings_replan() from public, anon, authenticated;
