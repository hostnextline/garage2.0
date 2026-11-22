-- Part 28 — Réorganiser la journée et Envoyer les heures aux clients
--
-- Hassan (the owner), 2026-11-21 / 22: « i want to be able to easely rearange a day » (one screen, every truck's stops in a
-- list, nothing changes until « Enregistrer »); « dont send any text, put a button that will send for all clients, ill press
-- it when day is filled and im done re organizing » (booking still texts at once; a move and a rearranged day text nobody;
-- one button texts the clients not told their hours yet, or whose hours changed since their last text, never twice);
-- 01:27: « the system should ask me first » (« Texter … ? » after a move stays, in the app).
-- The contract: REARRANGE.md v3 (FROZEN), §1. This file only ADDS (7 columns, functions with new names, 2 triggers with new
-- names): no function of Part 27 (20261119000200_vraies_routes.sql, live since 2026-11-22) is written again here, so its
-- generator (ops/generateurs/vraies-routes/build.py) and its « switch off = before » test keep their meaning; they are only
-- CALLED. Nothing here removes anything (no drop, no truncate, no row taken away: the owner's rule, test S120), and the file
-- can be applied again with the same result (« if not exists », « or replace »).
-- NEEDS Part 27 first: jobs.eta_measured, jobs.arrive_at, roads_on(), roads_no(), route_hold(), exact_works().
--
--   jobs.told_*            what the customer was TOLD (day + hours of his last text, or what a person confirmed telling him)
--   jobs.hand_at           a save by someone without « Réserver » left his sure arrival outside his window (not a slip)
--   tell_now / tell_state  THE rule: what a customer must be told now (its TypeScript twin: src/domain/jobs/told.ts; both
--                          read tests/fixtures/told-cases.json)
--   day_order_preview / day_order_save   « Réorganiser la journée »: one body, day_order_core
--   tell_list / tell_mark  « Envoyer les heures aux clients »: the list, « Je l'ai averti » / « C'est envoyé »
--   tell_take / tell_done / tell_release   the lease every text of a « told » kind takes (notify, book: the server key)
--   told_install()         marks what live's customers were already told (run here, and again after notify's deploy)

-- =====================================================================================================================
-- 1. The columns (nullable, no default: a backup made before them restores; written by the server only — the app's
--    update grant on jobs is per column, 20261104000200_access.sql, and does not name them; every phone reads them with
--    the table-wide select, by realtime and in the backup)
-- =====================================================================================================================
alter table public.jobs add column if not exists told_day   date;
alter table public.jobs add column if not exists told_start integer check (told_start between 0 and 1440);
alter table public.jobs add column if not exists told_end   integer check (told_end between 0 and 1440);
alter table public.jobs add column if not exists told_at    timestamptz;   -- null = never told anything
alter table public.jobs add column if not exists told_how   text check (told_how in ('sms', 'maybe', 'hand', 'call', 'install'));
alter table public.jobs add column if not exists told_by    uuid;          -- the staff who sent or marked it (null: the server)
alter table public.jobs add column if not exists hand_at    timestamptz;   -- a save by hand pushed him out of his window, kept

-- =====================================================================================================================
-- 2. The one rule: what a customer must be told NOW (REARRANGE.md §1.3)
-- =====================================================================================================================

-- THE switch « les plages ne bougent jamais » (settings.booking.rewin = false). Absent = true. Read as JSON (roads_no): a
-- value written by a script (« oui ») never makes a cast throw inside every tell_state
create or replace function public.day_rewin_on() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select not public.roads_no(s.booking->'rewin') from public.settings s where s.id = 1), true)
$$;

-- the hours a job HAS, in minutes: a 'day' job its window (null, null = flexible); a block job its block's hours now
create or replace function public.told_hours(p_block text, p_ws int, p_we int) returns table (h_start int, h_end int)
language sql stable security definer set search_path = public as $$
  select case when p_block = 'day' then p_ws else b.start_min end, case when p_block = 'day' then p_we else b.end_min end
  from (select 1) o left join public.blocks_set() b on b.key = p_block
