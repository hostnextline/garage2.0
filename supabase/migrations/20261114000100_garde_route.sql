-- Part 25 — « Garde-route » : a moment is judged on the truck's whole day, not on its block alone.
--
-- Before: `suggest_core` counted the driving a new appointment adds inside its block only (blind to the blocks after
-- it and to the drive back), and nothing said that a moment was a bad one. So a third stop could be booked at the
-- other end of the island from the two the truck already had that day, without a word.
--
-- Now each moment `suggest_blocks` returns also says, for the whole day (every block, back to the start):
--   add_min / add_km  the driving the appointment adds (all vehicles of the block),
--   day_min           the driving of its vehicle that day, with it,
--   hop_min           the longest drive between it and the customer stop before or after it that day (null: none),
--   stops             the other stops its vehicle already has that day,
--   far               'hop' (hop_min over `booking.max_hop_min`, 35 by default), 'day' (day_min over
--                     `booking.max_day_drive_min`, 105 by default, on a day that already has stops), or null.
-- The moments that are not far come first, then the least driving added over the day. A limit at 0 is switched off.
-- Nothing is refused here: the app warns and asks; `book_job`, `move_job` and `plan_block` are not touched.
-- Online booking (`web_suggest`) never offers a far moment.

-- the driving of one vehicle over one day: its start → its stops, block after block → back to its start.
-- p_plan: the plan of one block (from `plan_block`) taken instead of what is written for that block;
-- p_extra: the appointment being tried in that plan {id, lat, lng}; p_exclude: an appointment left out (being moved).
create or replace function public.day_drive(p_day date, p_truck uuid, p_plan jsonb default null, p_extra jsonb default null, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_speed numeric := public.bset('speed_kmh', 35);
  v_detour numeric := public.bset('detour', 1.3);
  v_unknown numeric := public.bset('unknown_min', 20);
  sl double precision; sg double precision; plat double precision; plng double precision;
  r record; v_min int := 0; v_km numeric := 0; n int := 0; leg int; v_hop int; was_extra boolean := false;
begin
  select coalesce((tr.start->>'lat')::double precision, h.lat), coalesce((tr.start->>'lng')::double precision, h.lng) into sl, sg
  from public.home_point() h left join public.trucks tr on tr.id = p_truck;
  plat := sl; plng := sg;
  for r in
    select q.lat, q.lng, q.extra from (
      -- what is written, outside the block being planned (and its stops the plan does not hold: the ones done)
      select b.pos, coalesce(j.stop_order, 9999) ord, coalesce(j.eta_min, 9999) eta, coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng, false extra
      from public.jobs j join public.blocks() b on b.key = j.block left join public.customers c on c.id = j.customer_id
      where j.day = p_day and j.truck_id = p_truck and j.deleted_at is null and j.status not in ('cancelled', 'no_show')
        and (p_exclude is null or j.id <> p_exclude)
        and (p_plan is null or j.block <> p_plan->>'block' or not (coalesce(p_plan->'jobs', '{}'::jsonb) ? j.id::text))
      union all
      -- the block being planned, in the order of the plan
      select b.pos, coalesce((e.value->>'order')::int, 9999), 9999,
        case when e.key = p_extra->>'id' then (p_extra->>'lat')::double precision else coalesce(j.lat, c.lat) end,
        case when e.key = p_extra->>'id' then (p_extra->>'lng')::double precision else coalesce(j.lng, c.lng) end,
        e.key = coalesce(p_extra->>'id', '')
      from jsonb_each(coalesce(p_plan->'jobs', '{}'::jsonb)) e join public.blocks() b on b.key = p_plan->>'block'
        left join public.jobs j on j.id = e.key::uuid left join public.customers c on c.id = j.customer_id
      where e.value->>'truck' = p_truck::text
    ) q order by q.pos, q.ord, q.eta
  loop
    leg := public.drive_min(plat, plng, r.lat, r.lng, v_speed, v_detour, v_unknown);
    v_min := v_min + leg;
    if r.lat is not null and r.lng is not null and plat is not null and plng is not null then
      v_km := v_km + public.km_between(plat, plng, r.lat, r.lng) * v_detour;
    end if;
    -- the drive between the appointment tried and the customer before it, then the customer after it
    if n > 0 and r.lat is not null and (r.extra or was_extra) then v_hop := greatest(coalesce(v_hop, 0), leg); end if;
    was_extra := r.extra and r.lat is not null;
    if r.lat is not null and r.lng is not null then plat := r.lat; plng := r.lng; end if;
    n := n + 1;
  end loop;
  if n > 0 then
    v_min := v_min + public.drive_min(plat, plng, sl, sg, v_speed, v_detour, v_unknown);
    if plat is not null and sl is not null then v_km := v_km + public.km_between(plat, plng, sl, sg) * v_detour; end if;
  end if;
  return jsonb_build_object('min', v_min, 'km', round(v_km, 1), 'stops', n, 'hop', v_hop);
end $$;

revoke all on function public.day_drive(date, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.day_drive(date, uuid, jsonb, jsonb, uuid) to service_role;

create or replace function public.suggest_core(p_lat double precision, p_lng double precision, p_duration int,
  p_from date default null, p_days int default 14, p_exclude uuid default null, p_limit int default 6,
  p_need boolean default false, p_kind text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date; b record; v_from date := greatest(coalesce(p_from, public.local_today()), public.local_today());
  p0 jsonb; p1 jsonb; out jsonb := '[]'; used0 int; used1 int; near int; v_near numeric := public.bset('near_km', 5);
  x uuid := '00000000-0000-4000-8000-000000000000';
  -- the vehicle: what the work needs and what the person chose; moving a job, what the job already says
  v_need boolean := coalesce(p_need, false) or coalesce((select j.needs_machine from public.jobs j where j.id = p_exclude), false);
  v_kind text := coalesce(case when p_kind in ('car', 'truck') then p_kind end, (select j.vehicle_kind from public.jobs j where j.id = p_exclude));
  -- the whole day (Part 25)
  v_maxhop numeric := public.bset('max_hop_min', 35);
  v_maxday numeric := public.bset('max_day_drive_min', 105);
  v_x jsonb := jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng);
  tk record; w0 jsonb; w1 jsonb; v_truck text; min0 int; min1 int; km0 numeric; km1 numeric; v_day int; v_hop int; v_stops int; v_far text;
begin
  for d in select generate_series(v_from, v_from + greatest(1, least(p_days, 60)) - 1, interval '1 day')::date loop
    for b in select * from public.blocks() loop
      if d = public.local_today() and public.now_min() >= b.start_min then continue; end if;
      p0 := public.plan_block(d, b.key, null, p_exclude);
      if jsonb_array_length(p0->'trucks') = 0 then continue; end if;
      p1 := public.plan_block(d, b.key, jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', p_duration, 'need', v_need, 'kind', v_kind), p_exclude);
      if not coalesce((p1->'extra'->>'placed')::boolean, false) then continue; end if;
      if exists (select 1 from jsonb_array_elements_text(p1->'over') o where not ((p0->'over') ? o)) then continue; end if;
      -- the truck it goes on must stay inside its hours (as book_job asks)
      if exists (select 1 from jsonb_array_elements(p1->'trucks') t where t->>'id' = p1->'extra'->>'truck' and (t->>'left')::int < 0) then continue; end if;
      select coalesce(sum((t->>'used')::int), 0) into used0 from jsonb_array_elements(p0->'trucks') t;
      select coalesce(sum((t->>'used')::int), 0) into used1 from jsonb_array_elements(p1->'trucks') t;
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
      out := out || jsonb_build_array(jsonb_build_object('day', d, 'block', b.key, 'pos', b.pos, 'drive_min', greatest(0, used1 - used0 - p_duration),
        'near', near, 'truck', v_truck, 'left', (select max((t->>'left')::int) from jsonb_array_elements(p1->'trucks') t),
        'add_min', greatest(0, min1 - min0), 'add_km', greatest(0, round(km1 - km0, 1)), 'day_min', v_day, 'hop_min', v_hop, 'stops', v_stops, 'far', v_far));
    end loop;
  end loop;
  return coalesce((select jsonb_agg(e order by o) from (select e, row_number() over (
      order by (e->>'far' is not null), (e->>'add_min')::int, (e->>'near')::int desc, e->>'day', (e->>'pos')::int) o
    from jsonb_array_elements(out) e) q where o <= greatest(1, p_limit)), '[]'::jsonb);
end $$;

-- online booking: never a far moment
create or replace function public.web_suggest(p_lat double precision, p_lng double precision, p_services uuid[],
  p_from date default null, p_days int default 14, p_limit int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_horizon int := public.bset('horizon_days', 120)::int; v_from date := greatest(coalesce(p_from, public.local_today()), public.local_today());
  v_out jsonb;
begin
  if not public.web_on() then perform public.fail('web_off', 'La réservation en ligne est fermée pour le moment. Appelez le garage.'); end if;
  if not public.web_in_area(p_lat, p_lng) then perform public.fail('far', 'Cette adresse est en dehors de notre secteur. Appelez le garage.'); end if;
  if coalesce(cardinality(p_services), 0) = 0 then perform public.fail('no_service', 'Choisissez au moins un service.'); end if;
  if v_from > public.local_today() + v_horizon then return '[]'::jsonb; end if;
  -- at most 14 days per call: each day costs up to six plans
  v_out := public.suggest_core(p_lat, p_lng, public.web_duration(p_services), v_from,
    least(greatest(1, p_days), 14, v_horizon - (v_from - public.local_today()) + 1), null, least(greatest(1, p_limit), 12),
    exists (select 1 from public.services sv where sv.id = any(p_services) and sv.needs_machine));
  return coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(v_out) with ordinality q(e, o) where e->>'far' is null), '[]'::jsonb);
end $$;
