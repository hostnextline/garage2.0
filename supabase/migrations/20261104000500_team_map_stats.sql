-- Part 5: what each person may do, the mechanic's day (positions only between « Commencer ma journée » and « Fin de
-- journée »), the team map, the dashboard, the treasury report, the history of changes, the public tracking page.

-- ---------- access ----------
create or replace function public.my_access() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'full_name', s.full_name, 'short_name', s.short_name, 'email', s.email, 'phone', s.phone, 'roles', to_jsonb(s.roles),
    'owner', 'owner' = any(s.roles), 'lang', s.lang, 'prefs', s.prefs, 'color', s.color,
    'rights', (select jsonb_object_agg(r, public.right_of(s, r)) from unnest(public.all_rights()) r),
    'trucks', to_jsonb(public.my_truck_ids()))
  from public.staff s where s.id = auth.uid() and s.active and s.deleted_at is null
$$;
-- for « Voir l'app comme… » and the rights screen: what someone else may do (owner only)
create or replace function public.access_of(p_staff uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_owner() then null else (
    select jsonb_build_object('id', s.id, 'full_name', s.full_name, 'roles', to_jsonb(s.roles),
      'rights', (select jsonb_object_agg(r, public.right_of(s, r)) from unnest(public.all_rights()) r),
      'trucks', (select coalesce(jsonb_agg(t.id), '[]'::jsonb) from public.trucks t where t.driver_id = s.id and t.deleted_at is null))
    from public.staff s where s.id = p_staff) end
$$;
create or replace function public.rights_table() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'rights', to_jsonb(public.all_rights()),
    'rules', (select jsonb_object_agg(ro, (select jsonb_object_agg(r, coalesce(public.right_rule(ro, r), 'never')) from unnest(public.all_rights()) r))
              from unnest(array['office','mechanic','treasurer']) ro),
    'defaults', (select jsonb_object_agg(ro, (select jsonb_object_agg(r, coalesce((st.role_rights->ro->>r)::boolean, public.right_default(ro, r))) from unnest(public.all_rights()) r))
              from unnest(array['office','mechanic','treasurer']) ro, public.settings st where st.id = 1))
$$;
create or replace function public.set_role_rights(p_op uuid, p_role text, p_right text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op);
begin
  if v_done is not null then return v_done; end if;
  if not public.is_owner() then perform public.fail('not_allowed', 'Seul le propriétaire change les droits.'); end if;
  if p_role not in ('office','mechanic','treasurer') or not (p_right = any(public.all_rights())) then perform public.fail('bad_right', 'Droit inconnu.'); end if;
  if public.right_rule(p_role, p_right) is distinct from 'can' then perform public.fail('fixed', 'Ce droit ne se change pas pour ce rôle.'); end if;
  perform set_config('garage.rpc', 'on', true);
  update public.settings set role_rights = jsonb_set(coalesce(role_rights, '{}'), array[p_role], coalesce(role_rights->p_role, '{}') || jsonb_build_object(p_right, p_on)) where id = 1;
  return public.op_save(p_op, 'set_role_rights', jsonb_build_object('ok', true, 'rows', jsonb_build_object('settings', (select jsonb_agg(to_jsonb(s)) from public.settings s))));
end $$;

