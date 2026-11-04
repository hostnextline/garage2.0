-- Part 9: everyone on the team knows whether the card payment link and the automatic texts are switched on
-- (only « yes / no »: the keys themselves stay in the server's safe).
create or replace function public.my_access() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'full_name', s.full_name, 'short_name', s.short_name, 'email', s.email, 'phone', s.phone, 'roles', to_jsonb(s.roles),
    'owner', 'owner' = any(s.roles), 'lang', s.lang, 'prefs', s.prefs, 'color', s.color,
    'rights', (select jsonb_object_agg(r, public.right_of(s, r)) from unnest(public.all_rights()) r),
    'trucks', to_jsonb(public.my_truck_ids()),
    'card_online', exists (select 1 from public.secrets where key = 'stripe_key'),
    'texts_online', exists (select 1 from public.secrets where key = 'ghl_token') and exists (select 1 from public.secrets where key = 'ghl_location'))
  from public.staff s where s.id = auth.uid() and s.active and s.deleted_at is null
$$;
