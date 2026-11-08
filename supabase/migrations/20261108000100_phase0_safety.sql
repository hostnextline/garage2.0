-- Part 24: the safety fixes of the audit of 2026-11-08 (phase 0).
--   block_open(day, block)   true while the block has not started: the one rule for « may this block still be re-planned »
--   replan_block             leaves a block that has started (or is past) as it is. Before: cancelling a job at 11:20 re-planned
--                            the morning from « now », the truck with little time left was dropped, and the mechanic's other
--                            morning jobs went to « À placer » (gone from « Ma journée »). replan_days already had the rule.
--   set_job_duration         the same rule (a longer job in a started block: the length changes, nothing moves)
--   rate_limits, rate_hit()  a shared brake for the public server functions (« slots » and « book » of the online booking)
--   web_book(p)              the customer's link is made inside the booking (p.token_hash), so a failure after the booking
--                            can never leave a job without its link; the same booking sent again within 10 minutes (the page
--                            retried) returns the job already made (again: true) instead of a second one; the brakes are
--                            counted under a lock (30 requests at once cannot all pass)
--   web_suggest              at most 14 days per call
--   remove_member(staff)     « Retirer » someone in one transaction (day closed, truck freed, account inactive)

-- ---------- the one rule for « this block may still be re-planned » ----------
create or replace function public.block_open(p_day date, p_block text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare b record;
begin
  if p_day is null then return false; end if;
  if p_day > public.local_today() then return true; end if;
  if p_day < public.local_today() then return false; end if;
  select * into b from public.blocks() x where x.key = p_block;
  if not found then return false; end if;
  return public.now_min() < b.start_min;
end $$;

create or replace function public.replan_block(p_day date, p_block text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_plan jsonb;
begin
  -- a block already started (or past) is left as it is: its jobs stay on their truck, in their order
  if not public.block_open(p_day, p_block) then return jsonb_build_object('skipped', true, 'day', p_day, 'block', p_block); end if;
  perform public.lock_block(p_day, p_block);
  v_plan := public.plan_block(p_day, p_block);
  perform public.apply_plan(v_plan);
  return v_plan;
end $$;

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
  if j.status = 'booked' and public.block_open(j.day, j.block) then
    perform public.lock_block(j.day, j.block);
    select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into v_lat, v_lng from public.customers c where c.id = j.customer_id;
    v_plan := public.plan_block(j.day, j.block, jsonb_build_object('id', j.id, 'lat', v_lat, 'lng', v_lng, 'dur', p_duration, 'truck', case when j.truck_pinned then j.truck_id end), j.id);
    if p_duration > j.duration_min and not coalesce((v_plan->'extra'->>'placed')::boolean, false) then
      perform public.fail('block_full', 'Avec cette durée, la job ne rentre plus dans le bloc. Déplace-la ou raccourcis-la.');
    end if;
    update public.jobs set duration_min = p_duration where id = j.id;
    perform public.apply_plan(public.plan_block(j.day, j.block));
  else
    -- a started block, or a job no longer booked: the length changes, nothing moves
    update public.jobs set duration_min = p_duration where id = j.id;
  end if;
  v_res := jsonb_build_object('ok', true, 'rows', jsonb_build_object('jobs', public.block_rows(j.day, j.block)));
  return public.op_save(p_op, 'set_job_duration', v_res);
end $$;

-- ---------- a shared brake for the public server functions ----------
-- rate_hit('slots:<who>', 600, 20): true while this key was hit at most 20 times in the current 10-minute window
create table if not exists public.rate_limits (
  key text not null,
  bucket bigint not null,
  n int not null default 0,
  at timestamptz not null default now(),
  primary key (key, bucket)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;

create or replace function public.rate_hit(p_key text, p_window_sec int, p_max int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_bucket bigint := floor(extract(epoch from now()) / greatest(1, p_window_sec)); v_n int;
begin
  insert into public.rate_limits (key, bucket, n) values (left(coalesce(p_key, ''), 120), v_bucket, 1)
  on conflict (key, bucket) do update set n = public.rate_limits.n + 1, at = now()
  returning n into v_n;
  if random() < 0.01 then delete from public.rate_limits where at < now() - interval '2 days'; end if;
  return v_n <= p_max;
end $$;

-- ---------- online booking ----------
create or replace function public.web_suggest(p_lat double precision, p_lng double precision, p_services uuid[],
  p_from date default null, p_days int default 14, p_limit int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_horizon int := public.bset('horizon_days', 120)::int; v_from date := greatest(coalesce(p_from, public.local_today()), public.local_today());
begin
  if not public.web_on() then perform public.fail('web_off', 'La réservation en ligne est fermée pour le moment. Appelez le garage.'); end if;
  if not public.web_in_area(p_lat, p_lng) then perform public.fail('far', 'Cette adresse est en dehors de notre secteur. Appelez le garage.'); end if;
  if coalesce(cardinality(p_services), 0) = 0 then perform public.fail('no_service', 'Choisissez au moins un service.'); end if;
  if v_from > public.local_today() + v_horizon then return '[]'::jsonb; end if;
  -- at most 14 days per call: each day costs up to six plans
  return public.suggest_core(p_lat, p_lng, public.web_duration(p_services), v_from,
    least(greatest(1, p_days), 14, v_horizon - (v_from - public.local_today()) + 1), null, least(greatest(1, p_limit), 12));
end $$;

/* web_book(p): p = { first_name, last_name, phone, email?, lang, address, unit?, city?, postal_code?, lat, lng,
     vehicle: { year?, make?, model? }, services: [uuid], day, block, problem?, ip?, token_hash? }
   A customer with the same phone number is the same customer (their file is not changed, the job keeps the address
   typed); else a new customer. The car: the same year, make and model in their file, else a new one.
   token_hash: the hash of the customer's link, kept with the job in the same transaction.
   The same booking again within 10 minutes (same phone, day, block, address and services) is the job already made. */
create or replace function public.web_book(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_first text := left(nullif(trim(p->>'first_name'), ''), 80);
  v_last text := left(nullif(trim(p->>'last_name'), ''), 80);
  v_digits text := right(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), 10);
  v_email text := lower(left(nullif(trim(p->>'email'), ''), 160));
  v_lang text := case when p->>'lang' = 'en' then 'en' else 'fr' end;
  v_addr text := left(nullif(trim(p->>'address'), ''), 200);
  v_lat double precision := nullif(p->>'lat', '')::double precision;
  v_lng double precision := nullif(p->>'lng', '')::double precision;
  v_day date := nullif(p->>'day', '')::date;
  v_block text := p->>'block';
  v_hash text := left(nullif(trim(p->>'token_hash'), ''), 128);
  v_services uuid[];
  v_year int := nullif(regexp_replace(coalesce(p->'vehicle'->>'year', ''), '\D', '', 'g'), '')::int;
  v_make text := left(nullif(trim(p->'vehicle'->>'make'), ''), 60);
  v_model text := left(nullif(trim(p->'vehicle'->>'model'), ''), 60);
  v_cust uuid; v_veh uuid; v_id uuid := gen_random_uuid(); v_dur int; b record; v_plan0 jsonb; v_plan1 jsonb; k int := 0; s record;
  v_new boolean := false; v_again uuid; v_again_cust uuid;
begin
  if not public.web_on() then perform public.fail('web_off', 'La réservation en ligne est fermée pour le moment. Appelez le garage.'); end if;
  if v_first is null then perform public.fail('name', 'Écrivez votre prénom.'); end if;
  if v_digits !~ '^[2-9]\d{2}[2-9]\d{6}$' then perform public.fail('phone', 'Écrivez un numéro de téléphone à 10 chiffres.'); end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public.fail('email', 'Ce courriel ne semble pas bon.'); end if;
  if v_addr is null or not public.web_in_area(v_lat, v_lng) then perform public.fail('far', 'Choisissez votre adresse dans la liste (dans notre secteur).'); end if;
  if v_year is not null and (v_year < 1950 or v_year > extract(year from public.local_today())::int + 2) then v_year := null; end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_services
    from jsonb_array_elements_text(coalesce(p->'services', '[]'::jsonb)) x where x ~* '^[0-9a-f-]{36}$';
  if cardinality(v_services) = 0 or cardinality(v_services) > 10
     or exists (select 1 from unnest(v_services) u where not exists (select 1 from jsonb_array_elements(public.web_services()) w where (w->>'id')::uuid = u)) then
    perform public.fail('no_service', 'Choisissez au moins un service de la liste.');
  end if;
  select * into b from public.blocks() x where x.key = v_block;
  if not found or v_day is null then perform public.fail('bad_block', 'Choisissez une date dans la liste.'); end if;
  if v_day < public.local_today() or (v_day = public.local_today() and public.now_min() >= b.start_min) then
    perform public.fail('block_full', 'Ce moment n’est plus libre. Choisissez-en un autre.');
  end if;
  if v_day > public.local_today() + public.bset('horizon_days', 120)::int then perform public.fail('bad_block', 'Cette date est trop loin.'); end if;

  -- one customer at a time per phone number (the brakes and the « again » check are counted under this lock)
  perform pg_advisory_xact_lock(hashtext('web:' || v_digits));

  -- the same booking sent again (the page retried after a hiccup): the job already made, never a second one
  select j.id, j.customer_id into v_again, v_again_cust from public.jobs j join public.customers c on c.id = j.customer_id
  where c.phone_digits = v_digits and j.source = 'web' and j.status = 'booked' and j.deleted_at is null
    and j.day = v_day and j.block = v_block and lower(coalesce(j.address, '')) = lower(v_addr) and j.created_at > now() - interval '10 minutes'
    and (select coalesce(array_agg(ji.service_id order by ji.service_id), '{}'::uuid[]) from public.job_items ji
         where ji.job_id = j.id and ji.deleted_at is null and ji.service_id is not null)
        = (select array_agg(u order by u) from unnest(v_services) u)
  order by j.created_at desc limit 1;
  if v_again is not null then
    if v_hash is not null then
      insert into public.public_links (token_hash, job_id, quote_id, expires_at, created_by) values (v_hash, v_again, null, now() + interval '90 days', null)
      on conflict (token_hash) do nothing;
    end if;
    return jsonb_build_object('ok', true, 'job_id', v_again, 'customer_id', v_again_cust, 'new_customer', false, 'day', v_day, 'block', v_block, 'again', true);
  end if;

  -- a brake on mistakes and pranks: 2 coming appointments booked online per phone number, 30 an hour in all
  if (select count(*) from public.jobs j join public.customers c on c.id = j.customer_id
      where c.phone_digits = v_digits and j.source = 'web' and j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today()) >= 2 then
    perform public.fail('too_many', 'Vous avez déjà des rendez-vous à venir. Pour en ajouter, appelez le garage.');
  end if;
  perform pg_advisory_xact_lock(hashtext('web:all'));
  if (select count(*) from public.jobs j where j.source = 'web' and j.created_at > now() - interval '1 hour') >= 30 then
    perform public.fail('busy', 'Trop de réservations en même temps. Réessayez dans quelques minutes ou appelez le garage.');
  end if;

  v_dur := public.web_duration(v_services);
  perform public.lock_block(v_day, v_block);
  v_plan0 := public.plan_block(v_day, v_block);
  v_plan1 := public.plan_block(v_day, v_block, jsonb_build_object('id', v_id, 'lat', v_lat, 'lng', v_lng, 'dur', v_dur));
  if jsonb_array_length(v_plan1->'trucks') = 0
     or not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o))
     or exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_plan1->'extra'->>'truck' and (x->>'left')::int < 0) then
    perform public.fail('block_full', 'Ce moment vient d’être pris. Choisissez-en un autre.');
  end if;

  perform set_config('garage.rpc', 'on', true);
  -- the customer: the same phone number, else a new file
  select c.id into v_cust from public.customers c where c.phone_digits = v_digits and c.deleted_at is null order by c.updated_at desc limit 1;
  if v_cust is null then
    v_new := true;
    insert into public.customers (first_name, last_name, phone, email, lang, address, unit, city, postal_code, lat, lng, notes, created_by)
    values (v_first, v_last, substr(v_digits, 1, 3) || ' ' || substr(v_digits, 4, 3) || '-' || substr(v_digits, 7), v_email, v_lang, v_addr,
      left(nullif(trim(p->>'unit'), ''), 20), left(nullif(trim(p->>'city'), ''), 80), left(nullif(trim(p->>'postal_code'), ''), 10), v_lat, v_lng,
      'Client créé par la réservation en ligne.', null)
    returning id into v_cust;
  elsif v_email is not null then
    update public.customers set email = v_email where id = v_cust and email is null;
  end if;
  -- the car
  if v_make is not null or v_model is not null then
    select v.id into v_veh from public.vehicles v where v.customer_id = v_cust and v.deleted_at is null
      and lower(coalesce(v.make, '')) = lower(coalesce(v_make, '')) and lower(coalesce(v.model, '')) = lower(coalesce(v_model, ''))
      and (v_year is null or v.year is null or v.year = v_year)
      order by v.updated_at desc limit 1;
    if v_veh is null then
      insert into public.vehicles (customer_id, year, make, model, created_by) values (v_cust, v_year, v_make, v_model, null) returning id into v_veh;
    end if;
  end if;

  insert into public.jobs (id, customer_id, vehicle_id, day, block, truck_id, truck_pinned, forced, duration_min, status, problem, notes,
    address, unit, postal_code, lat, lng, source, created_by)
  values (v_id, v_cust, v_veh, v_day, v_block, (v_plan1->'extra'->>'truck')::uuid, false, false, v_dur, 'booked',
    left(nullif(trim(p->>'problem'), ''), 1000), 'Réservé en ligne par le client.', v_addr, left(nullif(trim(p->>'unit'), ''), 20),
    left(nullif(trim(p->>'postal_code'), ''), 10), v_lat, v_lng, 'web', null);
  for s in select sv.* from public.services sv where sv.id = any(v_services) order by sv.is_promo desc, sv.sort, sv.name_fr loop
    k := k + 1;
    insert into public.job_items (job_id, kind, service_id, description, qty, unit_cents, taxable, duration_min, status, sort, created_by)
    values (v_id, 'service', s.id, case when v_lang = 'en' then coalesce(nullif(s.name_en, ''), s.name_fr) else s.name_fr end, 1,
      coalesce(s.price_cents, 0), s.taxable, s.duration_min, 'planned', k, null);
  end loop;
  -- the customer's link, in the same transaction as the booking
  if v_hash is not null then
    insert into public.public_links (token_hash, job_id, quote_id, expires_at, created_by) values (v_hash, v_id, null, now() + interval '90 days', null);
  end if;
  perform public.apply_plan(v_plan1);
  insert into public.activity (entity, entity_id, action, data)
  values ('job', v_id, 'web_booked', jsonb_build_object('customer_new', v_new, 'ip', left(p->>'ip', 64)));
  return jsonb_build_object('ok', true, 'job_id', v_id, 'customer_id', v_cust, 'new_customer', v_new, 'day', v_day, 'block', v_block, 'again', false);
end $$;

-- ---------- « Retirer » someone from the team, in one transaction ----------
create or replace function public.remove_member(p_staff uuid) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.staff where id = p_staff) then return false; end if;
  perform set_config('garage.rpc', 'on', true);
  -- the day closes, the truck is free, the account can no longer act; jobs and invoices stay
  perform public.close_day(p_staff);
  update public.trucks set driver_id = null where driver_id = p_staff;
  update public.staff set active = false, deleted_at = now() where id = p_staff;
  return true;
end $$;

-- only the server's own functions call these (Part 13: the building blocks are not open to the app)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array['block_open', 'rate_hit', 'remove_member', 'replan_block', 'web_suggest', 'web_book'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