-- the owner changes someone's name, roles, rights, colour, access. There is always one owner left.
create or replace function public.member_update(p_op uuid, p_staff uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); s public.staff; v_roles text[]; v_active boolean;
begin
  if v_done is not null then return v_done; end if;
  if not public.is_owner() then perform public.fail('not_allowed', 'Seul le propriétaire gère l’équipe.'); end if;
  select * into s from public.staff where id = p_staff and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cette personne n’existe plus.'); end if;
  v_roles := coalesce((select array_agg(x) from jsonb_array_elements_text(p_patch->'roles') x), s.roles);
  v_active := coalesce((p_patch->>'active')::boolean, s.active);
  if cardinality(v_roles) = 0 then perform public.fail('no_role', 'Coche au moins un rôle.'); end if;
  if ('owner' = any(s.roles) and s.active) and (not ('owner' = any(v_roles)) or not v_active)
     and not exists (select 1 from public.staff o where o.id <> s.id and o.active and o.deleted_at is null and 'owner' = any(o.roles)) then
    perform public.fail('last_owner', 'Il faut garder au moins un propriétaire.');
  end if;
  update public.staff set
    full_name = coalesce(nullif(trim(p_patch->>'full_name'), ''), full_name),
    short_name = case when p_patch ? 'short_name' then nullif(trim(p_patch->>'short_name'), '') else short_name end,
    phone = case when p_patch ? 'phone' then nullif(trim(p_patch->>'phone'), '') else phone end,
    color = case when p_patch ? 'color' then nullif(p_patch->>'color', '') else color end,
    roles = v_roles,
    rights = case when p_patch ? 'rights' then coalesce(p_patch->'rights', '{}') else rights end,
    active = v_active
  where id = s.id;
  -- a blocked person can no longer sign in; their day is closed
  update auth.users set banned_until = case when v_active then null else 'infinity'::timestamptz end where id = s.id;
  if not v_active then perform public.close_day(s.id); end if;
  return public.op_save(p_op, 'member_update', jsonb_build_object('ok', true, 'rows', jsonb_build_object('staff', (select jsonb_agg(to_jsonb(x)) from public.staff x where x.id = s.id))));
end $$;

-- each person changes only their own phone, language and preferences
create or replace function public.update_me(p_patch jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi.'); end if;
  update public.staff set
    phone = case when p_patch ? 'phone' then nullif(trim(p_patch->>'phone'), '') else phone end,
    lang = case when p_patch->>'lang' in ('fr','en') then p_patch->>'lang' else lang end,
    prefs = case when jsonb_typeof(p_patch->'prefs') = 'object' then prefs || (p_patch->'prefs') else prefs end,
    last_seen_at = now()
  where id = auth.uid();
  return jsonb_build_object('ok', true, 'rows', jsonb_build_object('staff', (select jsonb_agg(to_jsonb(x)) from public.staff x where x.id = auth.uid())));
end $$;

-- ---------- the mechanic's day ----------
create or replace function public.close_day(p_staff uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.shifts set ended_at = now() where staff_id = p_staff and ended_at is null and deleted_at is null;
  update public.positions set deleted_at = now() where id = p_staff and deleted_at is null;
  update public.trips set status = 'cancelled', ended_at = now() where staff_id = p_staff and status = 'active';
end $$;
create or replace function public.shift_start() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi.'); end if;
  insert into public.shifts (staff_id, created_by) select auth.uid(), auth.uid()
  where not exists (select 1 from public.shifts where staff_id = auth.uid() and ended_at is null and deleted_at is null);
  delete from public.position_log where at < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'rows', jsonb_build_object('shifts', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.shifts s where s.staff_id = auth.uid() and s.ended_at is null)));
end $$;
create or replace function public.shift_end() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi.'); end if;
  perform public.close_day(auth.uid());
  return jsonb_build_object('ok', true, 'rows', jsonb_build_object(
    'shifts', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.shifts s where s.staff_id = auth.uid() and s.started_at > now() - interval '1 day'),
    'positions', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.positions p where p.id = auth.uid()),
    'trips', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.trips t where t.staff_id = auth.uid() and t.started_at > now() - interval '1 day')));
