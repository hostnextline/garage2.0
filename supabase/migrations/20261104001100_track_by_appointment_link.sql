-- Part 11: the customer's appointment link (client.html#t=…) also opens the live trip of that appointment
-- (client.html#suivi=<the same secret>): one link in the customer's texts is enough.
create or replace function public.public_track(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.trips; j public.jobs; c public.customers; s public.staff; p public.positions; g jsonb; v_status text; v_hash text;
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
revoke execute on function public.public_track(text) from public;
grant execute on function public.public_track(text) to anon, authenticated;
