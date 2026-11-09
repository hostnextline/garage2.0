-- Part 24 sexies: the booking text is the estimate, not a bill; « Changer le prix » for everyone on the team.
--   messages.{fr,en}.booking   each service on its own line with its price ({services}), then « Total : {soustotal} » = « 159,98 $ + tx » (before
--                              taxes), then the link to accept the estimate and authorize the work with one button. No « pay now »
--                              before the work ({payer} is no longer used by this text).
update public.settings set messages = jsonb_set(jsonb_set(coalesce(messages, '{}'::jsonb),
  '{fr,booking}', to_jsonb(E'Bonjour {prenom}, votre rendez-vous avec {garage} est confirmé : {jour}, {bloc} (entre {debut} et {fin}).\n\nEstimation :\n{services}\nTotal : {soustotal}\n\nPour accepter l’estimation et autoriser les travaux sur votre véhicule (un seul bouton) : {lien}'::text), true),
  '{en,booking}', to_jsonb(E'Hello {prenom}, your appointment with {garage} is confirmed: {jour}, {bloc} (between {debut} and {fin}).\n\nEstimate:\n{services}\nTotal: {soustotal}\n\nTo accept the estimate and authorize the work on your vehicle (one button): {lien}'::text), true)
where id = 1;

-- « Changer le prix » of a line of an appointment: every member of the team who sees the appointment, while it is coming or under
-- way and its invoice is not finished (a draft follows the work by itself). The old and new prices are kept in the activity log.
create or replace function public.job_item_price(p_op uuid, p_item uuid, p_unit_cents int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); i record; j record; v_old int;
begin
  if v_done is not null then return v_done; end if;
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi avec ton compte de l’équipe.'); end if;
  if p_unit_cents is null or p_unit_cents < 0 or p_unit_cents > 10000000 then perform public.fail('bad_amount', 'Écris un prix (0 $ ou plus).'); end if;
  select * into i from public.job_items where id = p_item and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cette ligne n’existe plus.'); end if;
  select * into j from public.jobs where id = i.job_id and deleted_at is null;
  if not found or not public.job_id_visible(j.id) then perform public.fail('not_found', 'Ce rendez-vous n’existe plus (ou tu n’y as pas accès).'); end if;
  if j.status not in ('booked', 'en_route', 'on_site') then perform public.fail('closed', 'Ce rendez-vous est terminé ou annulé : son prix ne change plus.'); end if;
  if exists (select 1 from public.invoices v where v.job_id = j.id and v.deleted_at is null and v.status not in ('draft', 'void')) then
    perform public.fail('invoice_done', 'La facture est déjà terminée : annule-la d’abord pour changer un prix.');
  end if;
  v_old := i.unit_cents;
  perform set_config('garage.rpc', 'on', true);
  -- a discount keeps its sign; the price written is what one unit costs
  update public.job_items set unit_cents = case when kind = 'discount' then -abs(p_unit_cents) else p_unit_cents end where id = i.id;
  insert into public.activity (actor, entity, entity_id, action, data)
  values (auth.uid(), 'job', j.id, 'price_changed', jsonb_build_object('item', i.id, 'description', i.description, 'from', v_old, 'to', p_unit_cents));
  return public.op_save(p_op, 'job_item_price', jsonb_build_object('ok', true, 'rows', jsonb_build_object(
    'job_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.job_items x where x.id = i.id))));
end $$;
revoke all on function public.job_item_price(uuid, uuid, int) from public, anon;
grant execute on function public.job_item_price(uuid, uuid, int) to authenticated, service_role;
