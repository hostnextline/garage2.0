-- Part 29, THE WAY BACK (ops/live/PARTIE29.md §5): the three functions Part 29 makes again, put back as they were
-- BEFORE it, byte for byte: day_order_core from Part 28 (20261122000100), replan_block_safe and roads_replan from Part 27
-- (20261119000200) — tests/ops: ops/tests/fichiers.test.mjs checks each text against those files. « create or replace »
-- only: no drop, no delete; no row is written. The line of supabase_migrations.schema_migrations stays (never deleted):
-- to install Part 29 again later, run the body of 20261122000200_garder_ordre.sql again (its own « create or replace »),
-- without a second insert into schema_migrations.
-- What stays after it (harmless): the minutes the Part 29 saves pointed (arrive_at, truck_pinned on the stops dragged):
-- Part 27's planner reads them as an exact move's; Part 28's save keeps them while they hold, and says « lost » the ones a
-- later save pushes past.
-- Run as ONE block (the SQL editor runs the whole text in one transaction): first in a try that ends by « rollback; », then
-- for real.
begin;

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

  -- 13. the walk (the planner's walk, route_hold): a stop he moved waits for nothing; any other stop with a window waits
  --     for its minute pointed, else the window he was TOLD that day when it starts earlier than its planned one (an
  --     earlier save pushed it later and nobody sent it: days F1), else its window — « quand même » ones too (else a
  --     stop pulled earlier would get an earlier window). Never a later told start: a stop an earlier save pulled
  --     earlier keeps its place (the truck would idle, the stops after it re-cut; review R1) and stays owed its window.
  --     A flexible one: route_hold's own rule
  select coalesce(jsonb_object_agg(j.id::text,
           case when j.id = any(v_moved) then 0
                else coalesce(j.arrive_at,
                              case when v_rewin and j.told_day = p_day and j.told_start is not null
                                        and j.told_start < j.win_start then j.told_start end,
                              j.win_start) end)
           filter (where j.id = any(v_moved) or (v_wm and j.win_start is not null)), '{}'::jsonb) into v_hold
  from public.jobs j where j.day = p_day and j.truck_id = any(v_trucks) and j.status = 'booked' and j.deleted_at is null;
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
    v_plost := null; v_pmoved := false;
    if v_wm and r.win_start is not null then
      if v_sure and v_rewin then
        if v_ts is not null and r.eta_min between v_ts and v_te then
          -- back to what he was told: nothing to send
          if (v_ts, v_te) is distinct from (r.win_start, r.win_end) then v_nws := v_ts; v_nwe := v_te; v_wback := true; end if;
        elsif r.eta_min between r.win_start and r.win_end then
          null;   -- inside its window: kept
        else
          select * into w from public.win_for(r.eta_min);
          v_nws := w.win_start; v_nwe := w.win_end;
          v_wback := v_ts is not null and (v_nws, v_nwe) = (v_ts, v_te);
          -- still outside the window of its own arrival (past the day's end; « avant » under half the rounding)
          if r.eta_min > v_nwe then v_late := r.eta_min - v_nwe; elsif r.eta_min < v_nws then v_early := v_nws - r.eta_min; end if;
        end if;
      elsif v_sure then
        -- the switch « les plages ne bougent jamais », or a save by someone without « Réserver »: said, never re-cut
        if r.eta_min > r.win_end then v_late := r.eta_min - r.win_end; elsif r.eta_min < r.win_start then v_early := r.win_start - r.eta_min; end if;
        if v_late is not null or v_early is not null then v_hand := v_hand || r.id; end if;
      end if;
    elsif v_wm and r.block = 'day' then
      -- flexible: its window comes now only when its evening lock is due (today; tomorrow from 18 h), else « la veille »
      if v_sure and v_rewin then
        if v_lock then
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
    -- the minutes pointed (« Laisser l'app choisir » forgot them all: nothing to say)
    if not v_auto then
      if not v_mv and r.arrive_at is not null and v_sure and r.eta_min > r.arrive_at then v_plost := r.arrive_at; end if;
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
    v_stops := v_stops || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'truck_id', r.truck_id, 'truck_before', v_bf->'truck', 'block', r.block,
      'order', r.stop_order, 'order_before', v_bf->'order', 'eta', r.eta_min, 'eta_before', v_bf->'eta',
      'measured', case when v_on then coalesce(r.eta_measured, false) end,
      'win', case when r.win_start is not null then jsonb_build_array(r.win_start, r.win_end) end,
      'new_win', case when v_nws is not null then jsonb_build_array(v_nws, v_nwe) end,
      'win_back', v_wback, 'flex_fixed', v_ffix, 'flex_later', v_flater, 'late_min', v_late, 'early_min', v_early,
      'pin', case when v_plost is null then r.arrive_at end, 'pin_lost', v_plost, 'pin_moved', v_pmoved,
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
  v_accept := jsonb_build_object('windows', a_windows, 'flex', a_flex, 'late', a_late, 'early', a_early, 'pins', a_pins, 'over', a_over);

  -- 16. the writes of the verdict (+ the guard): the windows (new, flex, back to what he was told; win_flex left as it is),
  --     the minutes pointed that no longer hold, hand_at. NOT touched: confirm_sent_at, every told_*. No second walk: a
  --     window contains the arrival it was cut from
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

  -- 15. warn first (the save): every new window, flex window and minute lost must be the one shown; every late, early and
  --     past-hours must have been shown and be at most 5 minutes worse. Fewer consequences never refuse
  if coalesce(p_check, false) then
    if exists (select 1 from jsonb_each(a_windows) e where (v_accept_in->'windows'->e.key) is null
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
      'early', to_jsonb(v_early_ids), 'over', to_jsonb(v_over_ids)));
  end if;
  if coalesce(p_check, false) then
    v_res := v_res || jsonb_build_object('saved', true, 'rows', jsonb_build_object('jobs',
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select jsonb_array_elements(public.block_rows(p_day, bk.key)) x from public.blocks() bk order by bk.pos) q)));
  end if;
  return v_res;
end $$;

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
  if not v_today and exists (select 1 from jsonb_array_elements_text(coalesce(v_plan->'over', '[]'::jsonb)) o
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
      if exists (select 1 from jsonb_array_elements_text(coalesce(p->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid where j.truck_id is not null) then
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

revoke all on function public.day_order_core(date, jsonb, uuid[], jsonb, boolean, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.day_order_core(date, jsonb, uuid[], jsonb, boolean, jsonb, boolean) to service_role;
revoke all on function public.replan_block_safe(date, text) from public, anon, authenticated;
grant execute on function public.replan_block_safe(date, text) to service_role;
revoke all on function public.roads_replan(date[]) from public, anon, authenticated;
grant execute on function public.roads_replan(date[]) to service_role;
-- the control: none of the three says « Part 29 » any more
do $$ begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('day_order_core', 'replan_block_safe', 'roads_replan') and p.prosrc like '%Part 29%') then
    raise exception 'ARRÊT : une des trois fonctions dit encore « Part 29 »';
  end if;
end $$;
commit;
