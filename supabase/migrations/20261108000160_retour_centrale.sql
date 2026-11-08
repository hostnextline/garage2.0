-- Part 24 ter: « Retour à la Centrale ». When the mechanic's last job of the day is done, the next destination is the
-- trucks' starting point (the truck's own start, else « Départ des camions »). « Je pars » then makes a trip with no
-- job (trips.kind = 'return'), works out the route and the arrival time, and texts the garage's return number
-- (settings.booking.return_phone) the same way a customer is texted: the arrival time and the live map link.
--   trips            job_id may be null; kind ('job' | 'return'); dest_label (« Centrale »); one active return per person
--   public_track     works for a trip with no job (no customer: the garage's own language, no appointment link);
--                    says kind and dest_label (the page writes « … est en route vers la Centrale »)
--   shift_end        ending the day = arrived home: the active return trip is marked arrived (not cancelled)
--   messages         the text « return_trip » (fr, en) and its switch, when they are not set yet
alter table public.trips alter column job_id drop not null;
alter table public.trips add column if not exists kind text not null default 'job';
alter table public.trips add column if not exists dest_label text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trips_kind_check') then
    alter table public.trips add constraint trips_kind_check check (kind in ('job', 'return'));
  end if;
end $$;
create unique index if not exists trips_one_return on public.trips(staff_id) where kind = 'return' and status = 'active' and deleted_at is null;

create or replace function public.public_track(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.trips; j public.jobs; c public.customers; s public.staff; p public.positions; g jsonb; v_status text; v_hash text; v_lang text;
begin
  if p_token is null or length(p_token) < 16 then return jsonb_build_object('status', 'not_found'); end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select * into t from public.trips where token_hash = v_hash;
  if not found then
    -- the appointment's own link: its latest trip
    select tr.* into t from public.public_links l join public.trips tr on tr.job_id = l.job_id
     where l.token_hash = v_hash and l.revoked_at is null and l.expires_at > now()
     order by tr.started_at desc limit 1;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
  end if;
  if t.job_id is not null then
    select * into j from public.jobs where id = t.job_id;
    select * into c from public.customers where id = j.customer_id;
  end if;
  select * into s from public.staff where id = t.staff_id;
  select company into g from public.settings where id = 1;
  -- a return trip is followed by the garage: in the owner's language
  v_lang := coalesce(c.lang, (select st.lang from public.staff st where 'owner' = any(st.roles) and st.deleted_at is null order by st.created_at limit 1), 'fr');
  v_status := case when t.status = 'active' and t.expires_at < now() then 'expired' else t.status end;
  if v_status = 'active' then
    select * into p from public.positions where id = t.staff_id and deleted_at is null and at > now() - interval '15 minutes';
  end if;
  return jsonb_build_object(
    'status', v_status,
    'kind', coalesce(t.kind, 'job'),
    'dest_label', t.dest_label,
    'garage', jsonb_build_object('name', g->>'name', 'phone', g->>'phone'),
    'mechanic', split_part(coalesce(s.short_name, s.full_name, ''), ' ', 1),
    'customer', coalesce(nullif(trim(c.first_name), ''), ''),
    'lang', v_lang,
    'dest', case when v_status = 'active' then jsonb_build_object('lat', t.dest_lat, 'lng', t.dest_lng) end,
    'route', case when v_status = 'active' then t.route end,
    'km', t.km, 'minutes', t.minutes, 'eta_at', t.eta_at, 'ended_at', t.ended_at, 'now', now(),
    'pos', case when p.id is not null then jsonb_build_object('lat', round(p.lat::numeric, 5), 'lng', round(p.lng::numeric, 5), 'at', p.at) end);
end $$;
revoke execute on function public.public_track(text) from public;
grant execute on function public.public_track(text) to anon, authenticated;

create or replace function public.shift_end() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi.'); end if;
  -- home: the trip back to the start is over (close_day cancels the trips still active, a return trip is not « cancelled »)
  update public.trips set status = 'arrived', ended_at = now() where staff_id = auth.uid() and kind = 'return' and status = 'active';
  perform public.close_day(auth.uid());
  return jsonb_build_object('ok', true, 'rows', jsonb_build_object(
    'shifts', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.shifts s where s.staff_id = auth.uid() and s.started_at > now() - interval '1 day'),
    'positions', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.positions p where p.id = auth.uid()),
    'trips', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.trips t where t.staff_id = auth.uid() and t.started_at > now() - interval '1 day')));
end $$;

-- the text to the garage when a mechanic heads back (the owner edits it in Réglages → Textos like the others)
update public.settings set messages = jsonb_set(jsonb_set(jsonb_set(coalesce(messages, '{}'::jsonb),
    '{fr,return_trip}', coalesce(messages #> '{fr,return_trip}', to_jsonb('{mecano} a fini sa journée et revient vers {lieu} : arrivée prévue vers {heure} (environ {minutes} min). Suivre le camion en direct : {lien}'::text)), true),
    '{en,return_trip}', coalesce(messages #> '{en,return_trip}', to_jsonb('{mecano} is done for the day and heading back to {lieu}: arriving around {heure} (about {minutes} min). Follow the truck live: {lien}'::text)), true),
    '{on,return_trip}', coalesce(messages #> '{on,return_trip}', 'true'::jsonb), true)
where id = 1;