end $$;
-- a position is kept only during the day; the path keeps a point every 25 m or 60 s
create or replace function public.report_position(p_lat double precision, p_lng double precision, p_accuracy int default null,
  p_heading int default null, p_speed int default null, p_job uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare last record;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'reason', 'not_staff'); end if;
  if not exists (select 1 from public.shifts where staff_id = auth.uid() and ended_at is null and deleted_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'no_shift');
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then return jsonb_build_object('ok', false, 'reason', 'bad_position'); end if;
  insert into public.positions (id, lat, lng, accuracy_m, heading, speed_kmh, job_id, at, deleted_at)
  values (auth.uid(), p_lat, p_lng, p_accuracy, p_heading, p_speed, p_job, now(), null)
  on conflict (id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, heading = excluded.heading,
    speed_kmh = excluded.speed_kmh, job_id = coalesce(excluded.job_id, public.positions.job_id), at = now(), deleted_at = null;
  select l.lat, l.lng, l.at into last from public.position_log l where l.staff_id = auth.uid() order by l.at desc limit 1;
  if last is null or last.at < now() - interval '60 seconds' or public.km_between(last.lat, last.lng, p_lat, p_lng) >= 0.025 then
    insert into public.position_log (staff_id, lat, lng) values (auth.uid(), p_lat, p_lng);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- the team map ----------
create or replace function public.team_map(p_day date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare h record;
begin
  if not public.can('map') then perform public.fail('not_allowed', 'Tu n’as pas accès à la carte. Parle au propriétaire.'); end if;
  select * into h from public.home_point();
  return jsonb_build_object(
    'home', jsonb_build_object('lat', h.lat, 'lng', h.lng,
      'label', coalesce((select booking->'home'->>'label' from public.settings where id = 1), 'Centrale'),
      'address', coalesce((select booking->'home'->>'address' from public.settings where id = 1), '8255 av. Mountain Sights, Montréal, QC H4P 2B5')),
    'trucks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color, 'driver_id', t.driver_id) order by t.sort, t.name), '[]'::jsonb)
               from public.trucks t where t.deleted_at is null),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'number', j.number, 'truck_id', j.truck_id, 'order', j.stop_order, 'eta_min', j.eta_min,
               'status', j.status, 'block', j.block, 'name', coalesce(nullif(trim(c.first_name), ''), c.company, '—'),
               'address', coalesce(j.address, c.address), 'lat', coalesce(j.lat, c.lat), 'lng', coalesce(j.lng, c.lng)) order by j.block, j.stop_order), '[]'::jsonb)
             from public.jobs j left join public.customers c on c.id = j.customer_id
             where j.day = p_day and j.deleted_at is null and j.status not in ('cancelled','no_show')),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', coalesce(s.short_name, s.full_name), 'color', s.color,
               'lat', p.lat, 'lng', p.lng, 'at', p.at, 'job_id', p.job_id)), '[]'::jsonb)
             from public.positions p join public.staff s on s.id = p.id
             where p.deleted_at is null and p.at > now() - interval '12 hours'
               and exists (select 1 from public.shifts sh where sh.staff_id = s.id and sh.ended_at is null and sh.deleted_at is null)),
    'trips', (select coalesce(jsonb_agg(jsonb_build_object('job_id', t.job_id, 'staff_id', t.staff_id, 'eta_at', t.eta_at, 'km', t.km, 'minutes', t.minutes, 'route', t.route)), '[]'::jsonb)
             from public.trips t where t.status = 'active' and t.expires_at > now()));
end $$;
-- the path driven today (owner and office)
create or replace function public.day_path(p_staff uuid, p_day date) returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_owner() or public.has_role('office') then
    (select coalesce(jsonb_agg(jsonb_build_array(l.lat, l.lng, l.at) order by l.at), '[]'::jsonb) from public.position_log l
     where l.staff_id = p_staff and (l.at at time zone 'America/Toronto')::date = p_day) end
$$;

