-- Part 3: hours, blocks, and the planner.
-- A customer books a BLOCK (morning 8–12, afternoon 12–16, evening 16–20), never a truck. The server picks the truck
-- and the order of the stops, and checks that the block still has room: job durations + driving between stops must fit
-- in the hours each truck works in that block. Everything here runs in the database, under a lock per block, so two
-- bookings at the same moment (or a booking made offline and sent later) can never overbook a block.

-- ---------- settings helpers ----------
create or replace function public.blocks() returns table(key text, start_min int, end_min int, pos int) language sql stable security definer set search_path = public as $$
  select b->>'key', (b->>'start')::int, (b->>'end')::int, (row_number() over ())::int
  from jsonb_array_elements(coalesce((select s.booking->'blocks' from public.settings s where s.id = 1),
    '[{"key":"am","start":480,"end":720},{"key":"pm","start":720,"end":960},{"key":"eve","start":960,"end":1200}]'::jsonb)) b
$$;
create or replace function public.bset(p_key text, p_default numeric) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select (s.booking->>p_key)::numeric from public.settings s where s.id = 1), p_default)
$$;
create or replace function public.home_point() returns table(lat double precision, lng double precision) language sql stable security definer set search_path = public as $$
  select coalesce((s.booking->'home'->>'lat')::double precision, 45.5005053), coalesce((s.booking->'home'->>'lng')::double precision, -73.6577429)
  from public.settings s where s.id = 1
$$;
create or replace function public.now_min() returns int language sql stable as $$
  select (extract(hour from public.local_now()) * 60 + extract(minute from public.local_now()))::int
$$;

-- ---------- hours ----------
create or replace function public.ranges_norm(p_ranges jsonb) returns jsonb language plpgsql immutable as $$
declare r record; out jsonb := '[]'; cs int; ce int;
begin
  for r in
    select greatest(0, least(1440, (round(((e->>0)::numeric) / 5) * 5)::int)) a, greatest(0, least(1440, (round(((e->>1)::numeric) / 5) * 5)::int)) b
    from jsonb_array_elements(coalesce(p_ranges, '[]')) e
    where jsonb_typeof(e) = 'array' and jsonb_array_length(e) = 2
    order by 1, 2
  loop
    if r.b <= r.a then continue; end if;
    if cs is null then cs := r.a; ce := r.b;
    elsif r.a <= ce then ce := greatest(ce, r.b);
    else out := out || jsonb_build_array(jsonb_build_array(cs, ce)); cs := r.a; ce := r.b;
    end if;
  end loop;
  if cs is not null then out := out || jsonb_build_array(jsonb_build_array(cs, ce)); end if;
  return out;
end $$;
create or replace function public.ranges_norm_trg() returns trigger language plpgsql as $$
begin new.ranges := public.ranges_norm(new.ranges); return new; end $$;
create trigger truck_week_norm before insert or update on public.truck_week for each row execute function public.ranges_norm_trg();
create trigger truck_days_norm before insert or update on public.truck_days for each row execute function public.ranges_norm_trg();

create or replace function public.truck_ranges(p_truck uuid, p_day date) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select d.ranges from public.truck_days d where d.truck_id = p_truck and d.day = p_day and d.deleted_at is null),
    (select w.ranges from public.truck_week w where w.truck_id = p_truck and w.dow = extract(dow from p_day)::int and w.deleted_at is null),
    '[]'::jsonb)
$$;
create or replace function public.ranges_overlap(p_ranges jsonb, a int, b int) returns int language sql immutable as $$
  select coalesce(sum(greatest(0, least((r->>1)::int, b) - greatest((r->>0)::int, a))), 0)::int
  from jsonb_array_elements(coalesce(p_ranges, '[]')) r
$$;
create or replace function public.ranges_first(p_ranges jsonb, a int, b int) returns int language sql immutable as $$
  select min(greatest((r->>0)::int, a)) from jsonb_array_elements(coalesce(p_ranges, '[]')) r
  where least((r->>1)::int, b) > greatest((r->>0)::int, a)
$$;
create or replace function public.ranges_from(p_ranges jsonb, p_from int) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_array(greatest((r->>0)::int, p_from), (r->>1)::int)) filter (where (r->>1)::int > greatest((r->>0)::int, p_from)), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_ranges, '[]')) r
$$;

