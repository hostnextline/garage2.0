-- Part 23: « Réserver en ligne ». One public link (client.html#reserver) where any customer picks the services, gives the
-- address, chooses one of the best blocks (where a truck already goes nearby, as soon as possible) and books it.
-- Only the server function « book » calls these (service role): the public never reaches the tables.
--   settings.booking.web = { on: true|false }          (Réglages → Réservations → « Réservation en ligne »)
--   web_services()                                      the services offered (active, not past their promo date)
--   web_suggest(lat, lng, duration, from, days, limit)  the best blocks (same ranking as suggest_blocks)
--   web_book(p)                                         finds or creates the customer (by phone) and the car, books

update public.settings set booking = booking || jsonb_build_object('web', jsonb_build_object('on', true))
where id = 1 and not (booking ? 'web');

-- the ranking of suggest_blocks, without the check of who asks (the callers check)
create or replace function public.suggest_core(p_lat double precision, p_lng double precision, p_duration int,
  p_from date default null, p_days int default 14, p_exclude uuid default null, p_limit int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date; b record; v_from date := greatest(coalesce(p_from, public.local_today()), public.local_today());
  p0 jsonb; p1 jsonb; out jsonb := '[]'; used0 int; used1 int; near int; v_near numeric := public.bset('near_km', 5);
  x uuid := '00000000-0000-4000-8000-000000000000';
begin
  for d in select generate_series(v_from, v_from + greatest(1, least(p_days, 60)) - 1, interval '1 day')::date loop
    for b in select * from public.blocks() loop
      if d = public.local_today() and public.now_min() >= b.start_min then continue; end if;
      p0 := public.plan_block(d, b.key, null, p_exclude);
      if jsonb_array_length(p0->'trucks') = 0 then continue; end if;
      p1 := public.plan_block(d, b.key, jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', p_duration), p_exclude);
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
      out := out || jsonb_build_array(jsonb_build_object('day', d, 'block', b.key, 'pos', b.pos, 'drive_min', greatest(0, used1 - used0 - p_duration),
        'near', near, 'truck', p1->'extra'->>'truck', 'left', (select max((t->>'left')::int) from jsonb_array_elements(p1->'trucks') t)));
    end loop;
  end loop;
  return coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(out) e
    order by (e->>'drive_min')::int, (e->>'near')::int desc, e->>'day', (e->>'pos')::int limit greatest(1, p_limit)) q), '[]'::jsonb);
end $$;

create or replace function public.suggest_blocks(p_lat double precision, p_lng double precision, p_duration int,
  p_from date default null, p_days int default 14, p_exclude uuid default null, p_limit int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return '[]'; end if;
  return public.suggest_core(p_lat, p_lng, p_duration, p_from, p_days, p_exclude, p_limit);
end $$;

create or replace function public.web_on() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (s.booking->'web'->>'on')::boolean from public.settings s where s.id = 1), false)
$$;

-- the services a customer may choose online
create or replace function public.web_services() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name_fr', s.name_fr, 'name_en', coalesce(nullif(s.name_en, ''), s.name_fr),
    'category', s.category, 'price_cents', s.price_cents, 'taxable', s.taxable, 'duration_min', s.duration_min, 'promo', s.is_promo, 'promo_until', s.promo_until,
    'includes', s.includes) order by s.is_promo desc, s.sort, s.name_fr), '[]'::jsonb)
  from public.services s
  where s.active and s.deleted_at is null and (s.promo_until is null or s.promo_until >= public.local_today())
    and coalesce(s.price_cents, 0) >= 0
$$;

-- how long the work takes: the services chosen (at least 15 minutes, at most 8 hours)
create or replace function public.web_duration(p_services uuid[]) returns int language sql stable security definer set search_path = public as $$
  select greatest(15, least(480, coalesce(sum(s.duration_min), 60)))::int from public.services s
  where s.id = any(p_services) and s.active and s.deleted_at is null
$$;

-- the address is in the garage's area: at most max_km (default 60) from « Départ des camions »
create or replace function public.web_in_area(p_lat double precision, p_lng double precision) returns boolean
language sql stable security definer set search_path = public as $$
  select p_lat is not null and p_lng is not null and p_lat between -90 and 90 and p_lng between -180 and 180
    and public.km_between(h.lat, h.lng, p_lat, p_lng) <= coalesce((select (s.booking->'web'->>'max_km')::numeric from public.settings s where s.id = 1), 60)
  from public.home_point() h
$$;

-- the best blocks for an address online: the next p_days days, or the days after p_from
create or replace function public.web_suggest(p_lat double precision, p_lng double precision, p_services uuid[],
  p_from date default null, p_days int default 14, p_limit int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_horizon int := public.bset('horizon_days', 120)::int; v_from date := greatest(coalesce(p_from, public.local_today()), public.local_today());
begin
  if not public.web_on() then perform public.fail('web_off', 'La réservation en ligne est fermée pour le moment. Appelez le garage.'); end if;
  if not public.web_in_area(p_lat, p_lng) then perform public.fail('far', 'Cette adresse est en dehors de notre secteur. Appelez le garage.'); end if;
  if coalesce(cardinality(p_services), 0) = 0 then perform public.fail('no_service', 'Choisissez au moins un service.'); end if;
  if v_from > public.local_today() + v_horizon then return '[]'::jsonb; end if;
  return public.suggest_core(p_lat, p_lng, public.web_duration(p_services), v_from,
    least(greatest(1, p_days), v_horizon - (v_from - public.local_today()) + 1), null, least(greatest(1, p_limit), 12));
end $$;

/* web_book(p): p = { first_name, last_name, phone, email?, lang, address, unit?, city?, postal_code?, lat, lng,
     vehicle: { year?, make?, model? }, services: [uuid], day, block, problem?, ip? }
   A customer with the same phone number is the same customer (their file is not changed, the job keeps the address
   typed); else a new customer. The car: the same year, make and model in their file, else a new one. */
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
  v_services uuid[];
  v_year int := nullif(regexp_replace(coalesce(p->'vehicle'->>'year', ''), '\D', '', 'g'), '')::int;
  v_make text := left(nullif(trim(p->'vehicle'->>'make'), ''), 60);
  v_model text := left(nullif(trim(p->'vehicle'->>'model'), ''), 60);
  v_cust uuid; v_veh uuid; v_id uuid := gen_random_uuid(); v_dur int; b record; v_plan0 jsonb; v_plan1 jsonb; k int := 0; s record;
  v_new boolean := false;
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

  -- a brake on mistakes and pranks: 2 coming appointments booked online per phone number, 30 an hour in all
  if (select count(*) from public.jobs j join public.customers c on c.id = j.customer_id
      where c.phone_digits = v_digits and j.source = 'web' and j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today()) >= 2 then
    perform public.fail('too_many', 'Vous avez déjà des rendez-vous à venir. Pour en ajouter, appelez le garage.');
  end if;
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
  perform public.apply_plan(v_plan1);
  insert into public.activity (entity, entity_id, action, data)
  values ('job', v_id, 'web_booked', jsonb_build_object('customer_new', v_new, 'ip', left(p->>'ip', 64)));
  return jsonb_build_object('ok', true, 'job_id', v_id, 'customer_id', v_cust, 'new_customer', v_new, 'day', v_day, 'block', v_block);
end $$;

-- only the server function « book » calls them (Part 13: the server's building blocks are not open to the app)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array['suggest_core', 'web_on', 'web_services', 'web_duration', 'web_in_area', 'web_suggest', 'web_book'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
grant execute on function public.suggest_blocks(double precision, double precision, int, date, int, uuid, int) to authenticated;
