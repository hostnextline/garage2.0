-- Part 24 decies: « Modifier la facture » — the invoice changes before the appointment and during it, a part of the job is
-- taken off without cancelling anything.
--   invoice_reopen(op, invoice)   a finished invoice not paid yet goes back to a draft, while its job is coming or under way:
--                                 it keeps its number (finished again, it is the same invoice), the payments already received
--                                 wait on the job (« payé d'avance ») and come back on it when it is finished again, the
--                                 customer's card page is made again with the new amount. Who: as « Terminer la facture »
--                                 (invoice_editable: the office, the job's mechanic). Noted in the log.
--   invoice_finish                a reopened invoice keeps its number; its total may not go under what the customer paid.
--   payment_add                   a card payment that lands while the invoice is being changed waits on the job (never refused:
--                                 the money is in).
--   the draft follows the work    a line of the job taken off (removed, declined, deleted) leaves the draft invoice; its new
--                                 price, quantity or words go on it. Work on a FINISHED invoice is not taken off by a person:
--                                 « Modifier la facture » first (the customer's invoice and the job always say the same).
--   job_item_price                answers the draft invoice too (its line follows).

-- ---------- « Modifier la facture » ----------
create or replace function public.invoice_reopen(p_op uuid, p_invoice uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); inv public.invoices; j public.jobs; v_pays int;
begin
  if v_done is not null then return v_done; end if;
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi avec ton compte de l’équipe.'); end if;
  select * into inv from public.invoices where id = p_invoice and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
  if not public.invoice_editable(inv.job_id) then perform public.fail('not_allowed', 'Tu ne peux pas modifier cette facture.'); end if;
  if inv.status = 'draft' then
    return public.op_save(p_op, 'invoice_reopen', jsonb_build_object('ok', true, 'already', true, 'rows', public.job_payload(inv.job_id)));
  end if;
  if inv.status = 'void' then perform public.fail('void', 'Cette facture est annulée.'); end if;
  if inv.status = 'paid' then perform public.fail('paid', 'La facture est payée : elle ne se modifie plus.'); end if;
  select * into j from public.jobs where id = inv.job_id and deleted_at is null;
  if not found or j.status not in ('booked', 'en_route', 'on_site') then
    perform public.fail('closed', 'La job est terminée : la facture ne se modifie plus. Annule-la pour en faire une nouvelle.');
  end if;
  perform set_config('garage.rpc', 'on', true);
  -- what the customer paid waits on the job and comes back on the invoice when it is finished again
  update public.payments set invoice_id = null where invoice_id = inv.id and deleted_at is null;
  get diagnostics v_pays = row_count;
  -- the card page opened for the old amount is not reused: the next « Payer » makes one with the new amount
  update public.public_links set last_session = null, last_session_url = null, last_session_amount = null, last_session_expires = null
  where job_id = j.id and last_session is not null;
  update public.invoices set status = 'draft', paid_cents = 0 where id = inv.id;
  insert into public.activity (actor, entity, entity_id, action, data)
  values (auth.uid(), 'job', j.id, 'invoice_reopened', jsonb_build_object('invoice', inv.id, 'number', inv.number,
    'total', inv.total_cents, 'paid', inv.paid_cents, 'payments', v_pays));
  return public.op_save(p_op, 'invoice_reopen', jsonb_build_object('ok', true, 'number', inv.number, 'rows', public.job_payload(j.id)));
end $$;
revoke all on function public.invoice_reopen(uuid, uuid) from public, anon;
grant execute on function public.invoice_reopen(uuid, uuid) to authenticated, service_role;

-- ---------- « Terminer la facture »: a reopened invoice keeps its number ----------
create or replace function public.invoice_finish(p_op uuid, p_invoice uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); inv public.invoices; v_no bigint; v_paid int; v_due int;
  v_bill jsonb := (select billing from public.settings where id = 1);
begin
  if v_done is not null then return v_done; end if;
  select * into inv from public.invoices where id = p_invoice and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
  if not public.invoice_editable(inv.job_id) then perform public.fail('not_allowed', 'Tu ne peux pas terminer cette facture.'); end if;
  if inv.status <> 'draft' then
    return public.op_save(p_op, 'invoice_finish', jsonb_build_object('ok', true, 'already', true, 'rows', public.job_payload(inv.job_id)));
  end if;
  if jsonb_array_length(inv.lines) = 0 then perform public.fail('empty', 'Ajoute au moins une ligne avant de terminer la facture.'); end if;
  if exists (select 1 from jsonb_array_elements(inv.lines) l where coalesce(trim(l->>'description'), '') = '') then
    perform public.fail('no_description', 'Une ligne n’a pas de description.');
  end if;
  if inv.total_cents < 0 then perform public.fail('negative', 'Le total est négatif. Vérifie le rabais.'); end if;
  perform set_config('garage.rpc', 'on', true);
  -- payments made before the invoice (online prepayment, or paid before « Modifier la facture ») count on it
  update public.payments set invoice_id = inv.id where job_id = inv.job_id and invoice_id is null and deleted_at is null;
  select coalesce(sum(amount_cents), 0)::int into v_paid from public.payments where invoice_id = inv.id and deleted_at is null;
  if inv.number is not null and v_paid > inv.total_cents then
    perform public.fail('below_paid', format('Le client a déjà payé %s $ : le total ne peut pas être plus bas.',
      replace(to_char(v_paid / 100.0, 'FM9999990.00'), '.', ',')));
  end if;
  v_no := inv.number;
  if v_no is null then
    update public.counters set next_value = next_value + 1 where name = 'invoice' returning next_value - 1 into v_no;
  end if;
  v_due := coalesce((v_bill->>'due_days')::int, 0);
  update public.invoices set number = v_no, status = case when v_paid >= total_cents then 'paid' else 'issued' end, issued_at = now(),
    due_on = public.local_today() + v_due, paid_cents = v_paid
  where id = inv.id;
  return public.op_save(p_op, 'invoice_finish', jsonb_build_object('ok', true, 'number', v_no, 'again', inv.number is not null,
    'rows', public.job_payload(inv.job_id)));
end $$;

-- ---------- a card payment that lands while the invoice is being changed waits on the job ----------
create or replace function public.payment_add(p_op uuid, p_invoice uuid, p_amount_cents int, p_method text, p_reference text default null,
  p_job uuid default null, p_session text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); inv public.invoices; v_paid int; v_job uuid; v_inv uuid := p_invoice;
begin
  if v_done is not null then return v_done; end if;
  if p_amount_cents is null or p_amount_cents = 0 then perform public.fail('amount', 'Écris le montant reçu.'); end if;
  if p_method not in ('cash','debit','credit','interac','card_online','cheque','other') then perform public.fail('method', 'Choisis le mode de paiement.'); end if;
  perform set_config('garage.rpc', 'on', true);
  if v_inv is not null then
    select * into inv from public.invoices where id = v_inv and deleted_at is null for update;
    if not found then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
    if auth.uid() is not null and not public.invoice_editable(inv.job_id) then perform public.fail('not_allowed', 'Tu ne peux pas encaisser cette facture.'); end if;
    if inv.status = 'void' then perform public.fail('void', 'Cette facture est annulée.'); end if;
    if inv.status = 'draft' then
      -- paid by card while « Modifier la facture » is open: the money is in, it waits on the job
      if auth.uid() is null and inv.number is not null then v_inv := null;
      else perform public.fail('invoice_first', 'Termine la facture avant d’encaisser.'); end if;
    end if;
    v_job := inv.job_id;
  else
    v_job := p_job;
    if v_job is null then perform public.fail('not_found', 'Rien à payer.'); end if;
    if auth.uid() is not null and not public.invoice_editable(v_job) then perform public.fail('not_allowed', 'Tu ne peux pas encaisser cette job.'); end if;
    -- paid ahead (online) while the invoice was being finished: the payment goes on the finished invoice
    select v.id into v_inv from public.invoices v where v.job_id = v_job and v.status in ('issued','paid') and v.deleted_at is null limit 1;
  end if;
  insert into public.payments (invoice_id, job_id, amount_cents, method, reference, stripe_session, created_by)
  values (v_inv, v_job, p_amount_cents, p_method, nullif(p_reference, ''), p_session, auth.uid());
  if v_inv is not null then
    select coalesce(sum(amount_cents), 0)::int into v_paid from public.payments where invoice_id = v_inv and deleted_at is null;
    update public.invoices set paid_cents = v_paid, status = case when v_paid >= total_cents then 'paid' else 'issued' end where id = v_inv;
  end if;
  return public.op_save(p_op, 'payment_add', jsonb_build_object('ok', true, 'rows', public.job_payload(v_job)));
end $$;

-- ---------- the draft invoice follows the job's work ----------
-- (security definer: it changes the invoice whoever changed the work; « a person » is read from the role of the
--  request, which a security definer function does not change)
create or replace function public.job_items_invoice_follow() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_was boolean; v_is boolean; v_person boolean;
begin
  v_was := old.deleted_at is null and old.status in ('planned', 'done', 'approved');
  v_is := new.deleted_at is null and new.status in ('planned', 'done', 'approved');
  if v_was = v_is and new.unit_cents is not distinct from old.unit_cents and new.qty is not distinct from old.qty
    and new.description is not distinct from old.description and new.taxable is not distinct from old.taxable then
    return new;
  end if;
  select * into inv from public.invoices v where v.job_id = new.job_id and v.status <> 'void' and v.deleted_at is null
    and exists (select 1 from jsonb_array_elements(v.lines) l where l->>'item_id' = new.id::text)
  limit 1 for update;
  if not found then return new; end if;
  if inv.status <> 'draft' then
    v_person := coalesce(current_setting('role', true), '') in ('authenticated', 'anon') and coalesce(current_setting('garage.rpc', true), '') <> 'on';
    if v_person and (v_was <> v_is or new.unit_cents is distinct from old.unit_cents or new.qty is distinct from old.qty) then
      perform public.fail('invoice_done', 'La facture est terminée : touche « Modifier la facture » d’abord.');
    end if;
    return new;
  end if;
  if not v_is then
    update public.invoices set lines = coalesce((select jsonb_agg(x.l order by x.n) from jsonb_array_elements(inv.lines) with ordinality x(l, n)
      where x.l->>'item_id' is distinct from new.id::text), '[]'::jsonb)
    where id = inv.id;
  elsif v_was then
    -- only what changed on the work: a price written on the invoice by hand stays when the work is only marked done
    update public.invoices set lines = (select jsonb_agg(case when x.l->>'item_id' = new.id::text then x.l
        || case when new.unit_cents is distinct from old.unit_cents then jsonb_build_object('unit_cents', new.unit_cents) else '{}'::jsonb end
        || case when new.qty is distinct from old.qty then jsonb_build_object('qty', new.qty) else '{}'::jsonb end
        || case when new.description is distinct from old.description then jsonb_build_object('description', new.description) else '{}'::jsonb end
        || case when new.taxable is distinct from old.taxable then jsonb_build_object('taxable', new.taxable) else '{}'::jsonb end
      else x.l end order by x.n) from jsonb_array_elements(inv.lines) with ordinality x(l, n))
    where id = inv.id;
  end if;
  return new;
end $$;
revoke all on function public.job_items_invoice_follow() from public, anon, authenticated;
drop trigger if exists job_items_invoice_follow on public.job_items;
create trigger job_items_invoice_follow after update on public.job_items for each row execute function public.job_items_invoice_follow();

-- ---------- « Changer le prix »: the draft invoice comes back with the line ----------
create or replace function public.job_item_price(p_op uuid, p_item uuid, p_unit_cents integer) returns jsonb
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
    perform public.fail('invoice_done', 'La facture est terminée : touche « Modifier la facture » d’abord pour changer un prix.');
  end if;
  v_old := i.unit_cents;
  perform set_config('garage.rpc', 'on', true);
  -- a discount keeps its sign; the price written is what one unit costs
  update public.job_items set unit_cents = case when kind = 'discount' then -abs(p_unit_cents) else p_unit_cents end where id = i.id;
  insert into public.activity (actor, entity, entity_id, action, data)
  values (auth.uid(), 'job', j.id, 'price_changed', jsonb_build_object('item', i.id, 'description', i.description, 'from', v_old, 'to', p_unit_cents));
  return public.op_save(p_op, 'job_item_price', jsonb_build_object('ok', true, 'rows', jsonb_build_object(
    'job_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.job_items x where x.id = i.id),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.invoices x where x.job_id = j.id))));
end $$;
