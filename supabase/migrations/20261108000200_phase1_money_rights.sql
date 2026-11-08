-- Part 25: phase 1 of the audit of 2026-11-08 — money and rights.
--   invoice_totals      an issued invoice keeps its totals whoever touches the row (before: only when the change came
--                       through an RPC; a re-send by the server recomputed the taxes of a legally issued invoice with
--                       today's rates)
--   jobs column grants  the app may no longer change duration_min or deleted_at directly (set_job_duration re-plans
--                       and checks the room; nothing in the app deletes a job)
--   fold_name(text)     a name without accents, capitals or punctuation, to compare two names
--   web_book(p)         a customer with the same phone number is the same customer only when the first or the last name
--                       matches too; otherwise a new file is made and marked « same number as another customer » for the
--                       office to check. An existing file is never changed from the public form (no email written).
--   housekeeping        the activity log is kept 24 months

create or replace function public.invoice_totals() returns trigger language plpgsql security definer set search_path = public as $$
declare tx jsonb := (select taxes from public.settings where id = 1); l jsonb; s int := 0; taxable int := 0; lt int; lines jsonb := '[]';
begin
  if tg_op = 'UPDATE' and old.status <> 'draft' and new.lines = old.lines then
    return new;  -- payment, cancel, re-send… on a finished invoice: its totals stay as issued
  end if;
  for l in select * from jsonb_array_elements(coalesce(new.lines, '[]')) loop
    lt := round(coalesce((l->>'qty')::numeric, 1) * coalesce((l->>'unit_cents')::numeric, 0))::int;
    if l->>'kind' = 'discount' and lt > 0 then lt := -lt; end if;
    s := s + lt;
    if coalesce((l->>'taxable')::boolean, true) then taxable := taxable + lt; end if;
    lines := lines || jsonb_build_array(l || jsonb_build_object('total_cents', lt));
  end loop;
  new.lines := lines;
  new.subtotal_cents := s;
  new.taxable_cents := greatest(taxable, 0);
  if new.taxes_on and coalesce((tx->>'enabled')::boolean, true) and taxable > 0 then
    new.tps_cents := round(taxable * coalesce((tx->>'tps')::numeric, 0.05));
    new.tvq_cents := round(taxable * coalesce((tx->>'tvq')::numeric, 0.09975));
  else
    new.tps_cents := 0; new.tvq_cents := 0;
  end if;
  new.total_cents := s + new.tps_cents + new.tvq_cents;
  return new;
end $$;

revoke update (duration_min, deleted_at) on public.jobs from authenticated;

create or replace function public.fold_name(s text) returns text language sql immutable as $$
  select nullif(trim(regexp_replace(translate(lower(coalesce(s, '')), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœ', 'aaaaaaceeeeiiiinooooouuuuyyo'), '[^a-z0-9]+', ' ', 'g')), '')
$$;

create or replace function public.housekeeping() returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select staff_id from public.shifts where ended_at is null and deleted_at is null and started_at < now() - interval '16 hours' loop
    perform public.close_day(r.staff_id);
  end loop;
  update public.trips set status = 'cancelled', ended_at = now() where status = 'active' and expires_at < now();
  delete from public.position_log where at < now() - interval '30 days';
  delete from public.op_log where at < now() - interval '60 days';
  delete from public.activity where at < now() - interval '24 months';
end $$;

/* web_book(p): p = { first_name, last_name, phone, email?, lang, address, unit?, city?, postal_code?, lat, lng,
     vehicle: { year?, make?, model? }, services: [uuid], day, block, problem?, ip?, token_hash? }
   The customer: the same phone number AND the same first (or last) name is the same customer (their file is not
   changed, the job keeps the address typed); the same number with another name is a new file, marked for the office;
   else a new customer. The car: the same year, make and model in their file, else a new one.
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
  v_new boolean := false; v_shared boolean := false; v_again uuid; v_again_cust uuid;
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
  -- the customer: the same phone number and the same first (or last) name; their file is never changed from here
  select c.id into v_cust from public.customers c
  where c.phone_digits = v_digits and c.deleted_at is null
    and (public.fold_name(c.first_name) = public.fold_name(v_first) or (v_last is not null and public.fold_name(c.last_name) = public.fold_name(v_last)))
  order by c.updated_at desc limit 1;
  if v_cust is null then
    v_new := true;
    v_shared := exists (select 1 from public.customers c where c.phone_digits = v_digits and c.deleted_at is null);
    insert into public.customers (first_name, last_name, phone, email, lang, address, unit, city, postal_code, lat, lng, notes, created_by)
    values (v_first, v_last, substr(v_digits, 1, 3) || ' ' || substr(v_digits, 4, 3) || '-' || substr(v_digits, 7), v_email, v_lang, v_addr,
      left(nullif(trim(p->>'unit'), ''), 20), left(nullif(trim(p->>'city'), ''), 80), left(nullif(trim(p->>'postal_code'), ''), 10), v_lat, v_lng,
      case when v_shared then 'Client créé par la réservation en ligne. Même numéro de téléphone qu’un autre client : à vérifier (fusionner au besoin).'
           else 'Client créé par la réservation en ligne.' end, null)
    returning id into v_cust;
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
    left(nullif(trim(p->>'problem'), ''), 1000),
    case when v_shared then 'Réservé en ligne par le client (même numéro qu’un autre client : vérifier le dossier).' else 'Réservé en ligne par le client.' end,
    v_addr, left(nullif(trim(p->>'unit'), ''), 20), left(nullif(trim(p->>'postal_code'), ''), 10), v_lat, v_lng, 'web', null);
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
  values ('job', v_id, 'web_booked', jsonb_build_object('customer_new', v_new, 'shared_phone', v_shared, 'ip', left(p->>'ip', 64)));
  return jsonb_build_object('ok', true, 'job_id', v_id, 'customer_id', v_cust, 'new_customer', v_new, 'shared_phone', v_shared, 'day', v_day, 'block', v_block, 'again', false);
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array['web_book', 'housekeeping'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
grant execute on function public.fold_name(text) to authenticated, anon, service_role;