-- ---------- the dashboard (needs « Voir les chiffres du garage ») ----------
create or replace function public.dashboard(p_month date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a date := date_trunc('month', p_month)::date; z date := (date_trunc('month', p_month) + interval '1 month')::date; r jsonb;
begin
  if not public.can('money') then perform public.fail('not_allowed', 'Tu n’as pas accès aux chiffres du garage.'); end if;
  with inv as (
    select v.*, j.truck_id from public.invoices v left join public.jobs j on j.id = v.job_id
    where v.deleted_at is null and v.status in ('issued','paid') and (v.issued_at at time zone 'America/Toronto')::date >= a and (v.issued_at at time zone 'America/Toronto')::date < z
  ), jb as (
    select * from public.jobs where deleted_at is null and day >= a and day < z
  )
  select jsonb_build_object(
    'month', a,
    'revenue_cents', (select coalesce(sum(subtotal_cents), 0) from inv),
    'tps_cents', (select coalesce(sum(tps_cents), 0) from inv),
    'tvq_cents', (select coalesce(sum(tvq_cents), 0) from inv),
    'invoices', (select count(*) from inv),
    'avg_ticket_cents', (select coalesce(round(avg(subtotal_cents)), 0) from inv),
    'collected_cents', (select coalesce(sum(amount_cents), 0) from public.payments where deleted_at is null and (paid_at at time zone 'America/Toronto')::date >= a and (paid_at at time zone 'America/Toronto')::date < z),
    'receivable_cents', (select coalesce(sum(total_cents - paid_cents), 0) from public.invoices where deleted_at is null and status = 'issued'),
    'receivable_count', (select count(*) from public.invoices where deleted_at is null and status = 'issued'),
    'drafts', (select count(*) from public.invoices where deleted_at is null and status = 'draft'),
    'jobs_done', (select count(*) from jb where status = 'done'),
    'jobs_booked', (select count(*) from jb where status in ('booked','en_route','on_site')),
    'jobs_cancelled', (select count(*) from jb where status = 'cancelled'),
    'jobs_no_show', (select count(*) from jb where status = 'no_show'),
    'lost_cents', (select coalesce(sum(lost_cents), 0) from jb where status in ('cancelled','no_show')),
    'km', (select coalesce(sum(t.km), 0) from public.trips t join jb on jb.id = t.job_id),
    'goal_cents', (select (billing->>'goal_cents')::int from public.settings where id = 1),
    'by_truck', (select coalesce(jsonb_agg(jsonb_build_object('truck_id', truck_id, 'revenue_cents', s, 'invoices', n)), '[]'::jsonb)
                 from (select truck_id, sum(subtotal_cents) s, count(*) n from inv group by truck_id) x),
    'months', (select jsonb_agg(jsonb_build_object('month', m::date, 'revenue_cents',
                 (select coalesce(sum(v.subtotal_cents), 0) from public.invoices v where v.deleted_at is null and v.status in ('issued','paid')
                  and date_trunc('month', v.issued_at at time zone 'America/Toronto') = m)) order by m)
               from generate_series(date_trunc('month', p_month) - interval '5 months', date_trunc('month', p_month), interval '1 month') m),
    'top_services', (select coalesce(jsonb_agg(jsonb_build_object('name', d, 'n', n) order by n desc), '[]'::jsonb) from (
                 select i.description d, count(*) n from public.job_items i join public.jobs j on j.id = i.job_id
                 where i.deleted_at is null and i.kind = 'service' and i.status in ('planned','done','approved') and j.status = 'done'
                   and j.day >= public.local_today() - 30 group by i.description order by count(*) desc limit 8) t)
  ) into r;
  return r;
end $$;

-- ---------- treasury: revenue, expenses, taxes to remit (needs « Trésorerie ») ----------
create or replace function public.treasury_report(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.can('treasury') then perform public.fail('not_allowed', 'Tu n’as pas accès à la trésorerie.'); end if;
  with inv as (
    select * from public.invoices where deleted_at is null and status in ('issued','paid')
      and (issued_at at time zone 'America/Toronto')::date between p_from and p_to
  ), ex as (
    select * from public.expenses where deleted_at is null and day between p_from and p_to
  ), pay as (
    select * from public.payments where deleted_at is null and (paid_at at time zone 'America/Toronto')::date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'revenue', jsonb_build_object('subtotal', (select coalesce(sum(subtotal_cents), 0) from inv), 'tps', (select coalesce(sum(tps_cents), 0) from inv),
                                  'tvq', (select coalesce(sum(tvq_cents), 0) from inv), 'total', (select coalesce(sum(total_cents), 0) from inv), 'count', (select count(*) from inv)),
    'expenses', jsonb_build_object('subtotal', (select coalesce(sum(subtotal_cents), 0) from ex), 'tps', (select coalesce(sum(tps_cents), 0) from ex),
                                   'tvq', (select coalesce(sum(tvq_cents), 0) from ex), 'total', (select coalesce(sum(total_cents), 0) from ex), 'count', (select count(*) from ex)),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'total', t, 'subtotal', s, 'n', n) order by t desc), '[]'::jsonb)
                    from (select category, sum(total_cents) t, sum(subtotal_cents) s, count(*) n from ex group by category) x),
    'collected', (select coalesce(jsonb_agg(jsonb_build_object('method', method, 'total', t, 'n', n)), '[]'::jsonb)
                  from (select method, sum(amount_cents) t, count(*) n from pay group by method) y),
    'profit', (select coalesce(sum(subtotal_cents), 0) from inv) - (select coalesce(sum(subtotal_cents), 0) from ex),
    'tps_to_remit', (select coalesce(sum(tps_cents), 0) from inv) - (select coalesce(sum(tps_cents), 0) from ex),
    'tvq_to_remit', (select coalesce(sum(tvq_cents), 0) from inv) - (select coalesce(sum(tvq_cents), 0) from ex)
  ) into r;
  return r;
