-- Part 24 duodecies: « Le kilométrage de chaque visite » (like Serti): each appointment keeps the car's km on that day, asked when
-- the mechanic arrives (with the VIN when the car has none). The car's own km follows the highest one seen.
--   jobs.odometer_km             the km read on the dashboard at this visit (null: not noted). A direct change, like the notes
--                                (column grant; the jobs_upd policy decides who: book right, the job's truck, its author).
--   trigger jobs_km_follow       a visit's km above the car's (or the car has none) becomes the car's km: an odometer only goes up,
--                                so an older visit noted later never lowers it.
--   vin_history                  each visit also answers its km.
alter table public.jobs add column if not exists odometer_km int check (odometer_km is null or odometer_km between 0 and 3000000);
grant update (odometer_km) on public.jobs to authenticated;

create or replace function public.jobs_km_follow() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.vehicles set odometer_km = new.odometer_km
   where id = new.vehicle_id and (odometer_km is null or odometer_km < new.odometer_km);
  return null;
end $$;
revoke all on function public.jobs_km_follow() from public, anon, authenticated;
drop trigger if exists jobs_km_follow on public.jobs;
create trigger jobs_km_follow after insert or update of odometer_km, vehicle_id on public.jobs
  for each row when (new.odometer_km is not null and new.vehicle_id is not null) execute function public.jobs_km_follow();

create or replace function public.vin_history(p_vin text, p_customer uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v text := upper(regexp_replace(coalesce(p_vin, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi avec ton compte de l’équipe.'); end if;
  if length(v) <> 17 then return jsonb_build_object('vin', v, 'visits', '[]'::jsonb); end if;
  return jsonb_build_object('vin', v, 'visits', coalesce((
    select jsonb_agg(jsonb_build_object(
        'job_id', j.id, 'number', j.number, 'day', j.day, 'status', j.status, 'km', j.odometer_km,
        'here', p_customer is not null and j.customer_id = p_customer,
        'open', public.job_id_visible(j.id),
        'work', coalesce((select jsonb_agg(i.description order by i.sort, i.created_at) from public.job_items i
                          where i.job_id = j.id and i.deleted_at is null and i.status in ('planned', 'done', 'approved')), '[]'::jsonb))
      order by j.day desc, j.number desc)
    from public.jobs j join public.vehicles ve on ve.id = j.vehicle_id
    where ve.vin = v and j.deleted_at is null and j.status not in ('cancelled', 'no_show')
      and (j.coffre_id is null or public.is_owner())), '[]'::jsonb));
end $$;
revoke all on function public.vin_history(text, uuid) from public, anon;
grant execute on function public.vin_history(text, uuid) to authenticated, service_role;
