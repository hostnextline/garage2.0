-- Part 24 septdecies: « Appel entrant » is a switch in each owner's own account (like the incoming texts).
-- « Recevoir les appels dans mon compte » (Réglages → Branchements) = staff.prefs.calls. An owner who switched it on reads
-- « incoming_calls » and gets the banner; the others do not. This replaces the mark set on the server (staff.sees_calls,
-- Part 24 quindecies): the account that had it keeps the calls; the column stays, unused; its guard lets everything through.
update public.staff set prefs = coalesce(prefs, '{}'::jsonb) || '{"calls": true}'::jsonb where sees_calls and coalesce(prefs->>'calls', '') <> 'true';

create or replace function public.staff_calls_guard() returns trigger language plpgsql as $$
begin
  return new;
end $$;

create or replace function public.sees_calls() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.id = auth.uid() and s.active and s.deleted_at is null
                   and 'owner' = any(s.roles) and s.prefs->>'calls' = 'true')
$$;

-- my_access: « calls » = an owner who switched the calls on for their account
create or replace function public.my_access() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'full_name', s.full_name, 'short_name', s.short_name, 'email', s.email, 'phone', s.phone, 'roles', to_jsonb(s.roles),
    'owner', 'owner' = any(s.roles), 'lang', s.lang, 'prefs', s.prefs, 'color', s.color,
    'rights', (select jsonb_object_agg(r, public.right_of(s, r)) from unnest(public.all_rights()) r),
    'trucks', to_jsonb(public.my_truck_ids()),
    'card_online', exists (select 1 from public.secrets where key = 'stripe_key'),
    'texts_online', exists (select 1 from public.secrets where key = 'ghl_token') and exists (select 1 from public.secrets where key = 'ghl_location'),
    'calls', 'owner' = any(s.roles) and coalesce(s.prefs->>'calls', '') = 'true')
  from public.staff s where s.id = auth.uid() and s.active and s.deleted_at is null
$$;
