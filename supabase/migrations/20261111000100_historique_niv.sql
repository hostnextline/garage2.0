-- Part 24 undecies: « Historique du véhicule » — the car has its own file, found by its VIN (like Serti at the dealers): every visit
-- made on a car with that VIN, whoever owned it then (a car bought used, a car entered twice).
--   vin_history(vin, customer)   every member of the team. For each visit (not cancelled, not « absent »): the day, the job's number,
--                                its status, the work (the lines counted: planned, done, accepted), whether it is this customer's
--                                (`here`) and whether the person may open it (`open`). Never the other owner's name, phone, address
--                                or prices. A visit paid by the Coffre only for the owner. A VIN that is not 17 characters: nothing.
create index if not exists vehicles_vin on public.vehicles (vin) where vin is not null;

create or replace function public.vin_history(p_vin text, p_customer uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v text := upper(regexp_replace(coalesce(p_vin, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi avec ton compte de l’équipe.'); end if;
  if length(v) <> 17 then return jsonb_build_object('vin', v, 'visits', '[]'::jsonb); end if;
  return jsonb_build_object('vin', v, 'visits', coalesce((
    select jsonb_agg(jsonb_build_object(
        'job_id', j.id, 'number', j.number, 'day', j.day, 'status', j.status,
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
