-- Part 30, THE WAY BACK (ops/live/PARTIE30.md §5): book_job put back as it was BEFORE Part 30, byte for byte: Part 27's text
-- (20261119000200; ops/tests/fichiers.test.mjs checks it against that file), with its rights. « create or replace » and
-- « revoke » only: no drop, no delete; no row is written. The four functions Part 30 adds stay (never dropped): book_at,
-- book_at_row and book_at_try are the server's own and nothing calls them any more; book_preview is CLOSED to the app here
-- (Part 27's book_job does not know the preview: a phone still on the new app would book for real inside its undone block
-- and spend a job number), so such a phone is told « pas pu vérifier » and books as before. The line of
-- supabase_migrations.schema_migrations stays (never deleted): to install Part 30 again later, run the body of
-- 20261122000300_reserver_heure.sql again (its own « create or replace » and grants), without a second insert into
-- schema_migrations.
-- What stays after it (harmless): the appointments booked at a minute (arrive_at, truck_pinned): Part 27's planner reads them
-- as an exact move's, and the activity rows « booked_at ».
-- Run as ONE block (the SQL editor runs the whole text in one transaction): first in a try that ends by « rollback; », then
-- for real.
begin;

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

revoke all on function public.book_job(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.book_job(uuid, jsonb, jsonb) to authenticated, service_role;
revoke all on function public.book_preview(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.book_preview(jsonb, jsonb) to service_role;
-- the control: book_job no longer says « Part 30 », and the app may no longer ask the preview
do $$ begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'book_job' and p.prosrc like '%Part 30%') then
    raise exception 'ARRÊT : book_job dit encore « Part 30 »';
  end if;
  if has_function_privilege('authenticated', 'public.book_preview(jsonb, jsonb)', 'execute') then
    raise exception 'ARRÊT : book_preview est encore ouverte à l''app';
  end if;
end $$;
commit;
