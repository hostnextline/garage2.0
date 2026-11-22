-- Part 29 — Réorganiser : l'arrêt glissé garde l'heure de sa place, les autres gardent la leur (Hassan, 2026-11-22 : « when
-- re-arranging the day, if i move an appointement down, i need it to change its hour, and accept the appointement where i
-- put it without moving all the others arround »)
--
-- The law: STATE.md 2026-11-22 10:35, G1–G7; the repro and the exact change: reports/drag-keeps-spec.md (the work folder).
-- Part 28 (20261122000100_reorganiser.sql) and Part 27 (20261119000200_vraies_routes.sql) are LIVE: their files are not
-- touched. This file only makes again, from their LATEST text (copied, then changed where it says « Part 29 »; plus one
-- new helper, plan_breaks):
--   day_order_core     G1 a stop he drags takes the hour of the place he put it and that minute is pointed (arrive_at, the
--                      exact move's pin; truck_pinned): later plans hold it there. G2 the stops he did not drag keep their
--                      hour: held to their minute, else never before their arrival now nor their window; pushed later only
--                      when a dragged stop truly takes their time (warn first as before). G3 never refused for lateness,
--                      never re-sorted. G5 the dragged stop's window: the one it has when it holds the new hour (D1), else
--                      the window of that hour (win_for), shown before saving, due on the day's button, no text by itself.
--                      F4 a « new window » equal to the one it has is no new window. D2 a minute already passed that the
--                      save does not make later is pointed again at the arrival (not lost). D5 a flexible stop he drags gets
--                      its window at the save. The answer: per stop pin_new, pin_was; accept.at = { id: minute } (warn
--                      first: the same minute, as windows); the activity day_ordered: pinned.
--   replan_block_safe  G4 the guard: a plan that makes late someone the stored day serves on time (window or minute), or
--   roads_replan       makes a minute already passed later still, is not written: the stored routes are kept and walked
--                      again (a tight day, where the planner of Part 27 breaks the minutes pointed; spec §3 F5). Today too.
--   plan_breaks        (new) that test, in one place.
--   plan_route         the reviews' F1: every OTHER plan of the whole day (a booking and « Réserver quand même », a move, a
--   plan_route_core    length, the hours) went through the same planner: window mode, a vehicle whose stored day the plan
--                      would break is now frozen (Part 27's frozen vehicle, roads off too: its stops stay in their order,
--                      walked again; nothing new on it but « quand même », at its end), the other vehicle planned around.
--                      A day with room: the planner's answer as before. Also F7 (a minute pointed walked up to 5 minutes
--                      later than shown is accepted, today's clock) and F8 (an arrival not measured is pointed only inside
--                      the window the stop has).
-- day_order_preview / day_order_save keep their text (the same signature of the core). « create or replace » only: no
-- drop, no delete, no truncate, no row written; applied twice, the same functions and grants. The rights do not change
-- (each re-stated below: the server's own).

create or replace function public.day_order_core(p_day date, p_lists jsonb, p_moved uuid[], p_was jsonb, p_auto boolean,
  p_accept jsonb, p_check boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_wm boolean; v_on boolean; v_today date; v_book boolean; v_rewin boolean; v_lock boolean;
  v_auto boolean := coalesce(p_auto, false); v_accept_in jsonb := coalesce(p_accept, '{}'::jsonb);
  v_stop int := ceil(public.bset('stop_min', 5))::int;
  v_moved uuid[]; v_trucks uuid[]; v_l jsonb := '[]'::jsonb; v_entries jsonb := '[]'::jsonb; v_lists jsonb;
  v_all uuid[]; v_locked uuid[]; v_meant uuid[]; v_got uuid[]; v_missing jsonb; v_extra jsonb;
  v_gone jsonb; v_new jsonb; v_changed jsonb; v_by jsonb; v_before jsonb; v_plan jsonb; v_hold jsonb;
  v_stops jsonb := '[]'::jsonb; v_tsum jsonb := '[]'::jsonb; v_res jsonb; v_bad boolean := false;
  a_windows jsonb := '{}'::jsonb; a_flex jsonb := '{}'::jsonb; a_late jsonb := '{}'::jsonb; a_early jsonb := '{}'::jsonb;
  a_pins jsonb := '{}'::jsonb; a_over jsonb := '{}'::jsonb; v_accept jsonb;
  v_wins jsonb := '{}'::jsonb; v_back uuid[] := '{}'; v_lost uuid[] := '{}'; v_hand uuid[] := '{}'; v_late_ids uuid[] := '{}';
  v_early_ids uuid[] := '{}'; v_over_ids uuid[] := '{}'; v_due int; v_unplaced uuid[] := '{}';
  v_ends jsonb := '{}'::jsonb; v_tk uuid; v_name text; v_nm text; v_x jsonb; v_k text; v_v jsonb; v_n int;
  b record; r record; t record; w record;
  v_sure boolean; v_hend int; v_ts int; v_te int; v_mv boolean; v_bf jsonb; v_nws int; v_nwe int; v_wback boolean;
  v_ffix boolean; v_flater boolean; v_late int; v_early int; v_plost int; v_pmoved boolean; v_fin int;
  -- Part 29: the minutes this save points (G1: a stop he dragged; D2: a minute already late that this save does not make later)
  a_at jsonb := '{}'::jsonb; v_pdrag uuid[] := '{}'; v_at int; v_pnew boolean; v_pwas int;
begin
  -- 1. the modes, under the switch's shared lock (taken first, as every planner: the mode read here is the one the whole
  --    transaction keeps)
  perform pg_advisory_xact_lock_shared(hashtext('windows_switch'));
  v_wm := public.windows_on(); v_on := public.roads_on(); v_today := public.local_today();
  v_book := public.is_owner() or public.can('book');
  -- a save by someone without « Réserver » (a mechanic on his own truck) never re-cuts a window
  v_rewin := public.day_rewin_on() and v_book;
  v_lock := public.win_lock_due(p_day);
  v_moved := array(select distinct x from unnest(coalesce(p_moved, '{}'::uuid[])) x where x is not null);

  -- 2. the checks
  if p_day is null then perform public.fail('bad_block', 'Bloc inconnu.'); end if;
  if p_day < v_today then perform public.fail('past', 'Cette journée est passée.'); end if;
  if p_lists is null or jsonb_typeof(p_lists) = 'null' then
    if not (v_auto and not coalesce(p_check, false)) then perform public.fail('bad_list', 'La liste des arrêts n’est pas bonne.'); end if;
    v_lists := null;
  else
    if jsonb_typeof(p_lists) <> 'array' or jsonb_array_length(p_lists) > 200
       or exists (select 1 from jsonb_array_elements(p_lists) e
                  where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'truck') is distinct from 'string' or (e->>'truck') !~ v_re
                     or jsonb_typeof(e->'block') is distinct from 'string' or jsonb_typeof(e->'jobs') is distinct from 'array')
       or exists (select 1 from jsonb_array_elements(p_lists) e cross join lateral jsonb_array_elements(e->'jobs') x
                  where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ v_re) then
      perform public.fail('bad_list', 'La liste des arrêts n’est pas bonne.');
    end if;
    if exists (select 1 from jsonb_array_elements(p_lists) e where not exists (select 1 from public.blocks() x where x.key = e->>'block')) then
      perform public.fail('bad_block', 'Bloc inconnu.');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', lower(x.v), 'truck', lower(e.v->>'truck'), 'block', e.v->>'block', 'pos', x.o::int)
                              order by e.o, x.o), '[]'::jsonb) into v_l
    from jsonb_array_elements(p_lists) with ordinality e(v, o)
    cross join lateral jsonb_array_elements_text(e.v->'jobs') with ordinality x(v, o);
    if jsonb_array_length(v_l) > 200
       or (select count(distinct l->>'id') from jsonb_array_elements(v_l) l) <> jsonb_array_length(v_l)
       or (select count(distinct lower(e->>'truck') || '|' || (e->>'block')) from jsonb_array_elements(p_lists) e) <> jsonb_array_length(p_lists) then
      perform public.fail('bad_list', 'La liste des arrêts n’est pas bonne.');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('truck', lower(e->>'truck'), 'block', e->>'block') order by o), '[]'::jsonb) into v_entries
    from jsonb_array_elements(p_lists) with ordinality q(e, o);
    v_lists := p_lists;
  end if;

  -- 3. the rights (set_stop_order's rule and words for the order; moving a stop to another truck, or the app's order:
  --    the owner and « Réserver » only)
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi.'); end if;
  if v_lists is null then
    -- « Laisser l'app choisir » asked as a preview: every active truck that works that day, or holds a booked stop of it
    v_trucks := array(select t0.id from public.trucks t0
                      where (t0.active and t0.deleted_at is null and jsonb_array_length(coalesce(public.truck_ranges(t0.id, p_day), '[]'::jsonb)) > 0)
                         or exists (select 1 from public.jobs j where j.truck_id = t0.id and j.day = p_day and j.status = 'booked' and j.deleted_at is null)
                      order by t0.sort nulls last, t0.name, t0.id);
  else
    v_trucks := array(select distinct (e->>'truck')::uuid from jsonb_array_elements(v_entries) e);
  end if;
  if not v_book then
    if exists (select 1 from unnest(v_trucks) x where not coalesce(x = any(public.my_truck_ids()), false)) then
      perform public.fail('not_allowed', 'Tu ne peux pas changer l’ordre de ce camion. Parle au propriétaire.');
    end if;
    if v_auto or exists (select 1 from jsonb_array_elements(v_l) l join public.jobs j on j.id = (l->>'id')::uuid
                         where j.truck_id is distinct from (l->>'truck')::uuid) then
      perform public.fail('not_allowed', 'Seuls le propriétaire et le bureau changent un arrêt de camion.');
    end if;
  end if;

  -- 4. the locks, before any read that decides: every block of that day in the planners' order (lock_two). The preview
  --    gives up on a job's ROW another action holds (lock_timeout, set only now: it still waits its turn for the blocks)
  for b in select x.key from public.blocks() x order by x.pos loop
    perform public.lock_block(p_day, b.key);
  end loop;
  if not coalesce(p_check, false) then perform set_config('lock_timeout', '500ms', true); end if;

  -- 5. the basis: the day as the draft was built from (the save never works without it: a silent overwrite)
  if coalesce(p_check, false) and (p_was is null or jsonb_typeof(p_was) is distinct from 'object') then
    perform public.fail('bad_list', 'La liste des arrêts n’est pas bonne.');
  end if;
  if p_was is not null and jsonb_typeof(p_was) = 'object' then
    with cur as (select j.id::text k, jsonb_build_array(j.truck_id, j.block, j.stop_order, j.win_start, j.win_end, j.arrive_at, j.status) v
                 from public.jobs j
                 where j.day = p_day and j.truck_id = any(v_trucks) and j.deleted_at is null and j.status in ('booked', 'en_route', 'on_site')),
         was as (select lower(e.key) k, e.value v from jsonb_each(p_was) e)
    select coalesce((select jsonb_agg(was.k order by was.k) from was where not exists (select 1 from cur where cur.k = was.k)), '[]'::jsonb),
           coalesce((select jsonb_agg(cur.k order by cur.k) from cur where not exists (select 1 from was where was.k = cur.k)), '[]'::jsonb),
           coalesce((select jsonb_agg(cur.k order by cur.k) from cur join was on was.k = cur.k where was.v is distinct from cur.v), '[]'::jsonb)
      into v_gone, v_new, v_changed;
    if jsonb_array_length(v_gone) + jsonb_array_length(v_new) + jsonb_array_length(v_changed) > 0 then
      -- who saved this day meanwhile (another person, the last 30 minutes): the screen names him
      select jsonb_build_object('name', coalesce(nullif(btrim(s.short_name), ''), s.full_name)) into v_by
      from public.activity a join public.staff s on s.id = a.actor
      where a.entity = 'day' and a.action = 'day_ordered' and a.data->>'day' = p_day::text
        and a.actor is distinct from auth.uid() and a.at > now() - interval '30 minutes'
      order by a.at desc, a.id desc limit 1;
      if not coalesce(p_check, false) then
        return jsonb_build_object('ok', true, 'day', p_day, 'basis_ok', false, 'gone', v_gone, 'new', v_new, 'changed', v_changed, 'by', v_by);
      end if;
      raise exception using errcode = 'P0001', hint = 'day_changed',
        message = 'La journée a changé pendant que tu la réorganisais : je l’ai rechargée. Regarde, puis enregistre de nouveau.',
        detail = jsonb_build_object('gone', v_gone, 'new', v_new, 'changed', v_changed, 'by', v_by)::text;
    end if;
  end if;

  -- 6. before: every booked stop of the listed trucks that day, as it is
  select coalesce(jsonb_object_agg(j.id::text, jsonb_build_object('truck', j.truck_id, 'order', j.stop_order, 'eta', j.eta_min,
           'ws', j.win_start, 'we', j.win_end, 'at', j.arrive_at, 'block', j.block)), '{}'::jsonb) into v_before
  from public.jobs j where j.day = p_day and j.truck_id = any(v_trucks) and j.status = 'booked' and j.deleted_at is null;

  -- 7. « Laisser l'app choisir »: the order and the minutes pointed of that day forgotten (forced kept); asked as a preview,
  --    the planner's own plan of each block becomes the lists (a save never plans: it saves the lists the preview showed)
  perform set_config('garage.rpc', 'on', true);
  if v_auto then
    update public.jobs set manual_order = null, truck_pinned = false, arrive_at = null
    where day = p_day and truck_id = any(v_trucks) and status = 'booked' and deleted_at is null
      and (manual_order is not null or truck_pinned or arrive_at is not null);
    if v_lists is null then
      for b in select x.key from public.blocks() x order by x.pos loop
        v_plan := public.plan_block(p_day, b.key);
        -- the plan's vehicles, in the order of the trucks shown
        for t in select (q->>'id')::uuid id, q->'stops' stops from jsonb_array_elements(coalesce(v_plan->'trucks', '[]'::jsonb)) q loop
          if not (t.id = any(v_trucks)) then v_trucks := v_trucks || t.id; end if;
          select v_l || coalesce(jsonb_agg(jsonb_build_object('id', j.id::text, 'truck', t.id::text, 'block', b.key, 'pos', s.o::int) order by s.o), '[]'::jsonb)
            into v_l
          from jsonb_array_elements_text(t.stops) with ordinality s(id, o)
          join public.jobs j on j.id = s.id::uuid
          where j.status = 'booked' and j.deleted_at is null and j.day = p_day and j.block = b.key and j.truck_id is not null
            and not exists (select 1 from jsonb_array_elements(v_l) l where l->>'id' = j.id::text);
        end loop;
        -- what the plan could not place (and anything it left out) stays at the end of its own truck, judged late below
        select v_l || coalesce(jsonb_agg(jsonb_build_object('id', j.id::text, 'truck', j.truck_id::text, 'block', b.key, 'pos', 1000 + j.n) order by j.n), '[]'::jsonb)
          into v_l
        from (select j0.*, row_number() over (order by j0.stop_order nulls last, j0.eta_min nulls last, j0.id) n
              from public.jobs j0
              where j0.day = p_day and j0.block = b.key and j0.truck_id = any(v_trucks) and j0.status = 'booked' and j0.deleted_at is null
                and not exists (select 1 from jsonb_array_elements(v_l) l where l->>'id' = j0.id::text)) j;
        -- (the screen names them: « L'app ne trouve pas de place pour … », the stop's `over`)
        v_unplaced := v_unplaced || array(select (l->>'id')::uuid from jsonb_array_elements(v_l) l where l->>'block' = b.key and (l->>'pos')::int > 1000);
        select v_entries || coalesce(jsonb_agg(jsonb_build_object('truck', x::text, 'block', b.key) order by o), '[]'::jsonb) into v_entries
        from unnest(v_trucks) with ordinality u(x, o);
      end loop;
      -- positions 1, 2, … in each list
      select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'truck', q.truck, 'block', q.blk, 'pos', q.rn) order by q.truck, q.blk, q.rn), '[]'::jsonb)
        into v_l
      from (select l->>'id' id, l->>'truck' truck, l->>'block' blk,
                   row_number() over (partition by l->>'truck', l->>'block' order by (l->>'pos')::int) rn
            from jsonb_array_elements(v_l) l) q;
    end if;
  end if;
  v_all := array(select (l->>'id')::uuid from jsonb_array_elements(v_l) l);

  -- 8. coverage: every booked stop of a listed (truck, block) is listed in that block; every listed id is a booked stop of
  --    that day, of that block, now on one of that block's listed trucks (a stop « À placer » is never listed)
  select coalesce(jsonb_agg(j.id::text order by j.id), '[]'::jsonb) into v_missing
  from public.jobs j
  where j.day = p_day and j.status = 'booked' and j.deleted_at is null
    and exists (select 1 from jsonb_array_elements(v_entries) e where (e->>'truck')::uuid = j.truck_id and e->>'block' = j.block)
    and not exists (select 1 from jsonb_array_elements(v_l) l where (l->>'id')::uuid = j.id and l->>'block' = j.block);
  select coalesce(jsonb_agg(l->>'id' order by l->>'id'), '[]'::jsonb) into v_extra
  from jsonb_array_elements(v_l) l
  where not exists (select 1 from public.jobs j
                    where j.id = (l->>'id')::uuid and j.day = p_day and j.block = l->>'block' and j.status = 'booked' and j.deleted_at is null
                      and exists (select 1 from jsonb_array_elements(v_entries) e where (e->>'truck')::uuid = j.truck_id and e->>'block' = j.block));
  if jsonb_array_length(v_missing) + jsonb_array_length(v_extra) > 0 then
    raise exception using errcode = 'P0001', hint = 'changed',
      message = 'Un rendez-vous de cette journée a changé (parti, fini, déplacé ou nouveau). Rouvre la journée.',
      detail = jsonb_build_object('missing', v_missing, 'extra', v_extra)::text;
  end if;

  -- 9. the targets: a stop put on ANOTHER truck that does not work that block; tire work on the car
  for t in select (l->>'truck')::uuid id, l->>'block' blk, jsonb_agg(l->>'id' order by l->>'id') jobs
           from jsonb_array_elements(v_l) l join public.jobs j on j.id = (l->>'id')::uuid
           where j.truck_id is distinct from (l->>'truck')::uuid
           group by 1, 2 order by 1, 2 loop
    if not public.exact_works(t.id, p_day, t.blk) then
      select tr.name into v_name from public.trucks tr where tr.id = t.id;
      raise exception using errcode = 'P0001', hint = 'truck_off',
        message = format('%s ne travaille pas ce jour-là.', coalesce(v_name, 'Ce camion')),
        detail = jsonb_build_object('truck', t.id, 'jobs', t.jobs)::text;
    end if;
  end loop;
  select jsonb_agg(l->>'id' order by l->>'id') into v_x
  from jsonb_array_elements(v_l) l join public.jobs j on j.id = (l->>'id')::uuid join public.trucks tr on tr.id = (l->>'truck')::uuid
  -- only a stop PUT there (§1.4 step 9): tire work the planner left on the Voiture, nobody moving it, never blocks the day
  where j.needs_machine and not tr.tire_machine and j.truck_id is distinct from (l->>'truck')::uuid;
  if v_x is not null then
    raise exception using errcode = 'P0001', hint = 'needs_truck',
      message = 'Ce travail demande le camion (montage ou balancement des pneus) : la voiture ne peut pas le faire.',
      detail = jsonb_build_object('jobs', v_x)::text;
  end if;

  -- 10 – 12. the writes. Every listed stop is taken first, still booked (« Je pars » takes only the job's row, not the
  -- block: a save must never move a stop that just left); every write then carries the same guard and checks its count.
  -- Any difference: « changed », everything undone, the screen rebases
  v_locked := array(select q.id from (select j.id from public.jobs j
                                      where j.id = any(v_all) and j.status = 'booked' and j.deleted_at is null
                                      order by j.id for update) q);
  if cardinality(v_locked) <> cardinality(v_all) then
    raise exception using errcode = 'P0001', hint = 'changed',
      message = 'Un rendez-vous de cette journée a changé (parti, fini, déplacé ou nouveau). Rouvre la journée.',
      detail = jsonb_build_object('missing', to_jsonb(array(select x from unnest(v_all) x where not (x = any(v_locked)) order by x)), 'extra', '[]'::jsonb)::text;
  end if;
  -- 10. the trucks first (jobs_manual_order_reset and jobs_kind_follow fire on it)
  v_meant := array(select j.id from jsonb_array_elements(v_l) l join public.jobs j on j.id = (l->>'id')::uuid
                   where j.truck_id is distinct from (l->>'truck')::uuid order by j.id);
  with u as (update public.jobs j set truck_id = (l->>'truck')::uuid, truck_pinned = not v_auto
             from jsonb_array_elements(v_l) l
             where j.id = (l->>'id')::uuid and j.truck_id is distinct from (l->>'truck')::uuid and j.status = 'booked' and j.deleted_at is null
             returning j.id)
  select array(select u.id from u order by u.id) into v_got;
  if v_got is distinct from v_meant then
    raise exception using errcode = 'P0001', hint = 'changed',
      message = 'Un rendez-vous de cette journée a changé (parti, fini, déplacé ou nouveau). Rouvre la journée.',
      detail = jsonb_build_object('missing', to_jsonb(array(select x from unnest(v_meant) x where not (x = any(v_got)) order by x)))::text;
  end if;
  -- 11. the orders: after the stops done or under way of that truck and block; NO order by hand is written (choice C1)
  with base as (select (e->>'truck')::uuid tk, e->>'block' blk,
                       coalesce((select max(j.stop_order) from public.jobs j where j.truck_id = (e->>'truck')::uuid and j.day = p_day
                                 and j.block = e->>'block' and j.deleted_at is null and j.status in ('en_route', 'on_site', 'done')), 0) n0
                from jsonb_array_elements(v_entries) e),
       want as (select (l->>'id')::uuid id, base.n0 + (l->>'pos')::int so from jsonb_array_elements(v_l) l
                join base on base.tk = (l->>'truck')::uuid and base.blk = l->>'block')
  select array(select want.id from want join public.jobs j on j.id = want.id
               where (j.stop_order, j.manual_order) is distinct from (want.so, null::int) order by want.id) into v_meant;
  with base as (select (e->>'truck')::uuid tk, e->>'block' blk,
                       coalesce((select max(j.stop_order) from public.jobs j where j.truck_id = (e->>'truck')::uuid and j.day = p_day
                                 and j.block = e->>'block' and j.deleted_at is null and j.status in ('en_route', 'on_site', 'done')), 0) n0
                from jsonb_array_elements(v_entries) e),
       want as (select (l->>'id')::uuid id, base.n0 + (l->>'pos')::int so from jsonb_array_elements(v_l) l
                join base on base.tk = (l->>'truck')::uuid and base.blk = l->>'block'),
       u as (update public.jobs j set stop_order = want.so, manual_order = null from want
             where j.id = want.id and (j.stop_order, j.manual_order) is distinct from (want.so, null::int)
               and j.status = 'booked' and j.deleted_at is null
             returning j.id)
  select array(select u.id from u order by u.id) into v_got;
  if v_got is distinct from v_meant then
    raise exception using errcode = 'P0001', hint = 'changed',
      message = 'Un rendez-vous de cette journée a changé (parti, fini, déplacé ou nouveau). Rouvre la journée.',
      detail = jsonb_build_object('missing', to_jsonb(array(select x from unnest(v_meant) x where not (x = any(v_got)) order by x)))::text;
  end if;
  -- 12. the stops he moved lose their minute pointed (as every move: forced too)
  v_meant := array(select j.id from public.jobs j where j.id = any(v_moved) and j.id = any(v_all) and (j.arrive_at is not null or j.forced) order by j.id);
  with u as (update public.jobs j set arrive_at = null, forced = false
             where j.id = any(v_meant) and j.status = 'booked' and j.deleted_at is null returning j.id)
  select array(select u.id from u order by u.id) into v_got;
  if v_got is distinct from v_meant then
    raise exception using errcode = 'P0001', hint = 'changed',
      message = 'Un rendez-vous de cette journée a changé (parti, fini, déplacé ou nouveau). Rouvre la journée.',
      detail = jsonb_build_object('missing', to_jsonb(array(select x from unnest(v_meant) x where not (x = any(v_got)) order by x)))::text;
  end if;

  -- 13. the walk (the planner's walk, route_hold). Part 29 (Hassan, 2026-11-22, G1 / G2): a stop he moved waits for
  --     nothing: it takes the hour of the place he put it (right after the stop before it, its end + the drive). A stop he
  --     did NOT move keeps its hour: held to its minute pointed (back to it when the drag frees the time), else never
  --     before its arrival now (step 6) nor before its window — « quand même » ones too, flexible ones too, both modes.
  --     Pushed later only when a dragged stop truly takes its time; never pulled earlier (Part 28's pull-back to the
  --     window he was TOLD, days F1, is gone: he stays owed that window, for the day's button). « Laisser l'app choisir »
  --     (an auto draft): the app's order, Part 28's hold as it was (minute, else the told start when earlier, else the
  --     window). A stop with neither an arrival nor a window (never walked, flexible): route_hold's own rule
  select coalesce(jsonb_object_agg(q.id::text, q.h) filter (where q.h is not null), '{}'::jsonb) into v_hold
  from (select j.id,
               case when j.id = any(v_moved) then 0
                    when v_auto then
                      case when v_wm and j.win_start is not null then
                        coalesce(j.arrive_at,
                                 case when v_rewin and j.told_day = p_day and j.told_start is not null
                                           and j.told_start < j.win_start then j.told_start end,
                                 j.win_start) end
                    when v_wm and j.arrive_at is not null then j.arrive_at
                    when (v_before->(j.id::text)->>'eta') is null and not (v_wm and j.win_start is not null) then null
                    else greatest(coalesce((v_before->(j.id::text)->>'eta')::int, 0),
                                  case when v_wm and j.win_start is not null then j.win_start else 0 end) end h
        from public.jobs j where j.day = p_day and j.truck_id = any(v_trucks) and j.status = 'booked' and j.deleted_at is null) q;
  for t in select x id from unnest(v_trucks) x order by x loop
    for b in select x.key from public.blocks() x order by x.pos loop
      perform public.route_hold(t.id, p_day, b.key, v_hold);
    end loop;
  end loop;
  perform set_config('garage.rpc', 'on', true);

  -- 14. the judge, every booked stop of the listed trucks that day (only from a SURE arrival)
  for r in select j.id, j.truck_id, j.block, j.stop_order, j.eta_min, j.win_start, j.win_end, j.arrive_at, j.duration_min,
                  j.eta_measured, j.told_day, j.told_start, j.told_end, c.first_name, bk.start_min b_start, bk.end_min b_end
           from public.jobs j join public.blocks() bk on bk.key = j.block left join public.customers c on c.id = j.customer_id
           where j.day = p_day and j.truck_id = any(v_trucks) and j.status = 'booked' and j.deleted_at is null
           order by bk.pos, j.truck_id, j.stop_order nulls last, j.eta_min nulls last, j.id loop
    v_sure := r.eta_min is not null and (not v_on or coalesce(r.eta_measured, false));
    select least(coalesce(max((x->>1)::int), r.b_end), r.b_end) into v_hend from jsonb_array_elements(coalesce(public.truck_ranges(r.truck_id, p_day), '[]'::jsonb)) x;
    v_ts := case when r.told_day = p_day and r.told_start is not null then r.told_start end;
    v_te := case when r.told_day = p_day and r.told_start is not null then r.told_end end;
    v_mv := r.id = any(v_moved);
    v_bf := v_before->(r.id::text);
    v_nws := null; v_nwe := null; v_wback := false; v_ffix := false; v_flater := false; v_late := null; v_early := null;
    v_plost := null; v_pmoved := false; v_at := null; v_pnew := false; v_pwas := null;
    if v_wm and r.win_start is not null then
      if v_sure and v_rewin then
        if v_ts is not null and r.eta_min between v_ts and v_te then
          -- back to what he was told: nothing to send
          if (v_ts, v_te) is distinct from (r.win_start, r.win_end) then v_nws := v_ts; v_nwe := v_te; v_wback := true; end if;
        elsif r.eta_min between r.win_start and r.win_end then
          null;   -- inside its window: kept
        else
          select * into w from public.win_for(r.eta_min);
          -- Part 29 (F4): the window of its arrival IS the one it has (an arrival past the day's end: win_for clamps to the
          -- last window) → no « new window », only how late or early
          if (w.win_start, w.win_end) is distinct from (r.win_start, r.win_end) then
            v_nws := w.win_start; v_nwe := w.win_end;
            v_wback := v_ts is not null and (v_nws, v_nwe) = (v_ts, v_te);
          end if;
          -- still outside the window of its own arrival (past the day's end; « avant » under half the rounding)
          if r.eta_min > w.win_end then v_late := r.eta_min - w.win_end; elsif r.eta_min < w.win_start then v_early := w.win_start - r.eta_min; end if;
        end if;
      elsif v_sure then
        -- the switch « les plages ne bougent jamais », or a save by someone without « Réserver »: said, never re-cut
        if r.eta_min > r.win_end then v_late := r.eta_min - r.win_end; elsif r.eta_min < r.win_start then v_early := r.win_start - r.eta_min; end if;
        if v_late is not null or v_early is not null then v_hand := v_hand || r.id; end if;
      end if;
    elsif v_wm and r.block = 'day' then
      -- flexible: its window comes now only when its evening lock is due (today; tomorrow from 18 h), else « la veille ».
      -- Part 29 (D5): a flexible stop he DRAGGED gets it now on any day (he chose its hour; a minute holds only a stop
      -- with a window); one he did not drag stays flexible until its evening (Part 28's days F7)
      if v_sure and v_rewin then
        if v_lock or v_mv then
          select * into w from public.win_for(r.eta_min);
          v_nws := w.win_start; v_nwe := w.win_end; v_ffix := true;
          if r.eta_min > v_nwe then v_late := r.eta_min - v_nwe; elsif r.eta_min < v_nws then v_early := v_nws - r.eta_min; end if;
        else
          v_flater := true;
        end if;
      end if;
    elsif not v_wm then
      -- blocks: a block tells its hours, nothing is re-cut
      if v_sure and r.eta_min > r.b_end then v_late := r.eta_min - r.b_end; end if;
    end if;
    -- the minutes pointed. Part 29 (G1): a stop he dragged (window mode, a stop that has or now gets a window: the planner
    -- holds a minute only there) is PINNED at the hour of its new place, sure or not (« never refused nor called late
    -- from a guess », as the exact move): later plans hold it there (G4). Its old minute (cleared in 12) is replaced by
    -- his, not lost. Also after « Laisser l'app choisir » (a stop dragged after it in the same draft)
    -- Part 29 (the reviews' F8): an arrival NOT sure (roads on, a trip not measured) is pointed only inside the window the
    -- stop has (no minute from a guess outside what the client holds: Part 28's way there, « trajets pas encore mesurés »)
    if v_mv and v_wm and r.eta_min is not null and (r.win_start is not null or v_nws is not null)
       and (v_sure or r.eta_min between r.win_start and r.win_end) then
      v_at := r.eta_min; v_pnew := true; v_pwas := (v_bf->>'at')::int;
    elsif not v_auto then
      -- (« Laisser l'app choisir » forgot them all: nothing to say)
      if not v_mv and r.arrive_at is not null and v_sure and r.eta_min > r.arrive_at then
        -- Part 29 (D2): a minute already passed before this save (an exact move « quand même ») that this save does not
        -- make later is pointed again at its arrival (kept as it is, the planner would break the day; lost, it would be
        -- planned anywhere); made later by this save → lost, said and accepted as before
        if (v_bf->>'eta') is not null and r.eta_min <= (v_bf->>'eta')::int then v_at := r.eta_min; v_pwas := r.arrive_at;
        else v_plost := r.arrive_at; end if;
      end if;
      -- a dragged stop that gets no minute (blocks mode, a flexible one left flexible) and had one: lost, said
      if v_mv and (v_bf->>'at') is not null then v_plost := (v_bf->>'at')::int; v_pmoved := true; end if;
    end if;
    -- another vehicle that cannot hold him (its hours end before he is done): refused, from a sure arrival only
    if v_sure and r.truck_id is distinct from (v_bf->>'truck')::uuid
       and (r.eta_min > v_hend or r.eta_min + v_stop + r.duration_min > v_hend) then
      v_ends := jsonb_set(v_ends, array[r.truck_id::text], coalesce(v_ends->(r.truck_id::text), jsonb_build_object('ends', v_hend, 'jobs', '[]'::jsonb, 'names', '[]'::jsonb))
        || jsonb_build_object('jobs', coalesce(v_ends->(r.truck_id::text)->'jobs', '[]'::jsonb) || to_jsonb(r.id::text),
                              'names', coalesce(v_ends->(r.truck_id::text)->'names', '[]'::jsonb) || to_jsonb(coalesce(r.first_name, '?'))));
    end if;
    if v_nws is not null then
      if v_ffix then a_flex := a_flex || jsonb_build_object(r.id::text, v_nws);
      elsif not v_wback then a_windows := a_windows || jsonb_build_object(r.id::text, v_nws); end if;
      v_wins := v_wins || jsonb_build_object(r.id::text, jsonb_build_array(r.win_start, r.win_end, v_nws, v_nwe));
      if v_wback then v_back := v_back || r.id; end if;
    end if;
    if v_late is not null then a_late := a_late || jsonb_build_object(r.id::text, v_late); v_late_ids := v_late_ids || r.id; end if;
    if v_early is not null then a_early := a_early || jsonb_build_object(r.id::text, v_early); v_early_ids := v_early_ids || r.id; end if;
    if v_plost is not null then
      a_pins := a_pins || jsonb_build_object(r.id::text, v_plost);
      if not v_mv then v_lost := v_lost || r.id; end if;
    end if;
    if v_at is not null then
      a_at := a_at || jsonb_build_object(r.id::text, v_at);
      if v_mv then v_pdrag := v_pdrag || r.id; end if;
    end if;
    v_stops := v_stops || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'truck_id', r.truck_id, 'truck_before', v_bf->'truck', 'block', r.block,
      'order', r.stop_order, 'order_before', v_bf->'order', 'eta', r.eta_min, 'eta_before', v_bf->'eta',
      'measured', case when v_on then coalesce(r.eta_measured, false) end,
      'win', case when r.win_start is not null then jsonb_build_array(r.win_start, r.win_end) end,
      'new_win', case when v_nws is not null then jsonb_build_array(v_nws, v_nwe) end,
      'win_back', v_wback, 'flex_fixed', v_ffix, 'flex_later', v_flater, 'late_min', v_late, 'early_min', v_early,
      'pin', case when v_at is not null then v_at when v_plost is null then r.arrive_at end, 'pin_lost', v_plost, 'pin_moved', v_pmoved,
      -- Part 29: pin_new = the minute of the place he dragged it to; pin_was = the minute it had before, for a stop whose
      -- minute this save points (dragged, or pointed again: D2), else null
      'pin_new', v_pnew, 'pin_was', case when v_at is not null then v_pwas end,
      'over', r.id = any(v_unplaced)));
  end loop;
  if v_ends <> '{}'::jsonb then
    select e.key, e.value into v_k, v_v from jsonb_each(v_ends) e order by e.key limit 1;
    select tr.name into v_name from public.trucks tr where tr.id = v_k::uuid;
    select string_agg(x, ', ' order by o) into v_nm from jsonb_array_elements_text(v_v->'names') with ordinality q(x, o);
    v_n := (v_v->>'ends')::int;
    raise exception using errcode = 'P0001', hint = 'truck_ends',
      message = format('%s finit à %s ce jour-là : %s n’y entre pas.', coalesce(v_name, 'Ce véhicule'),
                       format('%s h%s', v_n / 60, case when v_n % 60 = 0 then '' else ' ' || lpad((v_n % 60)::text, 2, '0') end), v_nm),
      detail = jsonb_build_object('truck', v_k, 'ends', v_n, 'jobs', v_v->'jobs')::text;
  end if;
  -- per truck (and block): where its day ends, past its hours from a sure last arrival
  for t in select (e->>'truck')::uuid id, e->>'block' blk, bk.end_min b_end, bk.pos
           from jsonb_array_elements(v_entries) e join public.blocks() bk on bk.key = e->>'block'
           order by bk.pos, (e->>'truck') loop
    select least(coalesce(max((x->>1)::int), t.b_end), t.b_end) into v_hend from jsonb_array_elements(coalesce(public.truck_ranges(t.id, p_day), '[]'::jsonb)) x;
    select q.fin, q.sure into r from (
      select j.eta_min + v_stop + j.duration_min fin, (not v_on or coalesce(j.eta_measured, false)) sure
      from public.jobs j where j.truck_id = t.id and j.day = p_day and j.block = t.blk and j.status = 'booked' and j.deleted_at is null and j.eta_min is not null
      order by 1 desc limit 1) q;
    v_fin := case when found then r.fin end;
    v_n := case when found and r.sure and r.fin > v_hend then r.fin - v_hend end;
    if v_n is not null then
      a_over := a_over || jsonb_build_object(t.id::text, greatest(v_n, coalesce((a_over->>(t.id::text))::int, 0)));
      if not (t.id = any(v_over_ids)) then v_over_ids := v_over_ids || t.id; end if;
    end if;
    v_tsum := v_tsum || jsonb_build_array(jsonb_build_object('id', t.id, 'block', t.blk, 'hours_end', v_hend, 'finish', v_fin, 'over_min', v_n,
      'drive_min', (select coalesce(sum(greatest(0, coalesce(j.travel_min, 0) - v_stop)), 0)::int from public.jobs j
                    where j.truck_id = t.id and j.day = p_day and j.block = t.blk and j.status = 'booked' and j.deleted_at is null),
      'unmeasured', case when v_on then (select count(*)::int from public.jobs j where j.truck_id = t.id and j.day = p_day and j.block = t.blk
                                             and j.status = 'booked' and j.deleted_at is null and not coalesce(j.eta_measured, false)) else 0 end));
  end loop;
  v_accept := jsonb_build_object('windows', a_windows, 'flex', a_flex, 'late', a_late, 'early', a_early, 'pins', a_pins, 'over', a_over,
    'at', a_at);

  -- 16. the writes of the verdict (+ the guard): the minutes this save points (Part 29: `at`; a dragged stop also stays on
  --     the vehicle he put it on, truck_pinned, as the exact move), the windows (new, flex, back to what he was told;
  --     win_flex left as it is), the minutes pointed that no longer hold, hand_at. NOT touched: confirm_sent_at, every
  --     told_*. No second walk: a window contains the arrival it was cut from, a minute is the arrival just walked
  v_meant := array(select k::uuid from jsonb_object_keys(a_at) k order by 1);
  with u as (update public.jobs j set arrive_at = (a_at->>(j.id::text))::int, truck_pinned = j.truck_pinned or j.id = any(v_pdrag)
             where j.id = any(v_meant) and j.status = 'booked' and j.deleted_at is null returning j.id)
  select array(select u.id from u order by u.id) into v_got;
  if v_got is distinct from v_meant then v_bad := true; end if;
  v_meant := array(select k::uuid from jsonb_object_keys(v_wins) k order by 1);
  with u as (update public.jobs j set win_start = (v_wins->(j.id::text)->>2)::int, win_end = (v_wins->(j.id::text)->>3)::int
             where j.id = any(v_meant) and j.status = 'booked' and j.deleted_at is null returning j.id)
  select array(select u.id from u order by u.id) into v_got;
  if v_got is distinct from v_meant then v_bad := true; end if;
  v_meant := array(select x from unnest(v_lost) x order by x);
  with u as (update public.jobs j set arrive_at = null where j.id = any(v_meant) and j.status = 'booked' and j.deleted_at is null returning j.id)
  select array(select u.id from u order by u.id) into v_got;
  if v_got is distinct from v_meant then v_bad := true; end if;
  v_meant := array(select x from unnest(v_hand) x order by x);
  with u as (update public.jobs j set hand_at = now() where j.id = any(v_meant) and j.status = 'booked' and j.deleted_at is null returning j.id)
  select array(select u.id from u order by u.id) into v_got;
  if v_got is distinct from v_meant then v_bad := true; end if;
  if v_bad then
    raise exception using errcode = 'P0001', hint = 'changed',
      message = 'Un rendez-vous de cette journée a changé (parti, fini, déplacé ou nouveau). Rouvre la journée.',
      detail = jsonb_build_object('missing', '[]'::jsonb)::text;
  end if;

  -- 18. the answer (the lists judged: the planner's for the app's order)
  select count(distinct coalesce(j.customer_id::text, j.id::text))::int into v_due
  from public.jobs j
  where (j.day = p_day or j.told_day = p_day) and j.deleted_at is null and j.status = 'booked' and public.tell_state(j) in ('new', 'changed');
  select coalesce(jsonb_agg(jsonb_build_object('truck', e->>'truck', 'block', e->>'block',
           'jobs', coalesce((select jsonb_agg(l->>'id' order by (l->>'pos')::int) from jsonb_array_elements(v_l) l
                             where l->>'truck' = e->>'truck' and l->>'block' = e->>'block'), '[]'::jsonb)) order by o), '[]'::jsonb)
    into v_lists
  from jsonb_array_elements(v_entries) with ordinality q(e, o);
  v_res := jsonb_build_object('ok', true, 'day', p_day, 'basis_ok', true, 'mode', case when v_wm then 'windows' else 'blocks' end,
    'roads', v_on, 'rewin', v_rewin, 'auto', v_auto, 'lists', v_lists, 'stops', v_stops, 'trucks', v_tsum, 'accept', v_accept,
    'due_after', v_due);

  -- 15. warn first (the save): every new window, flex window and minute lost must be the one shown, every minute pointed
  --     (Part 29: `at`) the one shown or at most 5 minutes later; every late, early and past-hours must have been shown and
  --     be at most 5 minutes worse. Fewer consequences never refuse
  if coalesce(p_check, false) then
    -- Part 29 (the reviews' F7): a minute pointed may be walked up to 5 minutes LATER than the one shown (today, the clock
    -- crossed a 5-minute step: as late / over), never earlier; the minute written is the one walked now
    if exists (select 1 from jsonb_each(a_at) e where (v_accept_in->'at'->e.key) is null
                 or jsonb_typeof(v_accept_in->'at'->e.key) <> 'number' or (e.value #>> '{}')::numeric < (v_accept_in->'at'->>e.key)::numeric
                 or (e.value #>> '{}')::numeric > (v_accept_in->'at'->>e.key)::numeric + 5)
       or exists (select 1 from jsonb_each(a_windows) e where (v_accept_in->'windows'->e.key) is null
                 or jsonb_typeof(v_accept_in->'windows'->e.key) <> 'number' or (v_accept_in->'windows'->>e.key)::numeric <> (e.value #>> '{}')::numeric)
       or exists (select 1 from jsonb_each(a_flex) e where (v_accept_in->'flex'->e.key) is null
                 or jsonb_typeof(v_accept_in->'flex'->e.key) <> 'number' or (v_accept_in->'flex'->>e.key)::numeric <> (e.value #>> '{}')::numeric)
       or exists (select 1 from jsonb_each(a_pins) e where (v_accept_in->'pins'->e.key) is null
                 or jsonb_typeof(v_accept_in->'pins'->e.key) <> 'number' or (v_accept_in->'pins'->>e.key)::numeric <> (e.value #>> '{}')::numeric)
       or exists (select 1 from jsonb_each(a_late) e where (v_accept_in->'late'->e.key) is null
                 or jsonb_typeof(v_accept_in->'late'->e.key) <> 'number' or (e.value #>> '{}')::numeric > (v_accept_in->'late'->>e.key)::numeric + 5)
       or exists (select 1 from jsonb_each(a_early) e where (v_accept_in->'early'->e.key) is null
                 or jsonb_typeof(v_accept_in->'early'->e.key) <> 'number' or (e.value #>> '{}')::numeric > (v_accept_in->'early'->>e.key)::numeric + 5)
       or exists (select 1 from jsonb_each(a_over) e where (v_accept_in->'over'->e.key) is null
                 or jsonb_typeof(v_accept_in->'over'->e.key) <> 'number' or (e.value #>> '{}')::numeric > (v_accept_in->'over'->>e.key)::numeric + 5) then
      raise exception using errcode = 'P0001', hint = 'outcome_changed',
        message = 'Depuis la vérification, la journée donnerait d’autres heures. Regarde de nouveau avant d’enregistrer.',
        detail = v_res::text;
    end if;
  end if;

  -- 17. the activity (the trigger writes its « update » rows; nothing while a preview tries it: garage.trial)
  if coalesce(current_setting('garage.trial', true), '') <> 'on' then
    insert into public.activity (actor, entity, entity_id, action, data)
    values (auth.uid(), 'day', null, 'day_ordered', jsonb_build_object('day', p_day, 'auto', v_auto, 'trucks', to_jsonb(v_trucks),
      'moved', to_jsonb(array(select x from unnest(v_moved) x where x = any(v_all) order by x)), 'windows', v_wins, 'back', to_jsonb(v_back),
      'pins_lost', to_jsonb(array(select k::uuid from jsonb_object_keys(a_pins) k order by 1)), 'late', to_jsonb(v_late_ids),
      'early', to_jsonb(v_early_ids), 'over', to_jsonb(v_over_ids), 'pinned', a_at));
  end if;
  if coalesce(p_check, false) then
    v_res := v_res || jsonb_build_object('saved', true, 'rows', jsonb_build_object('jobs',
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select jsonb_array_elements(public.block_rows(p_day, bk.key)) x from public.blocks() bk order by bk.pos) q)));
  end if;
  return v_res;
end $$;

-- plan_breaks (Part 29, the reviews' F1: ONE test for « this plan breaks the stored day », used by plan_route to freeze, by
-- replan_block_safe and roads_replan to keep): the vehicles holding a booked stop the plan makes late that the stored day
-- serves on time (at its minute pointed, else inside its window), or a stop already past its minute that the plan makes
-- later still. p_xid: the stop being tried (booked or moved), left out. Window mode only (the planner's « late » list)
create or replace function public.plan_breaks(p_plan jsonb, p_xid text) returns jsonb
language sql stable security definer set search_path = public as $$
  -- Part 29 (the reviews' F1): the guard's test, in one place
  select coalesce(jsonb_agg(distinct j.truck_id::text), '[]'::jsonb)
  from jsonb_array_elements_text(coalesce(p_plan->'late', '[]'::jsonb)) o
  join public.jobs j on j.id::text = o
  where o is distinct from p_xid and j.status = 'booked' and j.deleted_at is null and j.truck_id is not null and j.eta_min is not null
    and (j.eta_min <= coalesce(j.arrive_at, j.win_end)
         or (j.arrive_at is not null and coalesce((p_plan->'jobs'->o->>'eta')::int, 0) > j.eta_min))
$$;

-- plan_route_core (Part 27's text; Part 29: roads off, a frozen vehicle keeps its order, as roads on)
create or replace function public.plan_route_core(p_day date, p_block text, p_extra jsonb, p_exclude uuid, p_seed boolean, p_frozen jsonb)
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
  ev int[];                        -- round 2: one walk of a route (route_cost)
  v_pastend jsonb := '[]';        -- booked « quand même » and placed past the hours (they go at the end)
  -- Part 27 (« Vraies routes »): roads on, every decision counts the same clock as the arrival times written (route_clock)
  v_on boolean := public.roads_on(); eb int[]; v_dr int := 0; v_dep int;
  -- the vehicles frozen for this plan (see plan_route, the wrapper below): their booked stops stay on them, in order
  v_frz jsonb := coalesce(p_frozen, '[]'::jsonb);
  -- « exact move » (verify-on F7): this block-day holds a stop pinned to a minute (window mode)
  v_pinday boolean := false;
begin
  -- the day being planned: the walks below take the rush hours of a working day (drive_min)
  perform set_config('garage.drive_dow', coalesce(extract(isodow from p_day)::int::text, ''), true);
  select * into b from public.blocks() x where x.key = p_block;
  if not found then raise exception 'Bloc inconnu : %', p_block using errcode = '22023'; end if;
  v_wm := p_block = 'day' and public.windows_on();
  v_seed := coalesce(p_seed, false) and v_wm;
  v_pinday := v_wm and exists (select 1 from public.jobs j where j.day = p_day and j.block = p_block and j.arrive_at is not null
                               and j.status = 'booked' and j.deleted_at is null and (p_exclude is null or j.id <> p_exclude));
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
        -- Part 27 (fix-sql): a vehicle frozen for this plan (it holds an appointment the real roads no longer fit)
        || case when v_frz ? r.id::text then jsonb_build_object('frozen', true) else '{}'::jsonb end
        -- hours with a break inside the block (lunch, a split shift; the whole day in window mode): its stretches of hours,
        -- walked one after the other (Part 26)
        || coalesce((select jsonb_build_object('rg', jsonb_agg(jsonb_build_array(greatest((x->>0)::int, b.start_min), least((x->>1)::int, b.end_min)) order by (x->>0)::int))
                     from jsonb_array_elements(rg) x where least((x->>1)::int, b.end_min) > greatest((x->>0)::int, b.start_min)
                     having count(*) > 1), '{}'::jsonb));
    end if;
  end loop;

  -- the jobs of the block
  for r in
    select j.id, j.truck_id, j.truck_pinned, j.forced, j.status, j.duration_min, j.stop_order, j.manual_order,
           case when j.needs_machine then 'truck' else j.vehicle_kind end kind,
           coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng,
           j.win_start, j.win_end, j.arrived_at, j.eta_min, j.arrive_at
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
      -- booked « quand même » too (Part 26): placed after every other stop of the plan, inside its window when it fits,
      -- else late, else at the end (it never holds another stop to anything)
      || case when v_wm and r.status = 'booked' and r.win_start is not null and r.win_end is not null
              then jsonb_build_object('ws', coalesce(r.arrive_at, r.win_start), 'we', coalesce(r.arrive_at, r.win_end))
                || case when r.arrive_at is not null then jsonb_build_object('pin', true)
                                                          -- (verify-on fuzz2) late already (accepted at a move): placed after the pins in time
                                                          || case when r.eta_min > r.arrive_at then jsonb_build_object('pinlate', true) else '{}'::jsonb end
                        else '{}'::jsonb end else '{}'::jsonb end
      || case when v_wm and p_day = v_today and r.status = 'on_site' and r.eta_min is not null then jsonb_build_object('eta0', r.eta_min) else '{}'::jsonb end
      -- « exact move » (verify-on F7): on a day that holds a pinned stop, the walks count a wait only inside the truck's hours
      || case when v_pinday then jsonb_build_object('pw', true) else '{}'::jsonb end);
    if v_wm and r.status = 'booked' and r.win_start is not null and r.win_end is not null then v_win := true; end if;
    -- Part 27 (fix-sql): a frozen vehicle keeps its booked stops, in their stored order (the ones on the way, there or in
    -- an order by hand are fixed just below, first, as on any vehicle); nothing new goes on it but « quand même »
    if r.status = 'booked' and r.manual_order is null and r.truck_id is not null and v_frz ? r.truck_id::text then
      ti := null;
      for k in 0 .. jsonb_array_length(trucks) - 1 loop if trucks->k->>'id' = r.truck_id::text then ti := k; end if; end loop;
      if ti is not null then
        trucks := jsonb_set(trucks, array[ti::text, 'stops'], (trucks->ti->'stops') || to_jsonb(r.id::text));
        trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb((trucks->ti->>'durs')::int + v_dur));
        continue;
      end if;
    end if;
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
        -- roads on (Part 27): by the minutes measured from those starts (one not measured yet last), never the straight line
        'dist', case when v_on then public.drive_from_starts(trucks, v_hlat, v_hlng, r.lat, r.lng)
                     else coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, r.lat, r.lng)) from jsonb_array_elements(trucks) x),
                          public.km_between(v_hlat, v_hlng, r.lat, r.lng), 0) end);
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
      if v_w < 0 or (t->>'durs')::int + (case when v_on then (public.route_clock(t->'stops', null, 0, pts, (t->>'start')::int, hl, hg, null, null, v_speed, v_detour, v_unknown, v_stop, (t->>'nfixed')::int, t->'rg', true))[1]
                                             else public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) end) + v_w > (t->>'cap')::int then
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
      || case when v_ws is not null and v_we is not null then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end
      || case when v_pinday then jsonb_build_object('pw', true) else '{}'::jsonb end);
    if v_ws is not null and v_we is not null then v_win := true; end if;
    free := free || jsonb_build_array(jsonb_build_object('id', p_extra->>'id', 'truck', nullif(p_extra->>'truck', ''), 'forced', coalesce((p_extra->>'force')::boolean, false),
      -- which vehicle: said with the booking (`need`: the tire machine; `kind`: the person's choice), else as the job already is
      'kind', case when coalesce((p_extra->>'need')::boolean, false) then 'truck'
                   when p_extra ? 'kind' or p_extra ? 'need' then nullif(p_extra->>'kind', '')
                   else (select case when jj.needs_machine then 'truck' else jj.vehicle_kind end from public.jobs jj where jj.id = (p_extra->>'id')::uuid) end,
      -- roads on (Part 27): by the minutes measured from the trucks' starts
      'dist', case when v_on then public.drive_from_starts(trucks, v_hlat, v_hlng, clat, clng)
                   else coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, clat, clng)) from jsonb_array_elements(trucks) x),
                        public.km_between(v_hlat, v_hlng, clat, clng), 0) end));
  end if;

  v_forced := (select coalesce(jsonb_agg(e->'id'), '[]'::jsonb) from jsonb_array_elements(free) e where coalesce((e->>'forced')::boolean, false));
  -- pinned jobs first, then the farthest first; the ones booked « quand même » last (they never take the room of another).
  -- Window mode: the stop being added goes after the appointments already there (it never takes a window from them), and
  -- the stops with a promised window before the flexible ones.
  for r in select e from jsonb_array_elements(free) e
           order by coalesce((e->>'forced')::boolean, false), (v_wm and v_xid is not null and e->>'id' = v_xid),
                    ((pts->(e->>'id')->>'pin') is null), ((pts->(e->>'id')->>'pinlate') is not null),
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
      continue when t ? 'frozen';   -- Part 27 (fix-sql): a frozen vehicle takes nothing new
      n := jsonb_array_length(t->'stops');
      durs := (t->>'durs')::int;
      v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int;
      -- route_min, route_min_to and route_walk_in in one walk (round 2, speed: the same answers)
      ev := public.route_cost(t->'stops', null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3, (v_win and v_try < 3) or t ? 'rg');
      base := ev[1]; basee := ev[2]; v_bw := greatest(0, ev[3]);
      for pos in (t->>'nfixed')::int .. n loop
        -- the stop tried after the first `pos` stops (the order is no longer built to be tried)
        ev := public.route_cost(t->'stops', jid, pos, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3, (v_win and v_try < 3) or t ? 'rg');
        rc := ev[1]; rce := ev[2]; v_w := ev[3];
        continue when v_w < 0;
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
        continue when t ? 'frozen';
        n := jsonb_array_length(t->'stops'); durs := (t->>'durs')::int;
        v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int;
        ev := public.route_cost(t->'stops', null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3, (v_win and v_try < 3) or t ? 'rg');
        base := ev[1]; basee := ev[2]; v_bw := greatest(0, ev[3]);
        for pos in (t->>'nfixed')::int .. n loop
          ev := public.route_cost(t->'stops', jid, pos, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3, (v_win and v_try < 3) or t ? 'rg');
          rc := ev[1]; rce := ev[2]; v_w := ev[3];
          continue when v_w < 0;
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
        continue when t ? 'frozen';
        if v_on then
          -- roads on (Part 27): route_improve finds a better order with the usual-hours times (it only puts the stops
          -- in an order); whether that order fits and what it costs are counted on the clock, as the arrival times will be
          v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int;
          ev := public.route_clock(t->'stops', null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3);
          base := ev[1]; basee := ev[2]; v_bw := greatest(0, ev[3]);
          cand := public.route_improve((t->'stops') || to_jsonb(jid), v_nf, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
          ev := public.route_clock(cand, null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3);
          if el is not null and eg is not null and (ev[3] < 0 or durs + jdur + ev[1] + ev[3] > (t->>'cap')::int) then
            cand := public.route_improve((t->'stops') || to_jsonb(jid), v_nf, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
            ev := public.route_clock(cand, null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3);
          end if;
          rc := ev[1]; rce := ev[2]; v_w := ev[3];
          continue when v_w < 0;
        else
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
        if v_on then
          -- roads on (Part 27): the driving it adds at the end of the route, on the clock
          base := (public.route_clock(t->'stops', null, 0, pts, (t->>'start')::int, hl, hg, null, null, v_speed, v_detour, v_unknown, v_stop, (t->>'nfixed')::int, t->'rg', false))[1];
          rc := (public.route_clock(t->'stops', jid, n, pts, (t->>'start')::int, hl, hg, null, null, v_speed, v_detour, v_unknown, v_stop, (t->>'nfixed')::int, t->'rg', false))[1];
        else
          base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
          rc := public.route_min((t->'stops') || to_jsonb(jid), pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        end if;
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
      -- no window to be late for (flexible): late all the same, so a booking that pushes it there is seen (plan_late_new)
      if (pts->jid->>'we') is null then v_late := v_late || to_jsonb(jid); end if;
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
    if v_on then
      -- roads on (Part 27): the same choice, every total on the clock. route_improve only proposes the order that drives
      -- the least at the usual hours; it is kept when, on the clock, it fits in the truck's hours and every window holds
      -- (with windows or a break in the hours: when it costs no more driving + waiting than the order the stops were put in)
      if trucks->ti ? 'frozen' then
        -- a frozen vehicle (fix-sql, verify-on F1): its stops stay in their order (« quand même » after them)
        t := cand;
      else
        v_start := (trucks->ti->>'start')::int; v_nf := (trucks->ti->>'nfixed')::int;
        t := public.route_improve(cand, v_nf, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        ev := public.route_clock(t || v_tail, null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, trucks->ti->'rg', v_win);
        if el is not null and eg is not null and (ev[3] < 0 or (trucks->ti->>'durs')::int + ev[1] + ev[3] > (trucks->ti->>'cap')::int) then
          t := public.route_improve(cand, v_nf, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
          ev := public.route_clock(t || v_tail, null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, trucks->ti->'rg', v_win);
        end if;
        eb := public.route_clock(cand || v_tail, null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, trucks->ti->'rg', v_win);
        if eb[3] >= 0 and (ev[3] < 0
                           or ((v_win or trucks->ti ? 'rg') and ev[1] + ev[3] > eb[1] + eb[3])
                           or ((trucks->ti->>'durs')::int + ev[1] + ev[3] > (trucks->ti->>'cap')::int
                               and (trucks->ti->>'durs')::int + eb[1] + eb[3] <= (trucks->ti->>'cap')::int)) then
          t := cand;
        end if;
      end if;
    elsif trucks->ti ? 'frozen' then
      -- Part 29 (the reviews' F1): roads off too, a frozen vehicle (plan_route: the plan would break its stored day) keeps
      -- its stops in their order (« quand même » after them)
      t := cand;
    else
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
    end if;
    trucks := jsonb_set(trucks, array[ti::text, 'stops'], t || v_tail);
    t := trucks->ti; tm := (t->>'start')::int; plat := hl; plng := hg; k := 0; v_wt := 0; v_dr := 0;
    -- window mode, today: the stops come after the ones this truck already finished (they keep 1, 2, …: Part 26)
    v_dn := case when v_wm and p_day = v_today then (select count(*)::int from public.jobs j where j.truck_id = (t->>'id')::uuid and j.day = p_day
                   and j.block = p_block and j.status = 'done' and j.deleted_at is null and (p_exclude is null or j.id <> p_exclude)) else 0 end;
    for jid in select jsonb_array_elements_text(t->'stops') loop
      k := k + 1;
      clat := (pts->jid->>'lat')::double precision; clng := (pts->jid->>'lng')::double precision;
      v_dep := tm;
      leg := public.drive_min(plat, plng, clat, clng, v_speed, v_detour, v_unknown, tm);
      tm := tm + leg; v_dr := v_dr + leg + ceil(v_stop)::int;
      if v_win and k > (t->>'nfixed')::int then
        -- early at a stop with a window: the truck waits until it opens
        v_ws := (pts->jid->>'ws')::int; v_we := (pts->jid->>'we')::int;
        -- (exact move, verify-on F7) a day that holds a pinned stop ('pw'): only the minutes of a wait inside the truck's hours
        if v_ws is not null and tm < v_ws then v_wt := v_wt + case when (pts->jid->>'pw') is not null and t ? 'rg' then public.ranges_overlap(t->'rg', tm, v_ws)
                                                       else v_ws - tm end; tm := v_ws; end if;
        if t ? 'rg' then tm := coalesce(public.ranges_fit(t->'rg', tm, ceil(v_stop)::int + (pts->jid->>'dur')::int), tm); end if;
        if v_we is not null and tm > v_we then v_late := v_late || to_jsonb(jid); end if;
      elsif t ? 'rg' and k > (t->>'nfixed')::int then
        tm := coalesce(public.ranges_fit(t->'rg', tm, ceil(v_stop)::int + (pts->jid->>'dur')::int), tm);
      elsif v_win and (pts->jid->>'pin') is not null then
        v_ws := (pts->jid->>'ws')::int; v_we := (pts->jid->>'we')::int;
        if tm < v_ws then v_wt := v_wt + case when t ? 'rg' then public.ranges_overlap(t->'rg', tm, v_ws) else v_ws - tm end; tm := v_ws; end if;
        if tm > v_we then v_late := v_late || to_jsonb(jid); end if;
      end if;
      out_jobs := out_jobs || jsonb_build_object(jid, coalesce(out_jobs->jid, '{}'::jsonb) || jsonb_build_object('truck', t->>'id', 'order', k + v_dn, 'eta', coalesce((pts->jid->>'eta0')::int, tm), 'travel', leg + ceil(v_stop)::int)
        -- roads on (Part 27): the minute the truck leaves for this stop (day_drive takes its legs at the same minutes)
        || case when v_on then jsonb_build_object('dep', v_dep) else '{}'::jsonb end);
      tm := tm + ceil(v_stop)::int + (pts->jid->>'dur')::int;
      if clat is not null then plat := clat; plng := clng; end if;
    end loop;
    -- roads on (Part 27): the driving of the walk just made (each leg at its minute), the one behind the arrival times
    used := (t->>'durs')::int + case when v_on then v_dr else public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) end + v_wt;
    trucks := jsonb_set(trucks, array[ti::text], (t - 'nfixed' - 'durs' - 'rg') || jsonb_build_object('used', used, 'left', (t->>'cap')::int - used, 'wait', v_wt));
  end loop;

  placed := p_extra is not null and (out_jobs ? (p_extra->>'id'));
  v_res := jsonb_build_object('day', p_day, 'block', p_block, 'trucks', trucks, 'jobs', out_jobs, 'over', over, 'late', v_late,
    'extra', case when p_extra is null then null else jsonb_build_object('placed', placed, 'truck', out_jobs->(p_extra->>'id')->>'truck', 'eta', out_jobs->(p_extra->>'id')->>'eta') end)
    -- made on the stored routes (plan_extra adds a stop to the same routes)
    || case when v_seed then jsonb_build_object('seeded', true) else '{}'::jsonb end;
  -- Part 26 (window mode): this plan makes late an appointment that its stored route reaches in its window: the plan seeded
  -- with the stored routes (they stay, the new stop goes where every window holds) is taken when it makes fewer late
  if p_seed is null and v_wm and public.plan_late_stored(v_res, v_xid) > 0 then
    v_alt := public.plan_route_core(p_day, p_block, p_extra, p_exclude, true, p_frozen);
    if public.plan_late_stored(v_alt, v_xid) < public.plan_late_stored(v_res, v_xid)
       and not exists (select 1 from jsonb_array_elements_text(coalesce(v_alt->'over', '[]'::jsonb)) o where not (coalesce(v_res->'over', '[]'::jsonb) ? o) and o is distinct from v_xid) then
      return v_alt;
    end if;
  end if;
  return v_res;
end $function$;

-- plan_route (Part 27's wrapper; Part 29, the reviews' F1: window mode, a vehicle whose stored day the plan would break is
-- frozen — its booked stops stay on it in their stored order, walked again: every minute pointed and window it holds stays;
-- nothing new goes on it but « Réserver quand même », at its end — and the block is planned around it: the other vehicle
-- keeps its room (G4). Every plan of the whole day goes through it: a booking and « quand même », a move, a length, the
-- hours and starts (replan_days), a cancel / « Client absent » / the evening lock (replan_block_safe), the measures
-- (roads_replan), the moments offered and the previews. Roads off and a day with room: the planner's answer as before)
create or replace function public.plan_route(p_day date, p_block text, p_extra jsonb, p_exclude uuid, p_seed boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_frz jsonb := '[]'::jsonb; v_kept jsonb := '[]'::jsonb; v_new jsonb; p jsonb; i int;
  -- Part 29 (the reviews' F1): window mode, the vehicles whose stored day the plan would break are frozen too
  v_wm boolean := p_block = 'day' and public.windows_on(); v_first jsonb;
begin
  if not public.roads_on() then
    -- roads off: the planner of before — unless, window mode, its plan breaks the stored day (a TIGHT day: someone late or
    -- the truck past its hours, what « Enregistrer quand même » or « Déplacer quand même » makes; there the planner
    -- breaks the minutes pointed and the windows): then the vehicles it breaks are frozen, found on the block's own plan
    -- (no stop tried) as below, and the stop tried is planned around them. A day with room: the first answer, as before
    v_first := public.plan_route_core(p_day, p_block, p_extra, p_exclude, p_seed, null);
    if not v_wm or jsonb_array_length(public.plan_breaks(v_first, p_extra->>'id')) = 0 then return v_first; end if;
    p := case when p_extra is null then v_first else public.plan_route_core(p_day, p_block, null, p_exclude, p_seed, null) end;
    for i in 1 .. 10 loop
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_new from jsonb_array_elements_text(public.plan_breaks(p, null)) x
      where not (v_frz ? x) and exists (select 1 from jsonb_array_elements(p->'trucks') t where t->>'id' = x);
      exit when jsonb_array_length(v_new) = 0;
      v_frz := v_frz || v_new;
      p := public.plan_route_core(p_day, p_block, null, p_exclude, p_seed, v_frz);
    end loop;
    -- only the stop tried breaks it (the block alone holds): the answer of before (a booking that would break it is refused)
    if jsonb_array_length(v_frz) = 0 then return v_first; end if;
    if p_extra is not null then p := public.plan_route_core(p_day, p_block, p_extra, p_exclude, p_seed, v_frz); end if;
    return p || jsonb_build_object('frozen', v_frz, 'kept', '[]'::jsonb);
  end if;
  for i in 1 .. 10 loop
    p := public.plan_route_core(p_day, p_block, null, p_exclude, p_seed, v_frz);
    -- the vehicles of the plan holding an appointment it leaves out (a vehicle that does not work the block cannot be frozen)
    select coalesce(jsonb_agg(distinct j.truck_id::text), '[]'::jsonb) into v_new
    from jsonb_array_elements_text(coalesce(p->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid
    where j.truck_id is not null and not (v_frz ? j.truck_id::text)
      and exists (select 1 from jsonb_array_elements(p->'trucks') t where t->>'id' = j.truck_id::text);
    -- Part 29: and, window mode, the ones whose stored day this plan breaks (plan_breaks)
    if v_wm then
      select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into v_new
      from (select jsonb_array_elements_text(v_new) x
            union select y from jsonb_array_elements_text(public.plan_breaks(p, null)) y
                  where not (v_frz ? y) and exists (select 1 from jsonb_array_elements(p->'trucks') t where t->>'id' = y)) q;
    end if;
    exit when jsonb_array_length(v_new) = 0;
    v_kept := v_kept || (select coalesce(jsonb_agg(o order by o), '[]'::jsonb)
                         from jsonb_array_elements_text(coalesce(p->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid
                         where v_new ? coalesce(j.truck_id::text, ''));
    v_frz := v_frz || v_new;
  end loop;
  if p_extra is not null then p := public.plan_route_core(p_day, p_block, p_extra, p_exclude, p_seed, v_frz); end if;
  return p || jsonb_build_object('frozen', v_frz, 'kept', v_kept);
end $$;

-- replan_block_safe: roads on, the appointments this automatic re-plan makes late (a position found, a cancellation, a
-- duration) are written down (activity « window_late »: roads_late_note). Off: the text of before. Part 29: the guard (G4)
create or replace function public.replan_block_safe(p_day date, p_block text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_plan jsonb; v_today boolean; tk record;
  -- Part 27 (fix-sql, verify-on F11): roads on, who this re-plan makes late is written down
  v_on boolean := public.roads_on(); v_before jsonb;
begin
  if not public.block_open(p_day, p_block) then return jsonb_build_object('skipped', true, 'day', p_day, 'block', p_block); end if;
  perform public.lock_block(p_day, p_block);
  if v_on then v_before := public.roads_late_ids(array[p_day]); end if;
  v_plan := public.plan_block(p_day, p_block);
  v_today := p_block = 'day' and p_day = public.local_today() and public.windows_on()
             and public.now_min() >= (select s.start_min from public.day_span() s);
  -- Part 29 (G4, the guard): a plan that makes late an appointment the stored day serves on time (inside its window, or at
  -- its minute pointed), or makes a minute already passed later still, is not written — today too: the stored routes are
  -- kept, walked again (a tight day: the truck past its hours, a stop accepted late; there the planner breaks minutes and
  -- windows). On a day with room the plan holds every window and minute (try 1): nothing changes there
  if jsonb_array_length(public.plan_breaks(v_plan, null)) > 0 then
    for tk in select distinct j.truck_id from public.jobs j
              where j.day = p_day and j.block = p_block and j.deleted_at is null and j.status = 'booked' and j.truck_id is not null loop
      perform public.route_retime(tk.truck_id, p_day, p_block);
    end loop;
    v_plan := jsonb_build_object('skipped', true, 'kept', true, 'why', 'late', 'day', p_day, 'block', p_block);
  elsif not v_today and exists (select 1 from jsonb_array_elements_text(coalesce(v_plan->'over', '[]'::jsonb)) o
                             join public.jobs j on j.id = o::uuid where j.truck_id is not null) then
    for tk in select distinct j.truck_id from public.jobs j
              where j.day = p_day and j.block = p_block and j.deleted_at is null and j.status = 'booked' and j.truck_id is not null loop
      perform public.route_retime(tk.truck_id, p_day, p_block);
    end loop;
    v_plan := jsonb_build_object('skipped', true, 'kept', true, 'day', p_day, 'block', p_block);
  else
    perform public.apply_plan(v_plan);
  end if;
  if v_on then perform public.roads_late_note(array[p_day], v_before, 'replan'); end if;
  -- work for the tire machine left on a vehicle without it (no vehicle with the machine has room): said in the activity
  -- (`needs_truck`, once per vehicle) so the agenda can show it
  insert into public.activity (entity, entity_id, action, data)
  select 'job', j.id, 'needs_truck', jsonb_build_object('day', j.day, 'block', j.block, 'truck_id', j.truck_id)
  from public.jobs j join public.trucks tr on tr.id = j.truck_id
  where j.day = p_day and j.block = p_block and j.deleted_at is null and j.status = 'booked' and j.needs_machine and not tr.tire_machine
    and not exists (select 1 from public.activity a where a.entity = 'job' and a.entity_id = j.id and a.action = 'needs_truck'
                    and a.data->>'truck_id' = j.truck_id::text);
  return v_plan;
end $$;

-- roads_replan (Part 27; the nightly and background measures, the switch): Part 29, the same guard as replan_block_safe
create or replace function public.roads_replan(p_days date[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date; bk record; tk record; p jsonb; n integer := 0; v_kept jsonb := '[]'::jsonb; v_before jsonb; v_late jsonb;
  v_chain text := coalesce(current_setting('garage.chain', true), ''); v_rpc text := coalesce(current_setting('garage.rpc', true), '');
begin
  if coalesce(cardinality(p_days), 0) = 0 then return jsonb_build_object('planned', 0, 'kept', '[]'::jsonb, 'late', '[]'::jsonb); end if;
  -- who is late already (after the window, or the block, told to the customer), to say only the ones this makes late
  v_before := public.roads_late_ids(p_days);
  perform set_config('garage.rpc', 'on', true);
  perform set_config('garage.chain', 'on', true);
  foreach d in array p_days loop
    for bk in select x.key from public.blocks() x order by x.pos loop
      continue when not exists (select 1 from public.jobs j where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked');
      if not public.block_open(d, bk.key) then
        -- today, a block already started (fix-sql, verify-on F3): nobody moves, but its arrival times are walked again with
        -- the times of the mode now in force (from now, from where each truck is: route_retime), never left as they were
        if d = public.local_today() then
          perform public.lock_block(d, bk.key);
          for tk in select distinct j.truck_id from public.jobs j
                    where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked' and j.truck_id is not null loop
            perform public.route_retime(tk.truck_id, d, bk.key);
          end loop;
        end if;
        continue;
      end if;
      perform public.lock_block(d, bk.key);
      p := public.plan_block(d, bk.key);
      if exists (select 1 from jsonb_array_elements_text(coalesce(p->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid where j.truck_id is not null)
         -- Part 29 (G4, the guard, as replan_block_safe): a plan that makes late someone the stored day serves on time
         or jsonb_array_length(public.plan_breaks(p, null)) > 0 then
        -- kept: everybody stays where they are, with the arrival times of the real roads
        for tk in select distinct j.truck_id from public.jobs j
                  where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked' and j.truck_id is not null loop
          perform public.route_retime(tk.truck_id, d, bk.key);
        end loop;
        v_kept := v_kept || jsonb_build_array(jsonb_build_object('day', d, 'block', bk.key));
        continue;
      end if;
      perform public.apply_plan(p);
      if jsonb_array_length(coalesce(p->'frozen', '[]'::jsonb)) > 0 then
        -- roads on: a vehicle frozen (its appointments no longer fit on the real roads): they stay where they are, with the
        -- arrival times of the real roads (the plan walked them), the other vehicles planned around (fix-sql, verify-on F1)
        v_kept := v_kept || jsonb_build_array(jsonb_build_object('day', d, 'block', bk.key));
      else
        n := n + 1;
      end if;
    end loop;
  end loop;
  perform set_config('garage.chain', v_chain, true);
  perform set_config('garage.rpc', v_rpc, true);
  -- the newly late, each written down (activity « window_late »)
  v_late := public.roads_late_note(p_days, v_before, 'roads');
  return jsonb_build_object('planned', n, 'kept', v_kept, 'late', v_late);
end $$;

-- Who may call them: as before, the server's own (Part 28's loop for day_order_core; refonte_planification for
-- replan_block_safe; Part 27's loop for roads_replan). Re-stated, so a copy where one was opened by hand is closed again
revoke all on function public.day_order_core(date, jsonb, uuid[], jsonb, boolean, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.day_order_core(date, jsonb, uuid[], jsonb, boolean, jsonb, boolean) to service_role;
revoke all on function public.replan_block_safe(date, text) from public, anon, authenticated;
grant execute on function public.replan_block_safe(date, text) to service_role;
revoke all on function public.roads_replan(date[]) from public, anon, authenticated;
grant execute on function public.roads_replan(date[]) to service_role;
-- Part 29 (the reviews' F1): plan_route as the refonte left it, plan_route_core as Part 27's loop, plan_breaks the same
revoke all on function public.plan_route(date, text, jsonb, uuid, boolean) from public, anon, authenticated;
grant execute on function public.plan_route(date, text, jsonb, uuid, boolean) to service_role;
revoke all on function public.plan_route_core(date, text, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.plan_route_core(date, text, jsonb, uuid, boolean, jsonb) to service_role;
revoke all on function public.plan_breaks(jsonb, text) from public, anon, authenticated;
grant execute on function public.plan_breaks(jsonb, text) to service_role;