$$;

-- what the customer must be told now. Window mode, booked, a SURE arrival (switch « Vraies routes » off: always; on:
-- eta_measured): inside the window he was told that day → those hours (nothing to send, whatever the planned window); else,
-- the switch « rewin » on and outside the PLANNED window → the window of that arrival (win_for, the garage's one rule);
-- else the hours the job has. drift: today, due ONLY because the arrival slipped (told = planned, and no save by hand
-- pushed him out since he was told: hand_at) — « le texto en route lui donnera l'heure ».
-- (The booleans are never null: a SQL null would read as « no » anyway.)
create or replace function public.tell_now(j public.jobs) returns table (n_day date, n_start int, n_end int, rewin boolean, drift boolean)
language sql stable security definer set search_path = public as $$
  select j.day,
         case when s.told_in then j.told_start when s.go then w.win_start else h.h_start end,
         case when s.told_in then j.told_end   when s.go then w.win_end   else h.h_end   end,
         s.go,
         coalesce(s.go and j.day = public.local_today()
              and (j.told_day, j.told_start, j.told_end) is not distinct from (j.day, j.win_start, j.win_end)
              and (j.hand_at is null or j.hand_at < j.told_at), false)
  from public.told_hours(j.block, j.win_start, j.win_end) h
  cross join lateral (select public.windows_on() and j.block = 'day' and j.status = 'booked' and j.eta_min is not null
                             and (not public.roads_on() or coalesce(j.eta_measured, false)) sure) a
  cross join lateral (select coalesce(a.sure and j.told_day = j.day and j.told_start is not null
                             and j.eta_min between j.told_start and j.told_end, false) told_in) t
  cross join lateral (select t.told_in, coalesce(not t.told_in and a.sure and public.day_rewin_on() and j.win_start is not null
                             and (j.eta_min < j.win_start or j.eta_min > j.win_end), false) go) s
  left join lateral public.win_for(case when s.go then j.eta_min end) w on true
$$;

-- 'new' | 'changed' | 'drift' | 'ok' | null (not a coming booked appointment, or today's hours already over)
create or replace function public.tell_state(j public.jobs) returns text
language sql stable security definer set search_path = public as $$
  select case
    when j.deleted_at is not null or j.status <> 'booked' or j.day < public.local_today() then null
    when j.day = public.local_today() and coalesce(n.n_end, 1440) <= public.now_min() then null
    when j.told_at is null then 'new'
    when n.drift then 'drift'
    when j.told_start is null and n.n_start is not null and j.told_day = n.n_day then 'new'
    when (j.told_day, j.told_start, j.told_end) is distinct from (n.n_day, n.n_start, n.n_end) then 'changed'
    else 'ok' end
  from public.tell_now(j) n
$$;

-- =====================================================================================================================
-- 3. « Réorganiser la journée » (REARRANGE.md §1.4): day_order_core, the ONE body; day_order_preview (written then undone)
--    and day_order_save (kept). No planner runs on the person's lists (no chain, no other day, nobody thrown to « À
--    placer »): the trucks, the order and the times are written as he left them, each stop held to what its customer
--    was told, then judged, warn first.
-- =====================================================================================================================
-- p_lists = [{ truck, block, jobs: [ids] }] (null only in a preview with p_auto); p_moved = the stops he picked up and put
-- down; p_was = { id: [truck_id, block, stop_order, win_start, win_end, arrive_at, status] } of every booked / en_route /
-- on_site job of that day on the listed trucks, as the draft was built from; p_auto = « Laisser l'app choisir »;
-- p_accept = the `accept` of the last preview the person saw; p_check = the save (refuse what was not shown).
-- A refusal: raise … using errcode P0001, hint = <code>, message = <French words>, detail = <json> (exact_place's way).
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
  where j.needs_machine and not tr.tire_machine;
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
  --     for its minute pointed, else the window he was TOLD that day, else its window — « quand même » ones too (else a
  --     stop pulled earlier would get an earlier window); a flexible one: route_hold's own rule
  select coalesce(jsonb_object_agg(j.id::text,
           case when j.id = any(v_moved) then 0
                else coalesce(j.arrive_at,
                              case when v_rewin and j.told_day = p_day and j.told_start is not null
                                        and (j.told_start, j.told_end) is distinct from (j.win_start, j.win_end) then j.told_start end,
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

-- day_order_preview: what « Enregistrer » would do, said before, NOTHING kept (the core run inside a block always undone,
-- as move_preview; garage.trial stops every activity row, so no number is spent either). Its refusals are the core's,
-- thrown with their hint and detail. Called by POST (never offline, never queued).
create or replace function public.day_order_preview(p_day date, p_lists jsonb, p_moved uuid[] default '{}', p_was jsonb default null,
  p_auto boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_done boolean := false;
begin
  begin
    perform set_config('garage.trial', 'on', true);
    v := public.day_order_core(p_day, p_lists, coalesce(p_moved, '{}'::uuid[]), p_was, coalesce(p_auto, false), '{}'::jsonb, false);
    v_done := true;
    raise exception 'day_order_preview: undone' using errcode = 'P0001', hint = 'preview_undone';
  exception when others then
    if not v_done then raise; end if;
  end;
  return v;
end $$;

-- day_order_save: the claim first (the same press twice = the stored answer), then the core, kept. Refusals: the core's +
-- day_changed, outcome_changed. The app calls it with queue: false (never kept on the phone)
create or replace function public.day_order_save(p_op uuid, p_day date, p_lists jsonb, p_moved uuid[], p_was jsonb, p_auto boolean,
  p_accept jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; v jsonb;
begin
  v_done := public.op_begin(p_op, 'day_order_save');
  if v_done is not null then return v_done; end if;
  if p_lists is null or jsonb_typeof(p_lists) is distinct from 'array' or p_was is null or jsonb_typeof(p_was) is distinct from 'object' then
    perform public.fail('bad_list', 'La liste des arrêts n’est pas bonne.');
  end if;
  v := public.day_order_core(p_day, p_lists, coalesce(p_moved, '{}'::uuid[]), p_was, coalesce(p_auto, false), coalesce(p_accept, '{}'::jsonb), true);
  return public.op_save(p_op, 'day_order_save', v);
end $$;

-- =====================================================================================================================
-- 4. « Envoyer les heures aux clients » (REARRANGE.md §1.5)
-- =====================================================================================================================

-- the kind of text a job gets now: never told → its booking confirmation; told « dans la journée », now a window that day →
-- the window; any other change → moved; not due (ok, drift): the kind of its last text of these three (else moved)
-- (inline in tell_list / tell_take: same words)

-- tell_list(day): the appointments to tell on that day (day = D or told_day = D), as the person may see them
create or replace function public.tell_list(p_day date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_on jsonb := coalesce((select s.messages->'on' from public.settings s where s.id = 1), '{}'::jsonb);
begin
  if not (public.is_owner() or public.can('book')) then
    perform public.fail('not_allowed', 'Seuls le propriétaire et le bureau envoient les heures aux clients.');
  end if;
  select coalesce(jsonb_agg(x.o order by x.nd, x.ns nulls first, x.number), '[]'::jsonb) into v
  from (
    select q.number, q.nd, q.ns, jsonb_build_object('id', q.id, 'number', q.number, 'customer_id', q.customer_id, 'state', q.st, 'kind', q.kind,
             'told', case when q.told_at is not null then jsonb_build_object('day', q.told_day, 'start', q.told_start, 'end', q.told_end, 'at', q.told_at, 'how', q.told_how) end,
             'now', jsonb_build_object('day', q.nd, 'start', q.ns, 'end', q.ne, 'rewin', q.rw),
             'phone_ok', coalesce(length(q.dg) = 10 or (length(q.dg) = 11 and left(q.dg, 1) = '1'), false),
             'sms_ok', q.sms_ok is distinct from false,
             'kind_on', q.kind is null or (v_on->q.kind) is distinct from 'false'::jsonb) o
    from (
      select j.id, j.number, j.customer_id, j.told_day, j.told_start, j.told_end, j.told_at, j.told_how, s.st, n.n_day nd, n.n_start ns, n.n_end ne, n.rewin rw,
             regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') dg, c.sms_ok,
             case when s.st = 'drift' then null when j.told_at is null then 'booking' when s.st = 'new' then 'window' else 'moved' end kind
      from public.jobs j
      left join public.customers c on c.id = j.customer_id
      cross join lateral (select public.tell_state(j) st) s
      cross join lateral public.tell_now(j) n
      where (j.day = p_day or j.told_day = p_day) and j.deleted_at is null and j.status = 'booked'
        and public.job_visible(j.truck_id, j.created_by)
        and s.st in ('new', 'changed', 'drift')) q
  ) x;
  return v;
end $$;

-- tell_take(jobs, again, token, force): the server key (notify, book) takes the right to text these jobs NOW, under the
-- job's row lock: still due + a lease (rate_limits 'tell:<id>', 2 minutes) in one decision, so two presses, or the day's
-- button and a single text at the same second, never text one customer twice. Several ids: a row another transaction
-- holds is skipped (« busy », the next round takes it): never a wait in a cycle with the planners. One id: it waits for
-- its row (holding nothing else, it cannot be in a cycle; a confirmation is never dropped because a plan held the row).
-- → [{ id, take: true, state, kind, now: { day, start, end, rewin, ws, we }, job } | { id, busy | gone | already: true }]
create or replace function public.tell_take(p_jobs uuid[], p_again uuid[], p_token int, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_id uuid; j public.jobs; n record; v_state text; v_kind text; v_out jsonb := '[]'::jsonb; v_got int;
begin
  v_ids := array(select distinct x from unnest(coalesce(p_jobs, '{}'::uuid[])) x where x is not null order by 1);
  foreach v_id in array v_ids loop
    if cardinality(v_ids) = 1 then
      select * into j from public.jobs where id = v_id for update;
    else
      select * into j from public.jobs where id = v_id for update skip locked;
    end if;
    if not found then
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id,
        case when cardinality(v_ids) > 1 and exists (select 1 from public.jobs x where x.id = v_id) then 'busy' else 'gone' end, true));
      continue;
    end if;
    if j.status <> 'booked' or j.deleted_at is not null or j.day < public.local_today() then
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'gone', true));
      continue;
    end if;
    v_state := public.tell_state(j);
    if not coalesce(v_state in ('new', 'changed')
                    or (v_id = any(coalesce(p_again, '{}'::uuid[])) and j.told_how = 'maybe' and v_state = 'ok')
                    or coalesce(p_force, false), false) then
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'already', true));
      continue;
    end if;
    -- the lease: a fresh one, or one older than 2 minutes (a text that never answered) taken over
    insert into public.rate_limits as rl (key, bucket, n, at) values ('tell:' || v_id, 0, coalesce(p_token, 0), now())
    on conflict (key, bucket) do update set n = excluded.n, at = excluded.at where rl.at < now() - interval '2 minutes';
    get diagnostics v_got = row_count;
    if v_got = 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'busy', true));
      continue;
    end if;
    select * into n from public.tell_now(j);
    v_kind := case when j.told_at is null then 'booking' when v_state = 'new' then 'window' when v_state = 'changed' then 'moved'
                   else coalesce((select m.kind from public.messages m where m.job_id = j.id and m.kind in ('booking', 'window', 'moved')
                                    and m.deleted_at is null order by m.created_at desc limit 1), 'moved') end;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'take', true, 'state', v_state, 'kind', v_kind,
      'now', jsonb_build_object('day', n.n_day, 'start', n.n_start, 'end', n.n_end, 'rewin', n.rewin, 'ws', j.win_start, 'we', j.win_end),
      'job', to_jsonb(j)));
  end loop;
  return v_out;
