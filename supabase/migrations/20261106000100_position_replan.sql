-- Part 15: a position found later (the address typed without choosing a suggestion, then found by the locator or
-- « Chercher ») re-plans its block at once: the order of the stops and the times follow the real place.
-- Appointments on the way or there never move (replan_block keeps them); only coming, booked appointments count.

create or replace function public.jobs_replan_on_position() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null and new.status = 'booked' and new.day >= public.local_today() and new.lat is not null
     and (old.lat is distinct from new.lat or old.lng is distinct from new.lng) then
    perform public.replan_block(new.day, new.block);
  end if;
  return null;
end $$;
create or replace trigger jobs_replan_on_position after update of lat, lng on public.jobs
  for each row execute function public.jobs_replan_on_position();

-- a customer's position: its coming appointments that use it (no position of their own) are re-planned
create or replace function public.customers_replan_on_position() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.lat is not null and (old.lat is distinct from new.lat or old.lng is distinct from new.lng) then
    for r in select distinct j.day, j.block from public.jobs j
             where j.customer_id = new.id and j.deleted_at is null and j.status = 'booked' and j.day >= public.local_today() and j.lat is null
    loop
      perform public.replan_block(r.day, r.block);
    end loop;
  end if;
  return null;
end $$;
create or replace trigger customers_replan_on_position after update of lat, lng on public.customers
  for each row execute function public.customers_replan_on_position();

revoke all on function public.jobs_replan_on_position() from public, anon, authenticated;
revoke all on function public.customers_replan_on_position() from public, anon, authenticated;
