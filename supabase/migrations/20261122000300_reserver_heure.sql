-- Part 30 — Réserver à l'heure choisie : le rendez-vous va à la minute choisie, avertir avant s'il n'y a pas de place, puis la
-- nouvelle carte (Hassan, 2026-11-22 : « hours can change, but i want to be able to decide so if i forcefully book someone at
-- a specific time, i want the system to show a warning if there is no place but still let me book it, then show me the new
-- map »)
--
-- The law: STATE.md 2026-11-22 13:00, K1, K2, K3, K5. Parts 27, 28 and 29 (20261119000200, 20261122000100, 20261122000200)
-- are LIVE: their files are not touched. This file only makes again book_job from its LATEST text (Part 27's, copied, then
-- changed where it says « Part 30 »), and adds:
--   book_at_row   the new appointment's row, put on a vehicle at a minute (pinned: arrive_at, truck_pinned; its window
--                 win_for(minute)); a TRIAL row takes a number of its own (never one of job_number_seq: a preview spends none)
--   book_at_try   one try of that row on one vehicle with the exact move's own placing (exact_place, check off): its answer,
--                 or its refusal (arrive_late with the earliest minute…), everything undone
--   book_at       the booking at a minute (window mode): every vehicle that may take it tried (the one asked, else each one
--                 working that day that fits the work: the tire machine, the kind asked; nothing said: the car first), the
--                 best one kept (the fewest made late, the truck past its hours counting as one; then nobody's hour moved;
--                 then the car first; then the least delay; then the vehicles' order), then written as the exact move
--                 writes a move: AT that minute, every other stop of that vehicle keeping its order and held not before its
--                 arrival (route_hold), pushed later only when the new stop truly takes their time; the other vehicles not
--                 touched. The same refusals and protocol as the exact move (exact_place): arrive_late { earliest,
--                 earliest_keep, truck_id } when no vehicle can be there at that minute; late_changed { late, over_hours }
--                 when the ones made late (or the truck past its hours: the new appointment's own id accepts it) are not
--                 all in p_job.late_ok. Forcing (somebody late, or past the hours): the owner and the office only, the very
--                 right of « Réserver quand même » (not_allowed for anyone else). A TIGHT day of Part 29 too: the new
--                 appointment goes AT its minute (route_hold, never the planner's « at the end »).
--                 jobs.forced stays false: the minute is pinned (a forced row of Part 19 goes at the end of the route and is
--                 not held to its window, which is the opposite); the answer says forced: true, and the activity
--                 « booked_at » keeps who was made late and by how much.
--   book_preview  (the app) what that booking would do, nothing written (book_job itself inside a block always undone, as
--                 move_preview; no job number spent): who is pushed, who would be late and by how much, the truck's end past
--                 its hours, the earliest minute, the vehicle, may_force. Its refusals are the booking's (thrown, the same
--                 hint, words and detail), but late_changed and not_allowed for forcing: the preview SAYS them instead
--                 (stops[].late, over_hours, forced, may_force).
-- book_job: window mode with p_job.arrive_at (a whole minute of the day) and not win_flex → book_at; else exactly as before
-- (blocks mode never reads the minute; tests/db/vraies-routes-off.test.mjs compares the rest with the definitions of before).
-- The planner (plan_route, plan_block, suggest_*) is not changed: its answers are the same (ops/live/partie30/essai-partie30.sql).
-- « create or replace » only: no drop, no delete, no truncate, no row written; applied twice, the same functions and grants.
-- Rights: book_job and book_preview open to the app (book_preview checks book_job's own rights inside); the three helpers
-- the server's own (tests/db/refonte-droits.test.mjs).

-- book_at_row(job, p_job, day, truck, minute, length, machine, kind, trial): the new appointment's row on that vehicle at that
-- minute. A trial row (book_at_try) is undone by its caller and takes a number of its own below zero: nextval is never
-- called for it (a preview spends no number of job_number_seq, which a rollback does not give back)
create or replace function public.book_at_row(p_id uuid, p_job jsonb, p_day date, p_truck uuid, p_at integer, p_dur integer,
  p_need boolean, p_kind text, p_trial boolean) returns void
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  select * into w from public.win_for(p_at);
  perform set_config('garage.rpc', 'on', true);
  insert into public.jobs (id, number, customer_id, vehicle_id, day, block, truck_id, truck_pinned, forced, duration_min, status, problem,
    notes, address, unit, postal_code, lat, lng, card_on_file, source, quote_id, created_by, needs_machine, vehicle_kind,
    win_start, win_end, win_flex, arrive_at)
  values (p_id, case when p_trial then -(1 + floor(random() * 2000000000))::int else nextval('public.job_number_seq')::int end,
    nullif(p_job->>'customer_id', '')::uuid, nullif(p_job->>'vehicle_id', '')::uuid, p_day, 'day', p_truck, true, false, p_dur, 'booked',
    nullif(p_job->>'problem', ''), nullif(p_job->>'notes', ''), nullif(p_job->>'address', ''), nullif(p_job->>'unit', ''),
    nullif(p_job->>'postal_code', ''), nullif(p_job->>'lat', '')::double precision, nullif(p_job->>'lng', '')::double precision,
    coalesce((p_job->>'card_on_file')::boolean, false), coalesce(nullif(p_job->>'source', ''), 'phone'), nullif(p_job->>'quote_id', '')::uuid,
    auth.uid(), p_need, p_kind, w.win_start, w.win_end, false, p_at);
end $$;

-- book_at_try(job, p_job, day, truck, minute, length, machine, kind): the row put there (a trial row), then the exact move's
-- placing of it (exact_place, check off: who would be late is said, not refused), then everything undone (an error raised
-- on purpose and caught at once; garage.trial: no activity written). → exact_place's answer without its rows, or
-- { refused: code, message, detail, earliest, earliest_keep } (arrive_late: the earliest minutes at or after the one asked)
create or replace function public.book_at_try(p_id uuid, p_job jsonb, p_day date, p_truck uuid, p_at integer, p_dur integer,
  p_need boolean, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_done boolean := false; v_state text; v_msg text; v_hint text; v_detail text; v_d jsonb := '{}'::jsonb;
begin
  begin
    perform set_config('garage.trial', 'on', true);
    perform public.book_at_row(p_id, p_job, p_day, p_truck, p_at, p_dur, p_need, p_kind, true);
    v := public.exact_place(p_id, p_day, p_truck, p_at, '[]'::jsonb, false) - 'rows';
    v_done := true;
    raise exception 'book_at_try: undone' using errcode = 'P0001', hint = 'book_undone';
  exception when others then
    if not v_done then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint, v_detail = pg_exception_detail;
      -- only a refusal of the move (public.fail's way: a code in the hint); anything else is an error, raised again
      if v_state <> 'P0001' or coalesce(v_hint, '') !~ '^[a-z][a-z_]*$' then raise; end if;
      if coalesce(v_detail, '') like '{%' then v_d := v_detail::jsonb; end if;
      v := jsonb_build_object('refused', v_hint, 'message', v_msg, 'detail', nullif(v_detail, ''),
        'earliest', v_d->'earliest', 'earliest_keep', v_d->'earliest_keep');
    end if;
  end;
  return v;
end $$;

-- book_at(job, p_job, items, day, truck, minute, length, machine, kind, write): the booking at that minute (window mode; see the
-- head of this file). write false (book_preview): the best try said, nothing written. write true: refused unless the ones
-- it makes late are accepted (late_ok) and the person may force it; then the row, its lines, the estimate and the card as
-- book_job writes them, and the exact move's placing for real (exact_place, check on)
create or replace function public.book_at(p_id uuid, p_job jsonb, p_items jsonb, p_day date, p_truck uuid, p_at integer,
  p_dur integer, p_need boolean, p_kind text, p_write boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  sp record; w record; t uuid; v_trucks uuid[]; v_try jsonb; v_best jsonb; v_bt uuid; v_score int[]; v_bscore int[]; v_i int := 0;
  v_early jsonb; v_keep int; v_refused jsonb; v_late jsonb; v_over int; v_forced boolean; v_ok jsonb; v_bad jsonb; v_place jsonb;
  it jsonb; k int := 0; j public.jobs; v_carfirst boolean := not p_need and p_kind is null;
  v_may boolean := public.is_owner() or public.has_role('office');
begin
  select * into sp from public.day_span();
  if p_at < sp.start_min or p_at >= sp.end_min then
    perform public.fail('bad_window', 'Cette heure n’est pas dans les heures de la journée : choisis-en une autre.');
  end if;
  -- the vehicles tried: the one asked (a truck picked, a mechanic's own), else every one that works that day and fits the work
  if p_truck is not null then
    if not public.exact_works(p_truck, p_day, 'day') then
      perform public.fail('pick_truck', 'Ce camion ne travaille pas ce jour-là : choisis une autre journée, ou laisse l’app choisir le camion.');
    end if;
    v_trucks := array[p_truck];
  else
    v_trucks := array(select tr.id from public.trucks tr
      where tr.active and tr.deleted_at is null and public.exact_works(tr.id, p_day, 'day')
        and (not p_need or tr.tire_machine) and (p_kind is null or (p_kind = 'truck') = tr.tire_machine)
      order by tr.sort nulls last, tr.name, tr.id);
    if coalesce(cardinality(v_trucks), 0) = 0 then
      if exists (select 1 from public.trucks tr where tr.active and tr.deleted_at is null and public.exact_works(tr.id, p_day, 'day')) then
        perform public.fail('pick_truck', 'Aucun véhicule qui peut faire ce travail ne travaille ce jour-là : choisis une autre journée.');
      end if;
      perform public.fail('block_closed', 'Cette journée est fermée : aucun camion ne travaille.');
    end if;
  end if;
  perform public.lock_block(p_day, 'day');
  -- each vehicle tried, everything undone; kept: the fewest made late (past the hours counts as one), then nobody's hour
  -- moved, then the car first (nothing asked: as the planner), then the least delay added, then the vehicles' order
  foreach t in array v_trucks loop
    v_i := v_i + 1;
    v_try := public.book_at_try(p_id, p_job, p_day, t, p_at, p_dur, p_need, p_kind);
    if v_try ? 'refused' then
      if v_try->>'refused' = 'arrive_late' then
        if v_early is null or coalesce((v_try->>'earliest')::int, 1440) < coalesce((v_early->>'earliest')::int, 1440) then
          v_early := v_try || jsonb_build_object('truck_id', t);
        end if;
        if (v_try->>'earliest_keep') is not null then v_keep := least(coalesce(v_keep, 1440), (v_try->>'earliest_keep')::int); end if;
      elsif v_refused is null then
        v_refused := v_try;
      end if;
      continue;
    end if;
    select array[
        count(*) filter (where (s->>'late')::boolean)::int + case when coalesce((v_try->>'over_hours')::int, 0) > 0 then 1 else 0 end,
        case when coalesce(sum(greatest(0, (s->>'delay_min')::int)), 0) > 0 then 1 else 0 end,
        case when v_carfirst and exists (select 1 from public.trucks tr where tr.id = t and tr.tire_machine) then 1 else 0 end,
        coalesce(sum(greatest(0, (s->>'delay_min')::int)), 0)::int,
        v_i]
      into v_score
    from jsonb_array_elements(coalesce(v_try->'stops', '[]'::jsonb)) s where s->>'id' <> p_id::text;
    if v_best is null or v_score < v_bscore then v_best := v_try; v_bt := t; v_bscore := v_score; end if;
  end loop;
  if v_best is null then
    if v_early is not null then
      raise exception using errcode = 'P0001', hint = 'arrive_late',
        message = format(case when cardinality(v_trucks) > 1 then 'Aucun véhicule ne peut être là à %s : au plus tôt %s.'
                              else 'Le camion ne peut pas être là à %s : au plus tôt %s.' end,
                         public.exact_hm(p_at), public.exact_hm((v_early->>'earliest')::int)),
        detail = jsonb_build_object('earliest', v_early->'earliest', 'earliest_keep', v_keep, 'truck_id', v_early->'truck_id')::text;
    end if;
    raise exception using errcode = 'P0001', hint = coalesce(v_refused->>'refused', 'block_closed'),
      message = coalesce(v_refused->>'message', 'Cette journée est fermée : aucun camion ne travaille.'), detail = coalesce(v_refused->>'detail', '');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', s->>'id', 'late_min', (s->>'late_min')::int) order by (s->>'order_after')::int), '[]'::jsonb) into v_late
  from jsonb_array_elements(coalesce(v_best->'stops', '[]'::jsonb)) s where s->>'id' <> p_id::text and (s->>'late')::boolean;
  v_over := coalesce((v_best->>'over_hours')::int, 0);
  v_forced := jsonb_array_length(v_late) > 0 or v_over > 0;
  select * into w from public.win_for(p_at);
  if not p_write then
    return jsonb_build_object('ok', true, 'preview', true, 'exact', true, 'at', p_at, 'job_id', p_id, 'truck_id', v_bt,
      'win_start', w.win_start, 'win_end', w.win_end, 'forced', v_forced, 'may_force', v_may, 'late', v_late,
      'stops', coalesce(v_best->'stops', '[]'::jsonb), 'over_hours', v_over, 'earliest', v_best->'earliest', 'earliest_keep', v_best->'earliest_keep');
  end if;
  -- forcing (somebody late, the truck past its hours): the right of « Réserver quand même »
  if v_forced and not v_may then
    perform public.fail('not_allowed', 'Seuls le propriétaire et le bureau peuvent réserver à cette heure : elle met un autre client en retard, ou le camion après ses heures.');
  end if;
  v_ok := case when jsonb_typeof(p_job->'late_ok') = 'array' then p_job->'late_ok' else '[]'::jsonb end;
  select jsonb_agg(e) into v_bad from jsonb_array_elements(v_late) e where not (v_ok ? (e->>'id'));
  if v_bad is not null or (v_over > 0 and not (v_ok ? p_id::text)) then
    raise exception using errcode = 'P0001', hint = 'late_changed',
      message = 'La journée a changé depuis la vérification : cette réservation mettrait un autre client en retard (ou le camion après ses heures). Vérifie de nouveau.',
      detail = jsonb_build_object('late', v_late, 'over_hours', v_over, 'truck_id', v_bt)::text;
  end if;
  -- written: the row, its lines, the card, the estimate (as book_job writes them), then the exact move's placing for real
  perform public.book_at_row(p_id, p_job, p_day, v_bt, p_at, p_dur, p_need, p_kind, false);
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    k := k + 1;
    insert into public.job_items (id, job_id, kind, service_id, item_id, description, qty, unit_cents, taxable, duration_min, status, note, sort)
    values (coalesce(nullif(it->>'id', '')::uuid, gen_random_uuid()), p_id, coalesce(nullif(it->>'kind', ''), 'service'), nullif(it->>'service_id', '')::uuid,
      nullif(it->>'item_id', '')::uuid, it->>'description', coalesce((it->>'qty')::numeric, 1), coalesce((it->>'unit_cents')::int, 0),
      coalesce((it->>'taxable')::boolean, true), nullif(it->>'duration_min', '')::int, coalesce(nullif(it->>'status', ''), 'planned'), nullif(it->>'note', ''), k);
  end loop;
  if coalesce((p_job->>'card_on_file')::boolean, false) then
    update public.customers set card_on_file = true where id = nullif(p_job->>'customer_id', '')::uuid and not card_on_file;
  end if;
  if nullif(p_job->>'quote_id', '') is not null then
    update public.quotes set status = 'converted', job_id = p_id where id = (p_job->>'quote_id')::uuid;
  end if;
  v_place := public.exact_place(p_id, p_day, v_bt, p_at, v_ok, true);
  select coalesce(jsonb_agg(jsonb_build_object('id', s->>'id', 'late_min', (s->>'late_min')::int) order by (s->>'order_after')::int), '[]'::jsonb) into v_late
  from jsonb_array_elements(coalesce(v_place->'stops', '[]'::jsonb)) s where s->>'id' <> p_id::text and (s->>'late')::boolean;
  v_over := coalesce((v_place->>'over_hours')::int, 0);
  v_forced := jsonb_array_length(v_late) > 0 or v_over > 0;
  if v_forced then
    -- who was made late by this booking, kept (the office calls them; nobody is texted by it)
    insert into public.activity (actor, entity, entity_id, action, data)
    values (auth.uid(), 'jobs', p_id, 'booked_at', jsonb_build_object('day', p_day, 'at', p_at, 'truck_id', v_bt, 'late', v_late, 'over_hours', v_over));
  end if;
  select * into j from public.jobs where id = p_id;
  return jsonb_build_object('ok', true, 'job_id', p_id, 'truck_id', v_bt, 'forced', v_forced, 'exact', true, 'at', p_at,
    'win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex, 'eta', j.eta_min, 'late', v_late,
    'stops', coalesce(v_place->'stops', '[]'::jsonb), 'over_hours', v_over, 'earliest', v_place->'earliest', 'earliest_keep', v_place->'earliest_keep',
    'rows', jsonb_build_object('jobs', public.block_rows(p_day, 'day'),
                               'job_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.job_items i where i.job_id = p_id)));
end $$;

-- Part 30: book_job, Part 27's text (20261119000200), changed only where it says « Part 30 »
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
  -- Part 30: the minute said (arrive_at), and a preview (book_preview: nothing is ever booked for real)
  v_at int; v_preview boolean := coalesce(current_setting('garage.book_preview', true), '') = 'on';
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
        perform public.fail('bad_block', 'Le garage donne maintenant une plage d’arrivée : choisis une plage au lieu d’un bloc.');
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
  if not found or v_day is null then
    perform public.fail('bad_block', case when v_wm then 'Choisis la date et la plage d’arrivée.' else 'Choisis la date et le bloc : matin, après-midi ou soir.' end);
  end if;
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

  -- Part 30 (« Réserver à l'heure choisie »): window mode, a minute of the day said (arrive_at) and not « flexible »: the
  -- new appointment goes AT that minute on its vehicle, pinned (arrive_at, truck_pinned, as the exact move), its window
  -- cut from that minute (win_for), the other stops keeping their order and their hours (book_at). Blocks mode: the minute
  -- is not read (the booking of before)
  if v_wm and p_job ? 'arrive_at' and jsonb_typeof(p_job->'arrive_at') <> 'null' then
    if jsonb_typeof(p_job->'arrive_at') = 'number' and (p_job->>'arrive_at')::numeric between 0 and 1439
       and (p_job->>'arrive_at')::numeric = floor((p_job->>'arrive_at')::numeric) then
      v_at := (p_job->>'arrive_at')::int;
    else
      perform public.fail('bad_window', 'Cette heure n’est pas bonne : choisis-en une autre.');
    end if;
  end if;
  if v_at is not null and not v_flex then
    v_res := public.book_at(v_id, p_job, p_items, v_day, v_truck, v_at, v_dur, v_need, v_kind, not v_preview);
    return public.op_save(p_op, 'book_job', v_res);
  end if;
  if v_preview then
    -- (book_preview) a preview never books for real: only a minute said, in window mode, is previewed
    perform public.fail('bad_window', 'Choisis une heure d’arrivée pour vérifier la place.');
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
    perform public.fail('truck_full', case when v_wm then 'Ce camion n’a plus de place ce jour-là. Laisse l’app choisir le camion, ou choisis une autre journée.'
      else 'Ce camion n’a plus de place dans ce bloc. Laisse l’app choisir le camion, ou choisis un autre bloc.' end);
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
    if public.eta_known(v_id) then
      update public.jobs set win_start = w.win_start, win_end = w.win_end from public.win_for(v_eta) w where id = v_id;
    else
      -- Part 27 (final-guess G1): roads on, an arrival counted with the fixed unknown time (a trip not measured) is no
      -- window for the customer: the appointment stays « flexible » (the text says « dans la journée ; nous vous confirmons
      -- la veille une plage de 4 heures »), and lock_windows_core cuts its window once its trips are measured
      update public.jobs set win_flex = true where id = v_id;
    end if;
  end if;

  v_res := jsonb_build_object('ok', true, 'job_id', v_id, 'truck_id', v_plan1->'extra'->>'truck', 'forced', v_forced,
    'rows', jsonb_build_object('jobs', public.block_rows(v_day, v_block),
                               'job_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.job_items i where i.job_id = v_id)));
  if v_wm then
    v_res := v_res || (select jsonb_build_object('win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex, 'eta', j.eta_min) from public.jobs j where j.id = v_id);
  end if;
  return public.op_save(p_op, 'book_job', v_res);
end $function$;

-- book_preview(p_job, p_items): what the booking at that minute would do, nothing written (book_job itself, every check of
-- it, inside a block always undone, as move_preview; garage.book_preview: book_at only tries, never writes, so no job number
-- is spent). Window mode and a minute said only; else { ok, exact: false } (the booking of before has no preview). Its
-- refusals are the booking's, thrown (arrive_late with { earliest, earliest_keep, truck_id }, pick_truck, not_allowed of
-- book_job's rights…); who would be late, the truck past its hours and whether this person may force it are SAID
-- (stops, late, over_hours, forced, may_force), never refused
create or replace function public.book_preview(p_job jsonb, p_items jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb; v_done boolean := false;
begin
  if p_job is null or jsonb_typeof(p_job) <> 'object' or jsonb_typeof(p_job->'arrive_at') is distinct from 'number' or not public.windows_on() then
    return jsonb_build_object('ok', true, 'exact', false, 'stops', '[]'::jsonb);
  end if;
  begin
    perform set_config('garage.trial', 'on', true);
    perform set_config('garage.book_preview', 'on', true);
    v_out := public.book_job(null::uuid, p_job, coalesce(p_items, '[]'::jsonb));
    v_done := true;
    raise exception 'book_preview: undone' using errcode = 'P0001', hint = 'preview_undone';
  exception when others then
    if not v_done then raise; end if;
  end;
  return v_out;
end $$;

-- Who may call them: book_job as before (the app); book_preview the app (book_job's own rights inside); the three helpers
-- the server's own. Re-stated, so a copy where one was opened by hand is closed again
revoke all on function public.book_job(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.book_job(uuid, jsonb, jsonb) to authenticated, service_role;
revoke all on function public.book_preview(jsonb, jsonb) from public, anon;
grant execute on function public.book_preview(jsonb, jsonb) to authenticated, service_role;
revoke all on function public.book_at_row(uuid, jsonb, date, uuid, integer, integer, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.book_at_row(uuid, jsonb, date, uuid, integer, integer, boolean, text, boolean) to service_role;
revoke all on function public.book_at_try(uuid, jsonb, date, uuid, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.book_at_try(uuid, jsonb, date, uuid, integer, integer, boolean, text) to service_role;
revoke all on function public.book_at(uuid, jsonb, jsonb, date, uuid, integer, integer, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.book_at(uuid, jsonb, jsonb, date, uuid, integer, integer, boolean, text, boolean) to service_role;
