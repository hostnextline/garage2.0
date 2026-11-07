-- Part 18: a starting point per truck (a mechanic who takes his truck home).
-- 1. trucks.start = {label, address, lat, lng}, or null: the truck leaves from « Départ des camions » (settings.booking.home).
-- 2. The planner drives each truck from where it really is when the block starts: its last stop of the block before
--    (same day), else its own start, else « Départ des camions ». It also tries to finish each block close to the
--    truck's first stop of the next block (that last leg counts in the order of the stops, not in the block's room:
--    an order that would no longer fit in the truck's hours is never taken for it).
--    The blocks booked by the customers never change: only the truck and the order inside the block can.
--    When a block's plan changes, the other coming blocks of that day are planned again, in block order (they start
--    or end elsewhere now), unless that would put a booked appointment in « À placer »: then that block stays as it was.
--    Many days planned again at once (replan_days: hours, « Départ des camions », a truck's start) go day by day,
--    in block order, without that chain (it would plan every block twice).
-- 3. set_truck_start(op, truck, start): the owner, the office (« Horaires ») or the truck's own driver. Moving a truck's
--    start re-plans every coming booked block at once (trigger trucks_replan); its name alone does not.
-- 4. team_map gives each truck its start (the map draws each route from there).

alter table public.trucks add column if not exists start jsonb;
alter table public.trucks drop constraint if exists trucks_start_ok;
alter table public.trucks add constraint trucks_start_ok check (
  start is null or (jsonb_typeof(start) = 'object'
    and jsonb_typeof(start->'lat') = 'number' and jsonb_typeof(start->'lng') = 'number'
    and abs((start->>'lat')::double precision) <= 90 and abs((start->>'lng')::double precision) <= 180));

-- where a truck leaves from: its own start, else « Départ des camions »
create or replace function public.truck_home(p_truck uuid) returns table(lat double precision, lng double precision, own boolean)
language sql stable security definer set search_path = public as $$
  select coalesce((t.start->>'lat')::double precision, h.lat), coalesce((t.start->>'lng')::double precision, h.lng), t.start is not null
  from public.home_point() h left join public.trucks t on t.id = p_truck
$$;

-- drive + stop time of a route start → stops, plus the leg from where it ends to p_e (the next block), when given.
-- With no stop the route ends where it starts: the truck drives start → next block all the same, so adding a first
-- stop costs only the detour (not the whole way to the next block).
create or replace function public.route_min_to(p_ids jsonb, p_pts jsonb, p_hlat double precision, p_hlng double precision,
  p_elat double precision, p_elng double precision, p_speed numeric, p_detour numeric, p_unknown numeric, p_stop numeric) returns int
language plpgsql immutable set search_path = public, extensions as $$
declare plat double precision := p_hlat; plng double precision := p_hlng; clat double precision; clng double precision; tot int := 0; id text;
begin
  for id in select jsonb_array_elements_text(coalesce(p_ids, '[]')) loop
    clat := (p_pts->id->>'lat')::double precision; clng := (p_pts->id->>'lng')::double precision;
    tot := tot + public.drive_min(plat, plng, clat, clng, p_speed, p_detour, p_unknown) + ceil(p_stop)::int;
    if clat is not null then plat := clat; plng := clng; end if;
  end loop;
  if p_elat is not null and p_elng is not null then
    tot := tot + public.drive_min(plat, plng, p_elat, p_elng, p_speed, p_detour, p_unknown);
  end if;
  return tot;
end $$;

-- route_improve (Part 17) that also counts the leg toward the next block (p_e, or nothing when null)
create or replace function public.route_improve(p_ids jsonb, p_fixed int, p_pts jsonb, p_hlat double precision, p_hlng double precision,
  p_elat double precision, p_elng double precision, p_speed numeric, p_detour numeric, p_unknown numeric, p_stop numeric) returns jsonb
language plpgsql immutable set search_path = public, extensions as $$
declare
  ids text[] := array(select e from jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) with ordinality q(e, o) order by o);
  n int := cardinality(ids);
  f int := least(greatest(coalesce(p_fixed, 0), 0), cardinality(ids));
  best int; c int; cand text[]; rest text[]; x text; i int; k int; better boolean := true; passes int := 0;