end $$;

-- tell_done(job, token, now, how, by, kind): the text went (or may have: 'maybe'), or a person told him: told = the day and
-- hours that text said (never over a newer told); confirm_sent_at for booking / moved (so old phones' « À confirmer pour
-- demain » drop him), not for window; and when the hours were the window of his arrival (rewin) and his window is still
-- the one the text was cut from: that window written — the ONE place a window moves because of an arrival outside it, at
-- the moment the customer learns it. Then the lease is dropped (one row, one lock: no cycle)
create or replace function public.tell_done(p_job uuid, p_token int, p_now jsonb, p_how text, p_by uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare j public.jobs; v_day date; v_s int; v_e int; v_rw boolean;
begin
  select * into j from public.jobs where id = p_job for update;
  if found then
    v_day := nullif(p_now->>'day', '')::date; v_s := (p_now->>'start')::int; v_e := (p_now->>'end')::int;
    v_rw := coalesce(p_now->'rewin' = 'true'::jsonb, false) and v_s is not null
            and j.status = 'booked' and j.deleted_at is null and j.day = v_day and j.block = 'day'
            and j.win_start is not null and (j.win_start, j.win_end) = ((p_now->>'ws')::int, (p_now->>'we')::int);
    update public.jobs set told_day = v_day, told_start = v_s, told_end = v_e, told_at = now(), told_how = p_how, told_by = p_by,
      confirm_sent_at = case when p_kind = 'window' then confirm_sent_at else now() end,
      win_start = case when v_rw then v_s else win_start end, win_end = case when v_rw then v_e else win_end end
    where id = p_job and (told_at is null or told_at <= now());
  end if;
  perform public.tell_release(p_job, p_token);
end $$;

-- tell_release(job, token): the lease dropped (a text that did not go); only the one this token took. (Made old rather
-- than taken away: the next tell_take takes it over at once, and rate_hit's housekeeping clears it after 2 days)
create or replace function public.tell_release(p_job uuid, p_token int) returns void
language sql security definer set search_path = public as $$
  update public.rate_limits set at = now() - interval '1 day'
  where key = 'tell:' || p_job and bucket = 0 and n = p_token and at >= now() - interval '1 day'
$$;

-- tell_mark(op, marks): « Je l'ai averti » (how 'call') and « C'est envoyé » (how 'hand': a text sent by hand from a phone).
-- [{ id, how, kind, day, start, end }] = what the person told him. The owner and « Réserver »; « C'est envoyé » also the
-- mechanic of the job (job_actor: he booked on his own truck and sent the confirmation by hand). A job another action
-- holds right now is « busy » (never waited for); a job whose hours to tell are no longer the ones shown is « changed »
-- (still due); else written as tell_done.
create or replace function public.tell_mark(p_op uuid, p_marks jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; m jsonb; j public.jobs; n record; v_id uuid; v_how text;
  v_marked uuid[] := '{}'; v_changed uuid[] := '{}'; v_busy uuid[] := '{}'; v_res jsonb;
begin
  v_done := public.op_begin(p_op, 'tell_mark');
  if v_done is not null then return v_done; end if;
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi.'); end if;
  if p_marks is null or jsonb_typeof(p_marks) <> 'array' or jsonb_array_length(p_marks) > 200
     or exists (select 1 from jsonb_array_elements(p_marks) e
                where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'id') is distinct from 'string'
                   or (e->>'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                   or coalesce(e->>'how', '') not in ('call', 'hand')
                   or (e->'kind' is not null and jsonb_typeof(e->'kind') <> 'null' and coalesce(e->>'kind', '') not in ('booking', 'window', 'moved'))
                   or coalesce(e->>'day', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                   or coalesce(jsonb_typeof(e->'start'), 'null') not in ('number', 'null')
                   or coalesce(jsonb_typeof(e->'end'), 'null') not in ('number', 'null'))
     or (select count(distinct lower(e->>'id')) from jsonb_array_elements(p_marks) e) <> jsonb_array_length(p_marks) then
    perform public.fail('bad_list', 'La liste des clients n’est pas bonne.');
  end if;
  for m in select e from jsonb_array_elements(p_marks) e order by lower(e->>'id') loop
    v_id := (m->>'id')::uuid; v_how := m->>'how';
    select * into j from public.jobs where id = v_id;
    if not found then v_changed := v_changed || v_id; continue; end if;
    -- (a job « À placer », or booked by nobody, makes job_actor null: read as « no », as job_step does)
    if not coalesce(public.is_owner() or public.can('book') or (v_how = 'hand' and public.job_actor(j)), false) then
      perform public.fail('not_allowed', 'Seuls le propriétaire et le bureau envoient les heures aux clients.');
    end if;
    select * into j from public.jobs where id = v_id for update skip locked;
    if not found then v_busy := v_busy || v_id; continue; end if;
    if j.status <> 'booked' or j.deleted_at is not null then v_changed := v_changed || v_id; continue; end if;
    select * into n from public.tell_now(j);
    if (n.n_day, n.n_start, n.n_end) is not distinct from ((m->>'day')::date, (m->>'start')::numeric::int, (m->>'end')::numeric::int) then
      perform public.tell_done(v_id, null, jsonb_build_object('day', n.n_day, 'start', n.n_start, 'end', n.n_end, 'rewin', n.rewin,
        'ws', j.win_start, 'we', j.win_end), v_how, auth.uid(), m->>'kind');
      v_marked := v_marked || v_id;
    else
      v_changed := v_changed || v_id;
    end if;
  end loop;
  v_res := jsonb_build_object('ok', true, 'marked', to_jsonb(v_marked), 'changed', to_jsonb(v_changed), 'busy', to_jsonb(v_busy),
    'rows', jsonb_build_object('jobs', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from public.jobs x
                                        where x.id = any(v_marked || v_changed))));
  return public.op_save(p_op, 'tell_mark', v_res);
end $$;

-- told_install(): what live's customers were already told, written once (and again after notify's deploy: what the OLD
-- notify texted in between set confirm_sent_at, not told). Only booked, not deleted, coming jobs never told — or marked by
-- an earlier run and texted since (confirm_sent_at, or a « window » text, after that mark). No activity row per job.
--   1. confirm_sent_at set (move_job and the exact move clear it on every change of day, block or window), not a flexible
--      job given its window since: told = its day and hours (a block job: its block's hours now), at confirm_sent_at;
--   2. a flexible job given its window: its window when a sent « window » text came after its last window_fixed (or when
--      its confirmation came after it, or when no evening lock ever fixed it: it was booked into a day already locked, its
--      confirmation said the window), at that moment; else, confirmation sent: « dans la journée » (day, null, null);
--   3. no confirmation but such a « window » text: its window;
--   4. else never told (exactly today's « À confirmer » rows): due for the button.
create or replace function public.told_install() returns int
language plpgsql security definer set search_path = public as $$
declare v_trial text := coalesce(current_setting('garage.trial', true), ''); n int := 0;
begin
  perform set_config('garage.trial', 'on', true);
  with c as (
    select j.id, j.day, j.block, j.win_start, j.win_end, j.confirm_sent_at,
           (j.block = 'day' and coalesce(j.win_flex, false) and j.win_start is not null) fw,
           (select max(a.at) from public.activity a where a.entity = 'job' and a.entity_id = j.id and a.action = 'window_fixed') fix
    from public.jobs j
    where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today()
      and (j.told_at is null
           or (j.told_how = 'install' and (j.confirm_sent_at > j.told_at
               or exists (select 1 from public.messages m where m.job_id = j.id and m.kind = 'window' and m.status = 'sent' and m.created_at > j.told_at))))),
  d as (
    select c.*, (select max(m.created_at) from public.messages m where m.job_id = c.id and m.kind = 'window' and m.status = 'sent'
                   and m.created_at >= coalesce(c.fix, '-infinity'::timestamptz)) msg
    from c),
  t as (
    select d.id,
           case when d.fw then
                  case when d.msg is not null then 'w'
                       when d.confirm_sent_at is not null and (d.fix is null or d.confirm_sent_at >= d.fix) then 'w'
                       when d.confirm_sent_at is not null then 'f' end
                when d.confirm_sent_at is not null then 'h' end how,
           case when d.fw and d.msg is not null then d.msg else d.confirm_sent_at end at,
           d.day, d.block, d.win_start, d.win_end
    from d)
  update public.jobs j
     set told_day = t.day,
         told_start = case t.how when 'w' then t.win_start when 'f' then null else (select h.h_start from public.told_hours(t.block, t.win_start, t.win_end) h) end,
         told_end = case t.how when 'w' then t.win_end when 'f' then null else (select h.h_end from public.told_hours(t.block, t.win_start, t.win_end) h) end,
         told_at = t.at, told_how = 'install', told_by = null
  from t
  where j.id = t.id and t.how is not null;
  get diagnostics n = row_count;
  perform set_config('garage.trial', v_trial, true);
  raise notice 'told_install: % rendez-vous marqués avertis', n;
  return n;
end $$;

-- =====================================================================================================================
-- 5. What clears « told » (the two moments that clear confirm_sent_at today)
-- =====================================================================================================================
-- another customer on the job (« Changer de client »)
create or replace function public.jobs_told_reset() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is distinct from old.customer_id then
    new.told_day := null; new.told_start := null; new.told_end := null; new.told_at := null; new.told_how := null; new.told_by := null;
  end if;
  return new;
end $$;
create or replace trigger jobs_told_reset before update of customer_id on public.jobs
  for each row execute function public.jobs_told_reset();

-- the customer's phone digits changed: a new number never got the text
create or replace function public.customers_told_reset() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone_digits is distinct from old.phone_digits then
    update public.jobs set told_day = null, told_start = null, told_end = null, told_at = null, told_how = null, told_by = null
    where customer_id = new.id and status = 'booked' and deleted_at is null and (told_at is not null or told_day is not null);
  end if;
  return null;
end $$;
create or replace trigger customers_told_reset after update of phone on public.customers
  for each row execute function public.customers_told_reset();

-- =====================================================================================================================
-- 6. Who may call what: the helpers are the server's own; the app calls four (tests/db/refonte-droits.test.mjs APP)
-- =====================================================================================================================
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array['day_rewin_on', 'told_hours', 'tell_now', 'tell_state', 'day_order_core',
             'tell_take', 'tell_done', 'tell_release', 'told_install', 'jobs_told_reset', 'customers_told_reset'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
revoke all on function public.day_order_preview(date, jsonb, uuid[], jsonb, boolean) from public, anon;
grant execute on function public.day_order_preview(date, jsonb, uuid[], jsonb, boolean) to authenticated, service_role;
revoke all on function public.day_order_save(uuid, date, jsonb, uuid[], jsonb, boolean, jsonb) from public, anon;
grant execute on function public.day_order_save(uuid, date, jsonb, uuid[], jsonb, boolean, jsonb) to authenticated, service_role;
revoke all on function public.tell_list(date) from public, anon;
grant execute on function public.tell_list(date) to authenticated, service_role;
revoke all on function public.tell_mark(uuid, jsonb) from public, anon;
grant execute on function public.tell_mark(uuid, jsonb) to authenticated, service_role;

-- =====================================================================================================================
-- 7. What live's customers were already told (again after notify's deploy: ops/live/PARTIE28.md)
-- =====================================================================================================================
select public.told_install();