-- ---------- driving ----------
create or replace function public.km_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) returns double precision language sql immutable as $$
  select 2 * 6371 * asin(least(1, sqrt(power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;
-- minutes to drive between two points: straight line × detour at an average speed; an unknown point counts a fixed time
create or replace function public.drive_min(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision,
  p_speed numeric, p_detour numeric, p_unknown numeric) returns int language sql immutable as $$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then ceil(p_unknown)::int
    else ceil(public.km_between(lat1, lng1, lat2, lng2) * p_detour / greatest(p_speed, 5) * 60)::int end
$$;
-- drive + stop time of a route home → stops (no return leg)
create or replace function public.route_min(p_ids jsonb, p_pts jsonb, p_hlat double precision, p_hlng double precision,
  p_speed numeric, p_detour numeric, p_unknown numeric, p_stop numeric) returns int language plpgsql immutable as $$
declare plat double precision := p_hlat; plng double precision := p_hlng; clat double precision; clng double precision; tot int := 0; id text;
begin
  for id in select jsonb_array_elements_text(coalesce(p_ids, '[]')) loop
    clat := (p_pts->id->>'lat')::double precision; clng := (p_pts->id->>'lng')::double precision;
    tot := tot + public.drive_min(plat, plng, clat, clng, p_speed, p_detour, p_unknown) + ceil(p_stop)::int;
    if clat is not null then plat := clat; plng := clng; end if;
  end loop;
  return tot;
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
     durations + driving fit in the truck's hours. The rest is "over" (« À placer »). */
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
  best_ti int; best_pos int; best_cost numeric; jid text; jdur int; jtruck text; pinned boolean; placed boolean;
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
    best_ti := null; best_cost := null;
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
      over := over || to_jsonb(jid);
    else
      t := trucks->best_ti;
      cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                select x, case when o <= best_pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                union all select to_jsonb(jid), best_pos + 1) q);
      trucks := jsonb_set(trucks, array[best_ti::text, 'stops'], cand);
      trucks := jsonb_set(trucks, array[best_ti::text, 'durs'], to_jsonb(durs_of(cand, pts)));
    end if;
  end loop;

  -- arrival times, drive of each leg, what is left
  for ti in 0 .. jsonb_array_length(trucks) - 1 loop
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

create or replace function public.durs_of(p_ids jsonb, p_pts jsonb) returns int language sql immutable as $$
  select coalesce(sum((p_pts->x->>'dur')::int), 0)::int from jsonb_array_elements_text(coalesce(p_ids, '[]')) x
$$;

-- writes a plan into the jobs (only what changed); jobs that fit nowhere go to « À placer »
create or replace function public.apply_plan(p_plan jsonb) returns int language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; n int := 0; c int;
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
  return n;
end $$;

create or replace function public.lock_block(p_day date, p_block text) returns void language sql as $$
  select pg_advisory_xact_lock(hashtext('block:' || p_day::text || ':' || p_block))
$$;
create or replace function public.block_pos(p_block text) returns int language sql stable as $$
  select coalesce((select x.pos from public.blocks() x where x.key = p_block), 9)
$$;
create or replace function public.lock_two(d1 date, b1 text, d2 date, b2 text) returns void language plpgsql as $$
begin
  if (d1, public.block_pos(b1)) <= (d2, public.block_pos(b2)) then
    perform public.lock_block(d1, b1); if (d1, b1) is distinct from (d2, b2) then perform public.lock_block(d2, b2); end if;
  else
    perform public.lock_block(d2, b2); perform public.lock_block(d1, b1);
  end if;
end $$;

-- re-plans one block now (jobs en route / on site never move); returns the plan
create or replace function public.replan_block(p_day date, p_block text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_plan jsonb;
begin
  perform public.lock_block(p_day, p_block);
  v_plan := public.plan_block(p_day, p_block);
  perform public.apply_plan(v_plan);
  return v_plan;
end $$;

-- after hours change: every coming block with jobs on the given days is re-planned (blocks already started are left alone)
create or replace function public.replan_days(p_days date[]) returns int language plpgsql security definer set search_path = public as $$
declare d date; b record; n int := 0;
begin
  foreach d in array p_days loop
    for b in select x.key, x.start_min from public.blocks() x loop
      if d < public.local_today() or (d = public.local_today() and public.now_min() >= b.start_min) then continue; end if;
      if exists (select 1 from public.jobs j where j.day = d and j.block = b.key and j.deleted_at is null and j.status = 'booked') then
        perform public.replan_block(d, b.key); n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;

create or replace function public.replan_after_hours() returns trigger language plpgsql security definer set search_path = public as $$
declare v_days date[];
begin
  if tg_table_name = 'truck_days' then
    v_days := array[new.day];
  elsif tg_table_name = 'truck_week' then
    select coalesce(array_agg(distinct j.day), '{}') into v_days from public.jobs j
    where j.day >= public.local_today() and extract(dow from j.day)::int = new.dow and j.status = 'booked' and j.deleted_at is null;
  else -- trucks
    select coalesce(array_agg(distinct j.day), '{}') into v_days from public.jobs j
    where j.day >= public.local_today() and j.status = 'booked' and j.deleted_at is null;
  end if;
  perform public.replan_days(v_days);
  perform set_config('garage.rpc', '', true);
  return null;
end $$;
create trigger truck_days_replan after insert or update on public.truck_days for each row execute function public.replan_after_hours();
create trigger truck_week_replan after insert or update on public.truck_week for each row execute function public.replan_after_hours();
create trigger trucks_replan after update of active, deleted_at on public.trucks for each row
  when (old.active is distinct from new.active or old.deleted_at is distinct from new.deleted_at) execute function public.replan_after_hours();

-- ---------- once only ----------
create or replace function public.op_done(p_op uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select result from public.op_log where op = p_op
$$;
create or replace function public.op_save(p_op uuid, p_name text, p_result jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_op is not null then insert into public.op_log(op, name, result) values (p_op, p_name, p_result) on conflict (op) do nothing; end if;
  -- the server operation is over: protected fields are protected again for the rest of the transaction
  perform set_config('garage.rpc', '', true);
  return p_result;
end $$;
create or replace function public.block_rows(p_day date, p_block text) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb) from public.jobs j where j.day = p_day and j.block = p_block and j.deleted_at is null
$$;
create or replace function public.fail(p_code text, p_message text) returns void language plpgsql as $$
begin raise exception using errcode = 'P0001', message = p_message, hint = p_code; end $$;

/* ---------- booking ----------
   book_job(op, job, items): job = {id?, customer_id, vehicle_id?, day, block, duration_min?, truck_id? (puts it on that truck),
   problem?, notes?, address?, unit?, postal_code?, lat?, lng?, card_on_file?, source?, quote_id?}; items = [{…job_items}] */
create or replace function public.book_job(p_op uuid, p_job jsonb, p_items jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb := public.op_done(p_op);
  v_id uuid := coalesce(nullif(p_job->>'id', '')::uuid, gen_random_uuid());
  v_day date := (p_job->>'day')::date;
  v_block text := p_job->>'block';
  v_truck uuid := nullif(p_job->>'truck_id', '')::uuid;
  v_cust uuid := nullif(p_job->>'customer_id', '')::uuid;
  v_lat double precision; v_lng double precision; v_dur int; b record;
  v_plan0 jsonb; v_plan1 jsonb; v_res jsonb; it jsonb; k int := 0;
begin
  if v_done is not null then return v_done; end if;
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi pour réserver.'); end if;
  if not (public.can('book') or (public.has_role('mechanic') and v_truck is not null and v_truck = any(public.my_truck_ids()))) then
    perform public.fail('not_allowed', 'Tu ne peux pas prendre de rendez-vous. Parle au propriétaire.');
  end if;
  if exists (select 1 from public.jobs where id = v_id) then perform public.fail('exists', 'Ce rendez-vous existe déjà.'); end if;
  select * into b from public.blocks() x where x.key = v_block;
  if not found or v_day is null then perform public.fail('bad_block', 'Choisis la date et le bloc : matin, après-midi ou soir.'); end if;
  if v_day < public.local_today() or (v_day = public.local_today() and public.now_min() >= b.start_min) then
    perform public.fail('block_started', 'Ce bloc est déjà commencé : choisis un autre bloc.');
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

  perform public.lock_block(v_day, v_block);
  v_plan0 := public.plan_block(v_day, v_block);
  v_plan1 := public.plan_block(v_day, v_block, jsonb_build_object('id', v_id, 'lat', v_lat, 'lng', v_lng, 'dur', v_dur, 'truck', v_truck));
  if jsonb_array_length(v_plan1->'trucks') = 0 then
    perform public.fail('block_closed', 'Ce bloc est fermé ce jour-là : aucun camion ne travaille.');
  end if;
  if not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o)) then
    perform public.fail('block_full', 'Ce bloc est complet : la route ne rentre plus dans le temps. Choisis un autre bloc.');
  end if;
  if v_truck is not null and (v_plan1->'extra'->>'truck')::uuid is distinct from v_truck then
    perform public.fail('truck_full', 'Ce camion n’a plus de place dans ce bloc. Laisse l’app choisir le camion, ou choisis un autre bloc.');
  end if;

  perform set_config('garage.rpc', 'on', true);
  insert into public.jobs (id, customer_id, vehicle_id, day, block, truck_id, truck_pinned, duration_min, status, problem, notes,
    address, unit, postal_code, lat, lng, card_on_file, source, quote_id, created_by)
  values (v_id, v_cust, nullif(p_job->>'vehicle_id', '')::uuid, v_day, v_block, (v_plan1->'extra'->>'truck')::uuid, v_truck is not null, v_dur, 'booked',
    nullif(p_job->>'problem', ''), nullif(p_job->>'notes', ''), nullif(p_job->>'address', ''), nullif(p_job->>'unit', ''),
    nullif(p_job->>'postal_code', ''), nullif(p_job->>'lat', '')::double precision, nullif(p_job->>'lng', '')::double precision,
    coalesce((p_job->>'card_on_file')::boolean, false), coalesce(nullif(p_job->>'source', ''), 'phone'), nullif(p_job->>'quote_id', '')::uuid, auth.uid());
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
  perform public.apply_plan(v_plan1);

  v_res := jsonb_build_object('ok', true, 'job_id', v_id, 'truck_id', v_plan1->'extra'->>'truck',
    'rows', jsonb_build_object('jobs', public.block_rows(v_day, v_block),
                               'job_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.job_items i where i.job_id = v_id)));
  return public.op_save(p_op, 'book_job', v_res);
end $$;

-- moves a booked job to another day / block (and, optionally, onto a given truck)
create or replace function public.move_job(p_op uuid, p_job uuid, p_day date, p_block text, p_truck uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb := public.op_done(p_op);
  j public.jobs; b record; v_lat double precision; v_lng double precision; v_plan0 jsonb; v_plan1 jsonb; v_res jsonb;
begin
  if v_done is not null then return v_done; end if;
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if not (public.can('book') or (p_truck is not null and p_truck = any(public.my_truck_ids()) and j.truck_id = any(public.my_truck_ids()))) then
    perform public.fail('not_allowed', 'Tu ne peux pas déplacer ce rendez-vous.');
  end if;
  if j.status <> 'booked' then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  select * into b from public.blocks() x where x.key = p_block;
  if not found then perform public.fail('bad_block', 'Bloc inconnu.'); end if;
  if p_day < public.local_today() or (p_day = public.local_today() and public.now_min() >= b.start_min) then
    perform public.fail('block_started', 'Ce bloc est déjà commencé.');
  end if;
  if j.day = p_day and j.block = p_block and p_truck is not distinct from (case when j.truck_pinned then j.truck_id end) then
    return public.op_save(p_op, 'move_job', jsonb_build_object('ok', true, 'unchanged', true, 'rows', jsonb_build_object('jobs', jsonb_build_array(to_jsonb(j)))));
  end if;
  -- the two blocks, always locked in the same order (day, then morning → evening)
  perform public.lock_two(j.day, j.block, p_day, p_block);
  select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into v_lat, v_lng from public.customers c where c.id = j.customer_id;
  v_plan0 := public.plan_block(p_day, p_block, null, j.id);
  v_plan1 := public.plan_block(p_day, p_block, jsonb_build_object('id', j.id, 'lat', v_lat, 'lng', v_lng, 'dur', j.duration_min, 'truck', p_truck), j.id);
  if jsonb_array_length(v_plan1->'trucks') = 0 then perform public.fail('block_closed', 'Ce bloc est fermé ce jour-là.'); end if;
  if not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o)) then
    perform public.fail('block_full', 'Ce bloc est complet : la route ne rentre plus dans le temps.');
  end if;
  if p_truck is not null and (v_plan1->'extra'->>'truck')::uuid is distinct from p_truck then
    perform public.fail('truck_full', 'Ce camion n’a plus de place dans ce bloc.');
  end if;
  perform set_config('garage.rpc', 'on', true);
  update public.jobs set day = p_day, block = p_block, truck_id = (v_plan1->'extra'->>'truck')::uuid, truck_pinned = p_truck is not null,
    confirm_sent_at = case when day <> p_day or block <> p_block then null else confirm_sent_at end
  where id = j.id;
  perform public.apply_plan(v_plan1);
  if j.day <> p_day or j.block <> p_block then perform public.apply_plan(public.plan_block(j.day, j.block)); end if;
  v_res := jsonb_build_object('ok', true, 'job_id', j.id, 'changed', j.day <> p_day or j.block <> p_block,
    'rows', jsonb_build_object('jobs', public.block_rows(p_day, p_block) || case when j.day <> p_day or j.block <> p_block then public.block_rows(j.day, j.block) else '[]'::jsonb end));
  return public.op_save(p_op, 'move_job', v_res);
end $$;

-- the length of a booked job changed (services added…): it must still fit
create or replace function public.set_job_duration(p_op uuid, p_job uuid, p_duration int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); j public.jobs; v_plan jsonb; v_lat double precision; v_lng double precision; v_res jsonb;
begin
  if v_done is not null then return v_done; end if;
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if not (public.can('book') or j.truck_id = any(public.my_truck_ids())) then perform public.fail('not_allowed', 'Tu ne peux pas changer ce rendez-vous.'); end if;
  p_duration := greatest(15, least(720, p_duration));
  perform set_config('garage.rpc', 'on', true);
  if j.status = 'booked' then
    perform public.lock_block(j.day, j.block);
    select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into v_lat, v_lng from public.customers c where c.id = j.customer_id;
    v_plan := public.plan_block(j.day, j.block, jsonb_build_object('id', j.id, 'lat', v_lat, 'lng', v_lng, 'dur', p_duration, 'truck', case when j.truck_pinned then j.truck_id end), j.id);
    if p_duration > j.duration_min and not coalesce((v_plan->'extra'->>'placed')::boolean, false) then
      perform public.fail('block_full', 'Avec cette durée, la job ne rentre plus dans le bloc. Déplace-la ou raccourcis-la.');
    end if;
    update public.jobs set duration_min = p_duration where id = j.id;
    perform public.apply_plan(public.plan_block(j.day, j.block));
  else
    update public.jobs set duration_min = p_duration where id = j.id;
  end if;
  v_res := jsonb_build_object('ok', true, 'rows', jsonb_build_object('jobs', public.block_rows(j.day, j.block)));
  return public.op_save(p_op, 'set_job_duration', v_res);
end $$;

-- the best blocks for a customer: where a truck already goes nearby, as soon as possible
create or replace function public.suggest_blocks(p_lat double precision, p_lng double precision, p_duration int,
  p_from date default null, p_days int default 14, p_exclude uuid default null, p_limit int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date; b record; v_from date := greatest(coalesce(p_from, public.local_today()), public.local_today());
  p0 jsonb; p1 jsonb; out jsonb := '[]'; used0 int; used1 int; near int; v_near numeric := public.bset('near_km', 5);
  x uuid := '00000000-0000-4000-8000-000000000000';
begin
  if not public.is_staff() then return '[]'; end if;
  for d in select generate_series(v_from, v_from + greatest(1, least(p_days, 60)) - 1, interval '1 day')::date loop
    for b in select * from public.blocks() loop
      if d = public.local_today() and public.now_min() >= b.start_min then continue; end if;
      p0 := public.plan_block(d, b.key, null, p_exclude);
      if jsonb_array_length(p0->'trucks') = 0 then continue; end if;
      p1 := public.plan_block(d, b.key, jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', p_duration), p_exclude);
      if not coalesce((p1->'extra'->>'placed')::boolean, false) then continue; end if;
      if exists (select 1 from jsonb_array_elements_text(p1->'over') o where not ((p0->'over') ? o)) then continue; end if;
      select coalesce(sum((t->>'used')::int), 0) into used0 from jsonb_array_elements(p0->'trucks') t;
      select coalesce(sum((t->>'used')::int), 0) into used1 from jsonb_array_elements(p1->'trucks') t;
      select count(*) into near from public.jobs j left join public.customers c on c.id = j.customer_id
        where j.day = d and j.block = b.key and j.deleted_at is null and j.status not in ('cancelled','no_show')
          and (p_exclude is null or j.id <> p_exclude)
          and public.km_between(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)) <= v_near;
      out := out || jsonb_build_array(jsonb_build_object('day', d, 'block', b.key, 'pos', b.pos, 'drive_min', greatest(0, used1 - used0 - p_duration),
        'near', near, 'truck', p1->'extra'->>'truck', 'left', (select max((t->>'left')::int) from jsonb_array_elements(p1->'trucks') t)));
    end loop;
  end loop;
  return coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(out) e
    order by (e->>'drive_min')::int, (e->>'near')::int desc, e->>'day', (e->>'pos')::int limit greatest(1, p_limit)) q), '[]'::jsonb);
end $$;

-- how full each block is, for the agenda (when the device has signal; offline the app estimates it itself)
create or replace function public.blocks_overview(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date; b record; p jsonb; out jsonb := '[]';
begin
  if not public.is_staff() then return '[]'; end if;
  for d in select generate_series(p_from, least(p_to, p_from + 41), interval '1 day')::date loop
    for b in select * from public.blocks() loop
      p := public.plan_block(d, b.key);
      out := out || jsonb_build_array(jsonb_build_object('day', d, 'block', b.key, 'trucks', p->'trucks', 'over', p->'over'));
    end loop;
  end loop;
  return out;
end $$;

-- applies a schedule drawn on the grid: "today only", "for N weeks", or "from now on" (the usual week)
-- p_week: {"0": [[480,720]], "1": […], …} for the days drawn (missing days are not touched)
create or replace function public.apply_hours(p_op uuid, p_truck uuid, p_mode text, p_week jsonb, p_from date, p_weeks int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); d date; k text; v jsonb; n int := 0; v_end date;
begin
  if v_done is not null then return v_done; end if;
  if not public.truck_hours_editable(p_truck) then perform public.fail('not_allowed', 'Tu ne peux pas changer l’horaire de ce camion.'); end if;
  if p_mode not in ('day','weeks','always') then perform public.fail('bad_mode', 'Choisis : aujourd’hui seulement, pendant quelques semaines ou en permanence.'); end if;
  p_from := greatest(coalesce(p_from, public.local_today()), public.local_today());
  if p_mode = 'always' then
    for k, v in select * from jsonb_each(p_week) loop
      insert into public.truck_week (truck_id, dow, ranges) values (p_truck, k::int, v)
      on conflict (truck_id, dow) do update set ranges = excluded.ranges, deleted_at = null;
      -- days changed earlier for the coming weeks give way to the new usual week
      update public.truck_days set deleted_at = now() where truck_id = p_truck and day >= p_from and extract(dow from day)::int = k::int and deleted_at is null;
      n := n + 1;
    end loop;
  else
    v_end := case when p_mode = 'day' then p_from else p_from + (greatest(1, least(p_weeks, 52)) * 7) - 1 end;
    for d in select generate_series(p_from, v_end, interval '1 day')::date loop
      v := p_week -> (extract(dow from d)::int)::text;
      if v is null then continue; end if;
      insert into public.truck_days (truck_id, day, ranges) values (p_truck, d, v)
      on conflict (truck_id, day) do update set ranges = excluded.ranges, deleted_at = null;
      n := n + 1;
    end loop;
  end if;
  return public.op_save(p_op, 'apply_hours', jsonb_build_object('ok', true, 'changed', n));
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema public to service_role;