begin
  if n - f < 2 then return to_jsonb(ids); end if;
  best := public.route_min_to(to_jsonb(ids), p_pts, p_hlat, p_hlng, p_elat, p_elng, p_speed, p_detour, p_unknown, p_stop);
  while better and passes < 25 loop
    better := false; passes := passes + 1;
    -- a piece of the route driven the other way
    for i in f + 1 .. n - 1 loop
      for k in i + 1 .. n loop
        cand := ids[1:i - 1] || array(select ids[p] from generate_series(i, k) p order by p desc) || ids[k + 1:n];
        c := public.route_min_to(to_jsonb(cand), p_pts, p_hlat, p_hlng, p_elat, p_elng, p_speed, p_detour, p_unknown, p_stop);
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
        c := public.route_min_to(to_jsonb(cand), p_pts, p_hlat, p_hlng, p_elat, p_elng, p_speed, p_detour, p_unknown, p_stop);
        if c < best then ids := cand; best := c; better := true; end if;
      end loop;
    end loop;
  end loop;
  return to_jsonb(ids);
end $$;
-- the Part 17 form (no next block) answers the same as before
create or replace function public.route_improve(p_ids jsonb, p_fixed int, p_pts jsonb, p_hlat double precision, p_hlng double precision,
  p_speed numeric, p_detour numeric, p_unknown numeric, p_stop numeric) returns jsonb
language sql immutable set search_path = public, extensions as $$
  select public.route_improve(p_ids, p_fixed, p_pts, p_hlat, p_hlng, null::double precision, null::double precision, p_speed, p_detour, p_unknown, p_stop)
$$;

/* ---------- the planner (Part 17, each truck from where it is) ----------
   plan_block(day, block, extra, exclude) → {
     trucks: [{id, cap, start, hlat, hlng, from: prev|own|home, elat, elng, used, left, stops: [job ids in order]}],
     jobs:   {job_id: {truck, order, eta, travel, fixed}},
     over:   [job ids that fit nowhere],
     extra:  {placed, truck}
   } */
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
  hl double precision; hg double precision; el double precision; eg double precision; rce int; basee int;
  v_prev text; v_next text; v_from_kind text;