end $$;

-- ---------- history of changes (owner) ----------
create or replace function public.log_activity() returns trigger language plpgsql security definer set search_path = public as $$
declare d jsonb; k text; o jsonb; n jsonb; v_id uuid;
begin
  n := to_jsonb(new);
  v_id := case when (n->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (n->>'id')::uuid end;
  if tg_op = 'INSERT' then
    insert into public.activity (actor, entity, entity_id, action) values (auth.uid(), tg_table_name, v_id, 'insert');
  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old); d := '{}';
    for k in select key from jsonb_each(n) loop
      if k not in ('updated_at', 'created_at', 'eta_min', 'travel_min', 'stop_order', 'last_seen_at', 'prefs') and (o->k) is distinct from (n->k) then
        d := d || jsonb_build_object(k, jsonb_build_array(o->k, n->k));
      end if;
    end loop;
    if d <> '{}' then
      insert into public.activity (actor, entity, entity_id, action, data)
      values (auth.uid(), tg_table_name, v_id, case when n->>'deleted_at' is not null and o->>'deleted_at' is null then 'delete' else 'update' end, d);
    end if;
  end if;
  return null;
end $$;
do $$
declare t text;
begin
  foreach t in array array['jobs','job_items','invoices','payments','customers','vehicles','staff','settings','services','trucks','expenses','inventory_items','quotes']
  loop
    execute format('create trigger %I after insert or update on public.%I for each row execute function public.log_activity()', t || '_activity', t);
  end loop;
end $$;

-- ---------- the customer's tracking page (no sign-in: the secret link is the key) ----------
create or replace function public.public_track(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.trips; j public.jobs; c public.customers; s public.staff; p public.positions; g jsonb; v_status text;
begin
  if p_token is null or length(p_token) < 16 then return jsonb_build_object('status', 'not_found'); end if;
  select * into t from public.trips where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into j from public.jobs where id = t.job_id;
  select * into c from public.customers where id = j.customer_id;
  select * into s from public.staff where id = t.staff_id;
  select company into g from public.settings where id = 1;
  v_status := case when t.status = 'active' and t.expires_at < now() then 'expired' else t.status end;
  if v_status = 'active' then
    select * into p from public.positions where id = t.staff_id and deleted_at is null and at > now() - interval '15 minutes';
  end if;
  return jsonb_build_object(
    'status', v_status,
    'garage', jsonb_build_object('name', g->>'name', 'phone', g->>'phone'),
    'mechanic', split_part(coalesce(s.short_name, s.full_name, ''), ' ', 1),
    'customer', coalesce(nullif(trim(c.first_name), ''), ''),
    'lang', coalesce(c.lang, 'fr'),
    'dest', case when v_status = 'active' then jsonb_build_object('lat', t.dest_lat, 'lng', t.dest_lng) end,
    'route', case when v_status = 'active' then t.route end,
    'km', t.km, 'minutes', t.minutes, 'eta_at', t.eta_at, 'ended_at', t.ended_at, 'now', now(),
    'pos', case when p.id is not null then jsonb_build_object('lat', round(p.lat::numeric, 5), 'lng', round(p.lng::numeric, 5), 'at', p.at) end);
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.public_track(text) to anon;
