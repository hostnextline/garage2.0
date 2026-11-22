-- ---------- what an action would do, said before it is done (the app, with the real roads) ----------
-- The phone used to guess these with a straight line or the travel times of another order (« La voiture ferme »: where
-- each moved appointment goes in the other vehicle's day; « Ordre des arrêts »: the arrival times of an order by hand).
-- With the real roads only the server can say it. These two functions do not copy the planner: they RUN the very action
-- (move_job, set_stop_order) inside a block that is always undone at the end (an error raised on purpose, caught at once:
-- PostgreSQL then takes back every row written, every lock taken and every setting changed in that block), and read the
-- result before undoing it. So the answer is the one the action would give, to the minute, switch on or off, and nothing
-- stays: no row, no op_log, no activity, no text to a customer (tests/db/vraies-routes-apercu.test.mjs). The rights are the
-- action's own: it refuses the same person with the same words.

-- move_preview(truck, day, block, jobs): those appointments moved to that vehicle, one after the other, as « La voiture
-- ferme » sends them (move_job for each, that day, that block — or each one's own block when the block is not said — with
-- its window kept: the one promised, else « flexible » as it was). A move the action refuses (the vehicle is full, tire
-- work to the car, …) is listed in « refused » and the others still go (the app asks again without it).
-- p_as_told (fix-sql, the sheets' ask): true = the move « Changer de camion » sends (move_job with 5 arguments: the window
-- kept as move_job keeps it on the same day), so the preview is the very move the tap then makes.
-- → { order: [the vehicle's stops that day, in the order it drives them], eta: { id: minute of arrival }, refused: [ids],
--     refused_why: { id: the refusal's code (block_full, truck_full, needs_truck, block_started, window_full, …) },
--     day_min: its driving that day, day_km: its km (roads on; null while a trip is not measured, and always null with
--     the switch off: never an estimate of km), unmeasured: the trips of that day not measured (roads on; null off) }
-- The locks: the windows switch's (shared, as every booking), then every block the list touches, in the order every planner
-- takes them (day, then morning → evening), before the first move: never a deadlock with roads_replan (verify-on F10)
-- (no « drop function » for the 4-argument form of a first draft of this Part: it never left the test copies, and no DROP
-- is ever sent to live, the owner's rule O-43 / S120)
create or replace function public.move_preview(p_truck uuid, p_day date, p_block text, p_jobs uuid[], p_as_told boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.jobs; v_id uuid; v_refused jsonb := '[]'::jsonb; v_why jsonb := '{}'::jsonb; v_out jsonb; v_done boolean := false; v_hint text;
  v_ws integer; v_flex boolean; v_dd jsonb; v_on boolean := public.roads_on(); bk record;
begin
  -- the action's rule for that vehicle (move_job checks it again for each appointment)
  if not (public.can('book') or coalesce(p_truck = any(public.my_truck_ids()), false)) then
    perform public.fail('not_allowed', 'Tu ne peux pas déplacer ce rendez-vous.');
  end if;
  if p_truck is null or p_day is null or cardinality(coalesce(p_jobs, '{}')) > 60 then
    perform public.fail('bad_list', 'La liste des arrêts n’est pas bonne.');
  end if;
  begin
    perform pg_advisory_xact_lock_shared(hashtext('windows_switch'));
    for bk in select q.d, q.b from (
                select x.day d, x.block b from public.jobs x where x.id = any(coalesce(p_jobs, '{}')) and x.deleted_at is null
                union
                select p_day, coalesce(p_block, x.block) from public.jobs x where x.id = any(coalesce(p_jobs, '{}')) and x.deleted_at is null
              ) q where q.d is not null and q.b is not null
              order by q.d, public.block_pos(q.b), q.b loop
      perform public.lock_block(bk.d, bk.b);
    end loop;
    foreach v_id in array coalesce(p_jobs, '{}') loop
      select * into j from public.jobs x where x.id = v_id;
      -- the window as the app keeps it (keepWindow): a job booked by window keeps the one promised, else stays flexible
      v_ws := case when j.block = 'day' and j.win_start is not null and j.win_end is not null then j.win_start end;
      v_flex := case when j.block = 'day' then v_ws is null and coalesce(j.win_flex, false) end;
      begin
        if coalesce(p_as_told, false) then
          perform public.move_job(null, v_id, p_day, coalesce(p_block, j.block, 'am'), p_truck);
        else
          perform public.move_job(null, v_id, p_day, coalesce(p_block, j.block, 'am'), p_truck, v_ws, v_flex);
        end if;
      exception when sqlstate 'P0001' then
        get stacked diagnostics v_hint = pg_exception_hint;
        if v_hint = 'not_allowed' then raise; end if;          -- no right: the preview is refused as the move would be
        v_refused := v_refused || to_jsonb(v_id);
        v_why := v_why || jsonb_build_object(v_id::text, coalesce(nullif(v_hint, ''), 'refused'));
      end;
    end loop;
    v_dd := public.day_drive(p_day, p_truck);
    v_out := jsonb_build_object('order', v_dd->'ids',
      'eta', coalesce((select jsonb_object_agg(x.id, jj.eta_min) from jsonb_array_elements_text(v_dd->'ids') x(id)
                       left join public.jobs jj on jj.id::text = x.id), '{}'::jsonb),
      'refused', v_refused, 'refused_why', v_why, 'day_min', v_dd->'min',
      'day_km', case when v_on then v_dd->'km' else 'null'::jsonb end,
      'unmeasured', case when v_on then v_dd->'unmeasured' else 'null'::jsonb end);
    v_done := true;
    raise exception 'move_preview: undone' using errcode = 'P0001', hint = 'preview_undone';
  exception when others then
    if not v_done then raise; end if;                          -- a real error (or a refusal of the whole) goes on
  end;
  return v_out;
end $$;

-- stop_order_preview(truck, day, block, jobs): the arrival times that order would give (set_stop_order with that list;
-- an empty list = « Laisser l'app choisir »), nothing written. → [{ id, eta, late }…] = the vehicle's booked stops of that
-- block (its whole day with the arrival windows, or for 'day' asked while the garage books by blocks) in the order they
-- would then be driven; late = arrives after the window promised, else after the block told to the customer; measured (roads
-- on; null off: fix-sql, the sheets' ask) = every trip of the vehicle's day up to that stop has a time measured on the road
-- (from its start, block after block, in the order driven): its arrival time is sure, else it counts the fixed time of a
-- trip not measured yet.
create or replace function public.stop_order_preview(p_truck uuid, p_day date, p_block text, p_jobs uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb; v_done boolean := false; v_wm boolean := public.windows_on(); v_on boolean := public.roads_on(); v_meas jsonb := '{}'::jsonb;
begin
  begin
    perform public.set_stop_order(null, p_truck, p_day, p_block, p_jobs);
    if v_on then
      -- the vehicle's day as it would be driven (as day_drive walks it), each stop sure while every trip up to it is measured
      select coalesce(jsonb_object_agg(w.id, w.ok), '{}'::jsonb) into v_meas
      from (select x.id::text id,
                   bool_and(public.drive_known(coalesce(x.plat, st.lat), coalesce(x.plng, st.lng), x.lat, x.lng)) over (order by x.n) ok
            from (select y.*, lag(y.lat) over (order by y.n) plat, lag(y.lng) over (order by y.n) plng
                  from (select j.id, coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng,
                               row_number() over (order by b.pos, j.stop_order nulls last, j.eta_min nulls last, j.id) n
                        from public.jobs j join public.blocks() b on b.key = j.block left join public.customers c on c.id = j.customer_id
                        where j.truck_id = p_truck and j.day = p_day and j.deleted_at is null and j.status not in ('cancelled', 'no_show')) y) x
            cross join (select coalesce((tr.start->>'lat')::double precision, h.lat) lat, coalesce((tr.start->>'lng')::double precision, h.lng) lng
                        from public.home_point() h left join public.trucks tr on tr.id = p_truck) st) w;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'eta', j.eta_min,
             'late', coalesce(j.eta_min > coalesce(j.win_end, b.end_min), false),
             'measured', case when v_on then coalesce((v_meas->>j.id::text)::boolean, false) end) order by b.pos, j.stop_order, j.eta_min), '[]'::jsonb)
      into v_out
    from public.jobs j join public.blocks() b on b.key = j.block
    where j.truck_id = p_truck and j.day = p_day and j.status = 'booked' and j.deleted_at is null
      and (v_wm or p_block = 'day' or j.block = p_block);
    v_done := true;
    raise exception 'stop_order_preview: undone' using errcode = 'P0001', hint = 'preview_undone';
  exception when others then
    if not v_done then raise; end if;
  end;
  return v_out;
end $$;