begin
  select * into b from public.blocks() x where x.key = p_block;
  if not found then raise exception 'Bloc inconnu : %', p_block using errcode = '22023'; end if;
  select h.lat, h.lng into v_hlat, v_hlng from public.home_point() h;
  v_from := case when p_day = v_today then (ceil(public.now_min() / 5.0) * 5)::int when p_day < v_today then 1440 else 0 end;

  select x.key into v_prev from public.blocks() x where x.pos = b.pos - 1;
  select x.key into v_next from public.blocks() x where x.pos = b.pos + 1;

  -- trucks working this block, each with where it leaves from and where its next block starts
  for r in select tr.id, tr.start from public.trucks tr where tr.active and tr.deleted_at is null order by tr.sort, tr.name, tr.id loop
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
      v_from_kind := case when hl is not null then 'prev' when r.start is not null then 'own' else 'home' end;
      if hl is null then hl := coalesce((r.start->>'lat')::double precision, v_hlat); hg := coalesce((r.start->>'lng')::double precision, v_hlng); end if;
      -- tries to finish close to its first stop of the next block
      if v_next is not null then
        select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into el, eg from public.jobs j left join public.customers c on c.id = j.customer_id
        where j.truck_id = r.id and j.day = p_day and j.block = v_next and j.deleted_at is null and j.status not in ('cancelled','no_show','done')
          and (p_exclude is null or j.id <> p_exclude) and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
        order by j.stop_order nulls last, j.eta_min nulls last limit 1;
      end if;
      trucks := trucks || jsonb_build_array(jsonb_build_object('id', r.id, 'cap', cap, 'start', coalesce(public.ranges_first(rg, b.start_min, b.end_min), b.start_min),
        'hlat', hl, 'hlng', hg, 'from', v_from_kind, 'elat', el, 'elng', eg, 'stops', '[]'::jsonb, 'nfixed', 0, 'durs', 0));
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
      -- « farthest first »: from the nearest start of the trucks working the block
      free := free || jsonb_build_array(jsonb_build_object('id', r.id::text, 'truck', case when r.truck_pinned then r.truck_id::text end,
        'dist', coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, r.lat, r.lng)) from jsonb_array_elements(trucks) x),
                         public.km_between(v_hlat, v_hlng, r.lat, r.lng), 0)));
    end if;
  end loop;

  if p_extra is not null then
    clat := (p_extra->>'lat')::double precision; clng := (p_extra->>'lng')::double precision;
    pts := pts || jsonb_build_object(p_extra->>'id', jsonb_build_object('lat', clat, 'lng', clng, 'dur', coalesce((p_extra->>'dur')::int, 60)));
    free := free || jsonb_build_array(jsonb_build_object('id', p_extra->>'id', 'truck', nullif(p_extra->>'truck', ''),
      'dist', coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, clat, clng)) from jsonb_array_elements(trucks) x),
                       public.km_between(v_hlat, v_hlng, clat, clng), 0)));
  end if;

  -- pinned jobs first, then the farthest first
  for r in select e from jsonb_array_elements(free) e order by (e->>'truck' is not null) desc, (e->>'dist')::numeric desc, e->>'id' loop
    jid := r.e->>'id'; jtruck := r.e->>'truck'; pinned := jtruck is not null;
    jdur := (pts->jid->>'dur')::int;
    best_ti := null; best_cost := null; best_cand := null;
    for ti in 0 .. jsonb_array_length(trucks) - 1 loop
      t := trucks->ti; hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision; el := (t->>'elat')::double precision; eg := (t->>'elng')::double precision;
      if pinned and t->>'id' <> jtruck then continue; end if;
      n := jsonb_array_length(t->'stops');
      durs := (t->>'durs')::int;
      base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
      basee := public.route_min_to(t->'stops', pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
      for pos in (t->>'nfixed')::int .. n loop
        cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                  select x, case when o <= pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                  union all select to_jsonb(jid), pos + 1) q);
        rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        rce := public.route_min_to(cand, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        used := durs + jdur + rc;
        if used <= (t->>'cap')::int then
          cost := (rce - basee) + 0.2 * used;
          if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_pos := pos; end if;
        end if;
      end loop;
    end loop;
    if best_ti is null and pinned then
      -- the truck it was put on can no longer take it: try every truck before giving up
      for ti in 0 .. jsonb_array_length(trucks) - 1 loop
        t := trucks->ti; hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision; el := (t->>'elat')::double precision; eg := (t->>'elng')::double precision;
        n := jsonb_array_length(t->'stops'); durs := (t->>'durs')::int;
        base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        basee := public.route_min_to(t->'stops', pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        for pos in (t->>'nfixed')::int .. n loop
          cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                    select x, case when o <= pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                    union all select to_jsonb(jid), pos + 1) q);
          rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
          rce := public.route_min_to(cand, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
          used := durs + jdur + rc;
          if used <= (t->>'cap')::int then
            cost := (rce - basee) + 0.2 * used;
            if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_pos := pos; end if;
          end if;
        end loop;
      end loop;
    end if;
    if best_ti is null then
      -- no room as the stops go: each truck again, its stops in a better order (the truck it was put on first).
      -- The order that ends near the next block only when it fits; else the shortest order inside the block.
      for ti in 0 .. jsonb_array_length(trucks) - 1 loop
        t := trucks->ti; hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision; el := (t->>'elat')::double precision; eg := (t->>'elng')::double precision; durs := (t->>'durs')::int;
        base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        basee := public.route_min_to(t->'stops', pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        cand := public.route_improve((t->'stops') || to_jsonb(jid), (t->>'nfixed')::int, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        if durs + jdur + rc > (t->>'cap')::int and el is not null and eg is not null then
          cand := public.route_improve((t->'stops') || to_jsonb(jid), (t->>'nfixed')::int, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
          rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        end if;
        rce := public.route_min_to(cand, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        used := durs + jdur + rc;
        if used <= (t->>'cap')::int then
          cost := (rce - basee) + 0.2 * used + case when pinned and t->>'id' <> jtruck then 100000 else 0 end;
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

  -- each truck's stops in the order that drives the least (from where it is, toward its next block), then arrival times, drive of each leg, what is left.
  -- Ending near the next block never costs room in this block: when that order no longer fits in the truck's hours,
  -- the shortest order inside the block (it never drives more than the order the stops were put in, which fits).
  for ti in 0 .. jsonb_array_length(trucks) - 1 loop
    hl := (trucks->ti->>'hlat')::double precision; hg := (trucks->ti->>'hlng')::double precision;
    el := (trucks->ti->>'elat')::double precision; eg := (trucks->ti->>'elng')::double precision;
    cand := public.route_improve(trucks->ti->'stops', (trucks->ti->>'nfixed')::int, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
    if el is not null and eg is not null
       and (trucks->ti->>'durs')::int + public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) > (trucks->ti->>'cap')::int then
      cand := public.route_improve(trucks->ti->'stops', (trucks->ti->>'nfixed')::int, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
    end if;
    trucks := jsonb_set(trucks, array[ti::text, 'stops'], cand);
    t := trucks->ti; tm := (t->>'start')::int; plat := hl; plng := hg; k := 0;
    for jid in select jsonb_array_elements_text(t->'stops') loop
      k := k + 1;
      clat := (pts->jid->>'lat')::double precision; clng := (pts->jid->>'lng')::double precision;
      leg := public.drive_min(plat, plng, clat, clng, v_speed, v_detour, v_unknown);
      tm := tm + leg;
      out_jobs := out_jobs || jsonb_build_object(jid, coalesce(out_jobs->jid, '{}'::jsonb) || jsonb_build_object('truck', t->>'id', 'order', k, 'eta', tm, 'travel', leg + ceil(v_stop)::int));
      tm := tm + ceil(v_stop)::int + (pts->jid->>'dur')::int;
      if clat is not null then plat := clat; plng := clng; end if;
    end loop;
    used := (t->>'durs')::int + public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
    trucks := jsonb_set(trucks, array[ti::text], (t - 'nfixed' - 'durs') || jsonb_build_object('used', used, 'left', (t->>'cap')::int - used));
  end loop;

  placed := p_extra is not null and (out_jobs ? (p_extra->>'id'));
  return jsonb_build_object('day', p_day, 'block', p_block, 'trucks', trucks, 'jobs', out_jobs, 'over', over,
    'extra', case when p_extra is null then null else jsonb_build_object('placed', placed, 'truck', out_jobs->(p_extra->>'id')->>'truck', 'eta', out_jobs->(p_extra->>'id')->>'eta') end);
end $$;

-- ---------- one block's plan changed: the other coming blocks of that day follow ----------
-- writes a plan (Part 3), then, in block order, plans again the coming blocks of the same day that have booked
-- appointments: a block before the one that changed may now end elsewhere (near its new first stop), the blocks
-- after it leave from its new last stop, and the one that changed is planned again when a block before it moved
-- (it leaves from somewhere else now). So every block's times count from where its truck really is.
-- A block whose new plan would put a booked appointment in « À placer » stays as it was; a block being booked at
-- the same moment by someone else is left to that booking.
create or replace function public.apply_plan(p_plan jsonb) returns int language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; n int := 0; c int; d date; bk record; p jsonb; v_moved boolean := false;
begin
  perform set_config('garage.rpc', 'on', true);
  for k, v in select * from jsonb_each(coalesce(p_plan->'jobs', '{}')) loop
    if coalesce((v->>'fixed')::boolean, false) then
      update public.jobs set stop_order = (v->>'order')::int, eta_min = (v->>'eta')::int, travel_min = (v->>'travel')::int
      where id = k::uuid and (stop_order, eta_min, travel_min) is distinct from ((v->>'order')::int, (v->>'eta')::int, (v->>'travel')::int);
    else
      update public.jobs set truck_id = (v->>'truck')::uuid, stop_order = (v->>'order')::int, eta_min = (v->>'eta')::int, travel_min = (v->>'travel')::int,
        truck_pinned = truck_pinned and truck_id = (v->>'truck')::uuid
      where id = k::uuid and (truck_id, stop_order, eta_min, travel_min) is distinct from ((v->>'truck')::uuid, (v->>'order')::int, (v->>'eta')::int, (v->>'travel')::int);
    end if;
    get diagnostics c = row_count; n := n + c;
  end loop;
  update public.jobs set truck_id = null, stop_order = null, eta_min = null, travel_min = null, truck_pinned = false
  where id in (select x::uuid from jsonb_array_elements_text(coalesce(p_plan->'over', '[]')) x)
    and (truck_id is not null or stop_order is not null);
  get diagnostics c = row_count; n := n + c;

  d := nullif(p_plan->>'day', '')::date;
  if n > 0 and d is not null and coalesce(current_setting('garage.chain', true), '') <> 'on' then
    perform set_config('garage.chain', 'on', true);
    for bk in select b.key, b.start_min from public.blocks() b order by b.pos loop
      -- the block just written: again only when a block before it now ends elsewhere
      continue when bk.key = p_plan->>'block' and not v_moved;
      continue when d < public.local_today() or (d = public.local_today() and public.now_min() >= bk.start_min);
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
end $$;

-- ---------- many days at once (hours, « Départ des camions », a truck's start) ----------
-- the blocks of each day are planned in block order, each one from the new end of the one before: the chain of
-- apply_plan would only plan them all once more (twice the time for nothing), so it is off while this runs
create or replace function public.replan_days(p_days date[]) returns int language plpgsql security definer set search_path = public as $$
declare d date; b record; n int := 0; v_chain text := coalesce(current_setting('garage.chain', true), '');
begin
  perform set_config('garage.chain', 'on', true);
  foreach d in array p_days loop
    for b in select x.key, x.start_min from public.blocks() x order by x.pos loop
      if d < public.local_today() or (d = public.local_today() and public.now_min() >= b.start_min) then continue; end if;
      if exists (select 1 from public.jobs j where j.day = d and j.block = b.key and j.deleted_at is null and j.status = 'booked') then
        perform public.replan_block(d, b.key); n := n + 1;
      end if;
    end loop;
  end loop;
  perform set_config('garage.chain', v_chain, true);
  return n;
end $$;

-- ---------- a truck's start moves: the coming blocks are planned again (the name alone does not count) ----------
drop trigger if exists trucks_replan on public.trucks;
create trigger trucks_replan after update of active, deleted_at, start on public.trucks for each row
  when (old.active is distinct from new.active or old.deleted_at is distinct from new.deleted_at
        or (old.start->'lat', old.start->'lng') is distinct from (new.start->'lat', new.start->'lng'))
  execute function public.replan_after_hours();

-- ---------- changing a truck's start ----------
-- p_start: {label?, address?, lat, lng}, or null to leave again from « Départ des camions »
create or replace function public.set_truck_start(p_op uuid, p_truck uuid, p_start jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); v jsonb; v_lat double precision; v_lng double precision;
begin
  if v_done is not null then return v_done; end if;
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi.'); end if;
  if not exists (select 1 from public.trucks where id = p_truck and deleted_at is null) then perform public.fail('no_truck', 'Ce camion n’existe plus.'); end if;
  if not public.truck_hours_editable(p_truck) then perform public.fail('not_allowed', 'Tu ne peux pas changer le départ de ce camion. Parle au propriétaire.'); end if;
  if p_start is null or jsonb_typeof(p_start) = 'null' then
    v := null;
  else
    begin
      v_lat := (p_start->>'lat')::double precision; v_lng := (p_start->>'lng')::double precision;
    exception when others then v_lat := null; v_lng := null;
    end;
    if v_lat is null or v_lng is null or abs(v_lat) > 90 or abs(v_lng) > 180 then
      perform public.fail('no_position', 'Cette adresse n’est pas trouvée sur la carte. Choisis-la dans la liste.');
    end if;
    v := jsonb_build_object('label', left(nullif(trim(coalesce(p_start->>'label', '')), ''), 30), 'address', left(nullif(trim(coalesce(p_start->>'address', '')), ''), 200),
      'lat', v_lat, 'lng', v_lng);
  end if;
  update public.trucks set start = v where id = p_truck and start is distinct from v;
  return public.op_save(p_op, 'set_truck_start', jsonb_build_object('ok', true, 'rows', jsonb_build_object(
    'trucks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.trucks t where t.id = p_truck))));
end $$;

-- ---------- the team map: each truck with its start ----------
create or replace function public.team_map(p_day date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare h record;
begin
  if not public.can('map') then perform public.fail('not_allowed', 'Tu n’as pas accès à la carte. Parle au propriétaire.'); end if;
  -- the map shows the day around now; other days are the agenda's business
  if not public.can('agenda') and abs(p_day - public.local_today()) > 1 then perform public.fail('not_allowed', 'La carte montre seulement hier, aujourd’hui et demain.'); end if;
  select * into h from public.home_point();
  return jsonb_build_object(
    'home', jsonb_build_object('lat', h.lat, 'lng', h.lng,
      'label', coalesce((select booking->'home'->>'label' from public.settings where id = 1), 'Centrale'),
      'address', coalesce((select booking->'home'->>'address' from public.settings where id = 1), '8255 av. Mountain Sights, Montréal, QC H4P 2B5')),
    'trucks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color, 'driver_id', t.driver_id,
                 'start', case when t.start is not null then jsonb_build_object('lat', t.start->'lat', 'lng', t.start->'lng',
                   'label', t.start->'label', 'address', t.start->'address') end) order by t.sort, t.name), '[]'::jsonb)
               from public.trucks t where t.deleted_at is null),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'number', j.number, 'truck_id', j.truck_id, 'order', j.stop_order, 'eta_min', j.eta_min,
               'status', j.status, 'block', j.block, 'name', coalesce(nullif(trim(c.first_name), ''), c.company, '—'),
               'address', coalesce(j.address, c.address), 'lat', coalesce(j.lat, c.lat), 'lng', coalesce(j.lng, c.lng)) order by j.block, j.stop_order), '[]'::jsonb)
             from public.jobs j left join public.customers c on c.id = j.customer_id
             where j.day = p_day and j.deleted_at is null and j.status not in ('cancelled','no_show')),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', coalesce(s.short_name, s.full_name), 'color', s.color,
               'lat', p.lat, 'lng', p.lng, 'at', p.at, 'job_id', p.job_id)), '[]'::jsonb)
             from public.positions p join public.staff s on s.id = p.id
             where p.deleted_at is null and p.at > now() - interval '12 hours'
               and exists (select 1 from public.shifts sh where sh.staff_id = s.id and sh.ended_at is null and sh.deleted_at is null)),
    'trips', (select coalesce(jsonb_agg(jsonb_build_object('job_id', t.job_id, 'staff_id', t.staff_id, 'eta_at', t.eta_at, 'km', t.km, 'minutes', t.minutes, 'route', t.route)), '[]'::jsonb)
             from public.trips t where t.status = 'active' and t.expires_at > now()));
end $$;

-- rights: the server's own building block is not callable from the app (Part 13); the operation is
revoke all on function public.truck_home(uuid) from public, anon, authenticated;
grant execute on function public.truck_home(uuid) to service_role;
revoke all on function public.route_min_to(jsonb, jsonb, double precision, double precision, double precision, double precision, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.route_min_to(jsonb, jsonb, double precision, double precision, double precision, double precision, numeric, numeric, numeric, numeric) to service_role;
revoke all on function public.route_improve(jsonb, int, jsonb, double precision, double precision, double precision, double precision, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.route_improve(jsonb, int, jsonb, double precision, double precision, double precision, double precision, numeric, numeric, numeric, numeric) to service_role;
revoke all on function public.set_truck_start(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_truck_start(uuid, uuid, jsonb) to authenticated;
