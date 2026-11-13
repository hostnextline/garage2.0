-- Part 24 quindecies: « Appel entrant » for one account, not for the owner role.
-- The garage has several owners; the incoming calls of the GoHighLevel number are answered by one person. `staff.sees_calls`
-- says who: only that account reads « incoming_calls », gets the banner and may branch the calls (function « ring »).
-- Nobody changes the mark from the app (not even an owner): it is set on the server.
alter table public.staff add column if not exists sees_calls boolean not null default false;

create or replace function public.sees_calls() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.id = auth.uid() and s.active and s.deleted_at is null and s.sees_calls)
$$;
revoke all on function public.sees_calls() from public, anon;
grant execute on function public.sees_calls() to authenticated, service_role;

create or replace function public.staff_calls_guard() returns trigger language plpgsql as $$
begin
  -- a person signed in (auth.uid()) never sets or moves the mark; the server (no person) does
  if auth.uid() is not null and new.sees_calls is distinct from (case when tg_op = 'UPDATE' then old.sees_calls else false end) then
    raise exception 'not_allowed' using detail = 'Ce réglage se change sur le serveur.';
  end if;
  return new;
end $$;
drop trigger if exists staff_calls_guard on public.staff;
create trigger staff_calls_guard before insert or update on public.staff for each row execute function public.staff_calls_guard();

drop policy if exists incoming_calls_owner on public.incoming_calls;
drop policy if exists incoming_calls_one on public.incoming_calls;
create policy incoming_calls_one on public.incoming_calls for select to authenticated using (public.sees_calls());

-- my_access: + « calls » (this account gets the incoming calls)
create or replace function public.my_access() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'full_name', s.full_name, 'short_name', s.short_name, 'email', s.email, 'phone', s.phone, 'roles', to_jsonb(s.roles),
    'owner', 'owner' = any(s.roles), 'lang', s.lang, 'prefs', s.prefs, 'color', s.color,
    'rights', (select jsonb_object_agg(r, public.right_of(s, r)) from unnest(public.all_rights()) r),
    'trucks', to_jsonb(public.my_truck_ids()),
    'card_online', exists (select 1 from public.secrets where key = 'stripe_key'),
    'texts_online', exists (select 1 from public.secrets where key = 'ghl_token') and exists (select 1 from public.secrets where key = 'ghl_location'),
    'calls', s.sees_calls)
  from public.staff s where s.id = auth.uid() and s.active and s.deleted_at is null
$$;
