-- Part 24 nonies: « Modifier le rendez-vous » — a mistake is fixed in place, never by deleting and booking again.
--   job_customer(op, job, customer, vehicle)   the appointment goes to the right customer (booked with the wrong one): only while
--                                              it is booked (nobody has left), with no finished invoice. The car becomes the
--                                              one chosen (it must be that customer's), or the customer's only car, or none;
--                                              the address is the customer's (the route is planned again from it). What the
--                                              wrong customer had is undone: their links to this appointment stop working, a
--                                              signature they gave is removed (the right customer signs again), the booking
--                                              text can be sent again to the right one. A draft invoice follows. Noted in the log.
--   (the address of the appointment alone, the car, the day, the block, the truck, the services and prices already had their
--    own ways; the app gathers them in « Modifier le rendez-vous »)
create or replace function public.job_customer(p_op uuid, p_job uuid, p_customer uuid, p_vehicle uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); j record; c record; v_car uuid := p_vehicle; v_links int;
begin
  if v_done is not null then return v_done; end if;
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi avec ton compte de l’équipe.'); end if;
  select * into j from public.jobs where id = p_job and deleted_at is null for update;
  if not found or not public.job_id_visible(j.id) then perform public.fail('not_found', 'Ce rendez-vous n’existe plus (ou tu n’y as pas accès).'); end if;
  if not (public.can('book') or (public.has_role('mechanic') and j.truck_id is not null and j.truck_id = any(public.my_truck_ids()))) then
    perform public.fail('not_allowed', 'Tu ne peux pas changer ce rendez-vous. Parle au propriétaire.');
  end if;
  if j.status <> 'booked' then perform public.fail('started', 'Le client ne change plus une fois le camion parti : annule et réserve pour le bon client.'); end if;
  if exists (select 1 from public.invoices v where v.job_id = j.id and v.deleted_at is null and v.status not in ('draft', 'void')) then
    perform public.fail('invoice_done', 'La facture est déjà terminée : annule-la d’abord.');
  end if;
  select * into c from public.customers where id = p_customer and deleted_at is null;
  if not found or not public.customer_visible(p_customer) then perform public.fail('no_customer', 'Choisis le client.'); end if;
  if p_customer = j.customer_id then perform public.fail('same', 'C’est déjà le client de ce rendez-vous.'); end if;
  if v_car is not null and not exists (select 1 from public.vehicles v where v.id = v_car and v.customer_id = p_customer and v.deleted_at is null) then
    perform public.fail('bad_vehicle', 'Ce véhicule n’est pas à ce client.');
  end if;
  if v_car is null and (select count(*) from public.vehicles v where v.customer_id = p_customer and v.deleted_at is null) = 1 then
    select v.id into v_car from public.vehicles v where v.customer_id = p_customer and v.deleted_at is null;
  end if;

  update public.jobs set customer_id = p_customer, vehicle_id = v_car,
    address = c.address, unit = c.unit, postal_code = c.postal_code, lat = c.lat, lng = c.lng,
    confirm_sent_at = null,
    waiver_signed_at = null, waiver_signer = null, waiver_version = null, waiver_attachment = null,
    estimate_signed_at = null, estimate_signer = null, estimate_attachment = null, estimate_cents = null
  where id = j.id;
  update public.invoices set customer_id = p_customer where job_id = j.id and status = 'draft' and deleted_at is null;
  update public.public_links set revoked_at = now() where job_id = j.id and revoked_at is null;
  get diagnostics v_links = row_count;
  insert into public.activity (actor, entity, entity_id, action, data)
  values (auth.uid(), 'job', j.id, 'customer_changed', jsonb_build_object('from', j.customer_id, 'to', p_customer,
    'vehicle_from', j.vehicle_id, 'vehicle_to', v_car, 'links_closed', v_links, 'signature_removed', j.waiver_signed_at is not null or j.estimate_signed_at is not null));
  return public.op_save(p_op, 'job_customer', jsonb_build_object('ok', true, 'vehicle_id', v_car, 'rows', jsonb_build_object(
    'jobs', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.jobs x where x.id = j.id),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.invoices x where x.job_id = j.id))));
end $$;
revoke all on function public.job_customer(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.job_customer(uuid, uuid, uuid, uuid) to authenticated, service_role;
