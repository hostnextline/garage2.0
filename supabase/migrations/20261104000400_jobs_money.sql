-- Part 4: a job from « Je pars » to « Payé », invoices, payments, quick estimates, walk-ins, parts used.

-- ---------- who works this job ----------
create or replace function public.job_actor(j public.jobs) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.can('book') or j.truck_id = any(public.my_truck_ids()) or (j.created_by = auth.uid() and public.is_field())
$$;
create or replace function public.job_payload(p_job uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'jobs', (select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb) from public.jobs j where j.id = p_job),
    'job_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.job_items i where i.job_id = p_job),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from public.invoices v where v.job_id = p_job),
    'payments', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.payments p where p.job_id = p_job or p.invoice_id in (select id from public.invoices where job_id = p_job)),
    'trips', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.trips t where t.job_id = p_job))
$$;

-- the live invoice of a job (not cancelled)
create or replace function public.job_invoice(p_job uuid) returns public.invoices language sql stable security definer set search_path = public as $$
  select v from public.invoices v where v.job_id = p_job and v.status <> 'void' and v.deleted_at is null limit 1
$$;
create or replace function public.job_paid(p_job uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select v.status = 'paid' from public.invoices v where v.job_id = p_job and v.status <> 'void' and v.deleted_at is null limit 1), false)
$$;

/* ---------- moving a job forward ----------
   job_step(op, job, action, data):
     leave   booked → en_route   (refused while this truck still has an unpaid job on site today)
     arrive  en_route → on_site
     finish  on_site → done      (needs the invoice paid; « Le client paiera plus tard » needs the right to edit invoices)
     cancel  booked/en_route → cancelled  {lost_cents, reason}
     no_show booked/en_route/on_site → no_show {lost_cents, reason}
     reopen  cancelled/no_show → booked (the block must still have room)
     back    en_route → booked, on_site → en_route (a mistake)
     waiver  records the customer's signature {attachment_id, signer, version} */
create or replace function public.job_step(p_op uuid, p_job uuid, p_action text, p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); j public.jobs; inv public.invoices; v_lost int; b record; v_plan jsonb; v_lat double precision; v_lng double precision;
begin
  if v_done is not null then return v_done; end if;
  select * into j from public.jobs where id = p_job and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cette job n’existe plus.'); end if;
  if not public.job_actor(j) then perform public.fail('not_allowed', 'Cette job n’est pas à toi.'); end if;
  perform set_config('garage.rpc', 'on', true);
  inv := public.job_invoice(j.id);
  v_lost := coalesce(nullif(p_data->>'lost_cents', '')::int,
    (select coalesce(sum(round(i.qty * i.unit_cents)), 0)::int from public.job_items i where i.job_id = j.id and i.deleted_at is null and i.status in ('planned','done','approved')));

  case p_action
  when 'leave' then
    if j.status <> 'booked' then perform public.fail('bad_step', 'Cette job est déjà partie.'); end if;
    if exists (select 1 from public.jobs o where o.id <> j.id and o.day = j.day and o.truck_id is not distinct from j.truck_id and j.truck_id is not null
                 and o.status = 'on_site' and o.deleted_at is null and not public.job_paid(o.id) and not o.pay_later) then
      perform public.fail('unpaid_here', 'La job d’avant n’est pas encore payée : encaisse-la avant de partir.');
    end if;
    update public.jobs set status = 'en_route', started_at = now() where id = j.id;
  when 'arrive' then
    if j.status <> 'en_route' then perform public.fail('bad_step', 'Touche d’abord « Je pars ».'); end if;
    update public.jobs set status = 'on_site', arrived_at = now() where id = j.id;
    update public.trips set status = 'arrived', ended_at = now() where job_id = j.id and status = 'active';
  when 'finish' then
    if j.status not in ('on_site','en_route') then perform public.fail('bad_step', 'Cette job n’est pas sur place.'); end if;
    if not public.job_paid(j.id) then
      if coalesce((p_data->>'pay_later')::boolean, false) then
        if not (public.is_owner() or public.can('edit_invoices')) then
          perform public.fail('pay_first', 'Paiement requis avant de partir. Seul le bureau peut laisser partir sans paiement.');
        end if;
        if inv.id is null or inv.status = 'draft' then perform public.fail('invoice_first', 'Termine la facture d’abord.'); end if;
        update public.jobs set pay_later = true, pay_later_reason = nullif(p_data->>'reason', '') where id = j.id;
      else
        perform public.fail('pay_first', 'Paiement requis avant de partir : encaisse la facture.');
      end if;
    end if;
    update public.jobs set status = 'done', finished_at = now(), arrived_at = coalesce(arrived_at, now()) where id = j.id;
    update public.trips set status = 'arrived', ended_at = now() where job_id = j.id and status = 'active';
    perform public.use_parts(j.id);
  when 'cancel' then
    if j.status not in ('booked','en_route') then perform public.fail('bad_step', 'Cette job ne peut plus être annulée.'); end if;
    update public.jobs set status = 'cancelled', cancelled_at = now(), lost_cents = v_lost, lost_reason = nullif(p_data->>'reason', '') where id = j.id;
    update public.trips set status = 'cancelled', ended_at = now() where job_id = j.id and status = 'active';
    perform public.replan_block(j.day, j.block);
  when 'no_show' then
    if j.status not in ('booked','en_route','on_site') then perform public.fail('bad_step', 'Cette job ne peut plus passer à « Client absent ».'); end if;
    update public.jobs set status = 'no_show', cancelled_at = now(), lost_cents = v_lost, lost_reason = nullif(p_data->>'reason', '') where id = j.id;
    update public.customers set no_shows = no_shows + 1 where id = j.customer_id;
    update public.trips set status = 'cancelled', ended_at = now() where job_id = j.id and status = 'active';
    perform public.replan_block(j.day, j.block);
  when 'reopen' then
    if j.status not in ('cancelled','no_show') then perform public.fail('bad_step', 'Cette job est déjà à l’agenda.'); end if;
    select * into b from public.blocks() x where x.key = j.block;
    if j.day < public.local_today() or (j.day = public.local_today() and public.now_min() >= b.start_min) then
      perform public.fail('block_started', 'Ce bloc est passé : déplace la job vers un autre moment.');
    end if;
    perform public.lock_block(j.day, j.block);
    select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into v_lat, v_lng from public.customers c where c.id = j.customer_id;
    v_plan := public.plan_block(j.day, j.block, jsonb_build_object('id', j.id, 'lat', v_lat, 'lng', v_lng, 'dur', j.duration_min), j.id);
    if not coalesce((v_plan->'extra'->>'placed')::boolean, false) then
      perform public.fail('block_full', 'Ce bloc est complet maintenant : déplace la job vers un autre moment.');
    end if;
    if j.status = 'no_show' then update public.customers set no_shows = greatest(0, no_shows - 1) where id = j.customer_id; end if;
    update public.jobs set status = 'booked', cancelled_at = null, lost_cents = null, lost_reason = null, started_at = null, arrived_at = null where id = j.id;
    perform public.apply_plan(public.plan_block(j.day, j.block));
  when 'back' then
    if j.status = 'en_route' then
      update public.jobs set status = 'booked', started_at = null where id = j.id;
      update public.trips set status = 'cancelled', ended_at = now() where job_id = j.id and status = 'active';
    elsif j.status = 'on_site' then
      update public.jobs set status = 'en_route', arrived_at = null where id = j.id;
    elsif j.status = 'done' and (public.is_owner() or public.can('book')) then
      update public.jobs set status = 'on_site', finished_at = null where id = j.id;
    else perform public.fail('bad_step', 'Rien à défaire.'); end if;
  when 'waiver' then
    if nullif(p_data->>'signer', '') is null then perform public.fail('signer', 'Écris le nom de la personne qui signe.'); end if;
    update public.jobs set waiver_signed_at = now(), waiver_signer = p_data->>'signer', waiver_version = nullif(p_data->>'version', ''),
      waiver_attachment = nullif(p_data->>'attachment_id', '')::uuid where id = j.id;
  else
    perform public.fail('bad_step', 'Étape inconnue.');
  end case;
  return public.op_save(p_op, 'job_step', jsonb_build_object('ok', true, 'action', p_action, 'rows', public.job_payload(j.id)));
end $$;

-- parts used on a finished job leave the inventory (once)
create or replace function public.use_parts(p_job uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.inventory_moves where job_id = p_job and reason = 'used' and deleted_at is null) then return; end if;
  insert into public.inventory_moves (item_id, delta, reason, job_id, note, created_by)
  select x.item_id, -sum(x.qty), 'used', p_job, 'Job ' || (select number from public.jobs where id = p_job), auth.uid()
  from (
    select i.item_id, i.qty from public.job_items i
    where i.job_id = p_job and i.deleted_at is null and i.item_id is not null and i.status in ('planned','done','approved')
    union all
    select sp.item_id, sp.qty * i.qty from public.job_items i join public.service_parts sp on sp.service_id = i.service_id and sp.deleted_at is null
    where i.job_id = p_job and i.deleted_at is null and i.status in ('planned','done','approved')
  ) x
  join public.inventory_items it on it.id = x.item_id and it.deleted_at is null
  group by x.item_id;
end $$;

/* ---------- an invoice ----------
   Totals are always computed here, from the lines (the screen only shows them). */
create or replace function public.invoice_totals() returns trigger language plpgsql security definer set search_path = public as $$
declare tx jsonb := (select taxes from public.settings where id = 1); l jsonb; s int := 0; taxable int := 0; lt int; lines jsonb := '[]';
begin
  if tg_op = 'UPDATE' and old.status <> 'draft' and coalesce(current_setting('garage.rpc', true), '') = 'on' and new.lines = old.lines then
    return new;  -- payment / cancel on a finished invoice: keep its totals
  end if;
  for l in select * from jsonb_array_elements(coalesce(new.lines, '[]')) loop
    lt := round(coalesce((l->>'qty')::numeric, 1) * coalesce((l->>'unit_cents')::numeric, 0))::int;
    if l->>'kind' = 'discount' and lt > 0 then lt := -lt; end if;
    s := s + lt;
    if coalesce((l->>'taxable')::boolean, true) then taxable := taxable + lt; end if;
    lines := lines || jsonb_build_array(l || jsonb_build_object('total_cents', lt));
  end loop;
  new.lines := lines;
  new.subtotal_cents := s;
  new.taxable_cents := greatest(taxable, 0);
  if new.taxes_on and coalesce((tx->>'enabled')::boolean, true) and taxable > 0 then
    new.tps_cents := round(taxable * coalesce((tx->>'tps')::numeric, 0.05));
    new.tvq_cents := round(taxable * coalesce((tx->>'tvq')::numeric, 0.09975));
  else
    new.tps_cents := 0; new.tvq_cents := 0;
  end if;
  new.total_cents := s + new.tps_cents + new.tvq_cents;
  return new;
end $$;
create trigger invoices_totals before insert or update on public.invoices for each row execute function public.invoice_totals();

-- lines of a job, as they go on its invoice: the work done (or booked), accepted extras; prepayments are payments
create or replace function public.job_lines(p_job uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('description', i.description, 'qty', i.qty, 'unit_cents', i.unit_cents, 'taxable', i.taxable,
    'kind', i.kind, 'item_id', i.id) order by i.sort, i.created_at), '[]'::jsonb)
  from public.job_items i where i.job_id = p_job and i.deleted_at is null and i.status in ('planned','done','approved')
$$;

-- makes (or refreshes, while still a draft) the invoice of a job from its work
create or replace function public.invoice_for_job(p_op uuid, p_job uuid, p_refresh boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); j public.jobs; inv public.invoices; v_lang text;
begin
  if v_done is not null then return v_done; end if;
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Cette job n’existe plus.'); end if;
  if not public.invoice_editable(j.id) then perform public.fail('not_allowed', 'Tu ne peux pas faire la facture de cette job.'); end if;
  perform set_config('garage.rpc', 'on', true);
  inv := public.job_invoice(j.id);
  select lang into v_lang from public.customers where id = j.customer_id;
  if inv.id is null then
    insert into public.invoices (job_id, customer_id, status, lines, lang, created_by)
    values (j.id, j.customer_id, 'draft', public.job_lines(j.id), coalesce(v_lang, 'fr'), auth.uid());
  elsif inv.status = 'draft' and p_refresh then
    update public.invoices set lines = public.job_lines(j.id), customer_id = j.customer_id where id = inv.id;
  end if;
  return public.op_save(p_op, 'invoice_for_job', jsonb_build_object('ok', true, 'rows', public.job_payload(j.id)));
end $$;

-- « Terminer la facture »: its number (the next one, never twice, never skipped), its date, prepayments applied
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
  update public.counters set next_value = next_value + 1 where name = 'invoice' returning next_value - 1 into v_no;
  -- payments made before the invoice (online prepayment) count on it
  update public.payments set invoice_id = inv.id where job_id = inv.job_id and invoice_id is null and deleted_at is null;
  select coalesce(sum(amount_cents), 0)::int into v_paid from public.payments where invoice_id = inv.id and deleted_at is null;
  v_due := coalesce((v_bill->>'due_days')::int, 0);
  update public.invoices set number = v_no, status = case when v_paid >= total_cents then 'paid' else 'issued' end, issued_at = now(),
    due_on = public.local_today() + v_due, paid_cents = v_paid
  where id = inv.id;
  return public.op_save(p_op, 'invoice_finish', jsonb_build_object('ok', true, 'number', v_no, 'rows', public.job_payload(inv.job_id)));
end $$;

-- a payment taken (cash, debit, credit, Interac, card online…)
create or replace function public.payment_add(p_op uuid, p_invoice uuid, p_amount_cents int, p_method text, p_reference text default null,
  p_job uuid default null, p_session text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); inv public.invoices; v_paid int; v_job uuid;
begin
  if v_done is not null then return v_done; end if;
  if p_amount_cents is null or p_amount_cents = 0 then perform public.fail('amount', 'Écris le montant reçu.'); end if;
  if p_method not in ('cash','debit','credit','interac','card_online','cheque','other') then perform public.fail('method', 'Choisis le mode de paiement.'); end if;
  perform set_config('garage.rpc', 'on', true);
  if p_invoice is not null then
    select * into inv from public.invoices where id = p_invoice and deleted_at is null for update;
    if not found then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
    if auth.uid() is not null and not public.invoice_editable(inv.job_id) then perform public.fail('not_allowed', 'Tu ne peux pas encaisser cette facture.'); end if;
    if inv.status = 'void' then perform public.fail('void', 'Cette facture est annulée.'); end if;
    if inv.status = 'draft' then perform public.fail('invoice_first', 'Termine la facture avant d’encaisser.'); end if;
    v_job := inv.job_id;
  else
    v_job := p_job;
    if v_job is null then perform public.fail('not_found', 'Rien à payer.'); end if;
    if auth.uid() is not null and not public.invoice_editable(v_job) then perform public.fail('not_allowed', 'Tu ne peux pas encaisser cette job.'); end if;
  end if;
  insert into public.payments (invoice_id, job_id, amount_cents, method, reference, stripe_session, created_by)
  values (p_invoice, v_job, p_amount_cents, p_method, nullif(p_reference, ''), p_session, auth.uid());
  if p_invoice is not null then
    select coalesce(sum(amount_cents), 0)::int into v_paid from public.payments where invoice_id = p_invoice and deleted_at is null;
    update public.invoices set paid_cents = v_paid, status = case when v_paid >= total_cents then 'paid' else 'issued' end where id = p_invoice;
  end if;
  return public.op_save(p_op, 'payment_add', jsonb_build_object('ok', true, 'rows', public.job_payload(v_job)));
end $$;

-- a payment entered by mistake
create or replace function public.payment_remove(p_op uuid, p_payment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); p public.payments; v_paid int; v_job uuid;
begin
  if v_done is not null then return v_done; end if;
  select * into p from public.payments where id = p_payment and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Ce paiement n’existe plus.'); end if;
  if not (public.is_owner() or public.can('edit_invoices')) then perform public.fail('not_allowed', 'Seul le bureau peut retirer un paiement.'); end if;
  if p.method = 'card_online' then perform public.fail('online', 'Un paiement par carte en ligne se rembourse dans Stripe.'); end if;
  perform set_config('garage.rpc', 'on', true);
  update public.payments set deleted_at = now() where id = p.id;
  v_job := coalesce(p.job_id, (select job_id from public.invoices where id = p.invoice_id));
  if p.invoice_id is not null then
    select coalesce(sum(amount_cents), 0)::int into v_paid from public.payments where invoice_id = p.invoice_id and deleted_at is null;
    update public.invoices set paid_cents = v_paid, status = case when status = 'void' then 'void' when v_paid >= total_cents then 'paid' else 'issued' end where id = p.invoice_id;
  end if;
  return public.op_save(p_op, 'payment_remove', jsonb_build_object('ok', true, 'rows', public.job_payload(v_job)));
end $$;

-- cancels a finished invoice (its number stays used); the job can get a new one
create or replace function public.invoice_void(p_op uuid, p_invoice uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); inv public.invoices;
begin
  if v_done is not null then return v_done; end if;
  select * into inv from public.invoices where id = p_invoice and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
  if not (public.is_owner() or public.can('edit_invoices')) then perform public.fail('not_allowed', 'Seul le bureau peut annuler une facture.'); end if;
  if coalesce(trim(p_reason), '') = '' then perform public.fail('reason', 'Écris pourquoi la facture est annulée.'); end if;
  if inv.status = 'draft' then
    perform set_config('garage.rpc', 'on', true);
    update public.invoices set deleted_at = now() where id = inv.id;
  else
    if exists (select 1 from public.payments where invoice_id = inv.id and deleted_at is null) then
      perform public.fail('has_payments', 'Cette facture a des paiements : retire-les (ou rembourse) avant de l’annuler.');
    end if;
    perform set_config('garage.rpc', 'on', true);
    update public.invoices set status = 'void', voided_at = now(), void_reason = p_reason where id = inv.id;
  end if;
  return public.op_save(p_op, 'invoice_void', jsonb_build_object('ok', true, 'rows', public.job_payload(inv.job_id)));
end $$;

/* ---------- work on the spot ----------
   walk_in(op, job, items): a customer met on the road, work starting now on my truck (no booking ahead) */
create or replace function public.walk_in(p_op uuid, p_job jsonb, p_items jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); v_id uuid := coalesce(nullif(p_job->>'id', '')::uuid, gen_random_uuid());
  v_truck uuid := nullif(p_job->>'truck_id', '')::uuid; v_block text; v_now int := public.now_min(); it jsonb; k int := 0; v_dur int;
begin
  if v_done is not null then return v_done; end if;
  if not public.is_field() then perform public.fail('not_allowed', 'Tu ne peux pas ouvrir une job.'); end if;
  if v_truck is null then v_truck := (public.my_truck_ids())[1]; end if;
  if v_truck is not null and not (v_truck = any(public.my_truck_ids()) or public.can('book') or public.is_owner()) then
    perform public.fail('not_allowed', 'Ce camion n’est pas le tien.');
  end if;
  if nullif(p_job->>'customer_id', '') is null then perform public.fail('no_customer', 'Choisis le client (ou crée sa fiche).'); end if;
  if not public.customer_visible((p_job->>'customer_id')::uuid) then perform public.fail('not_allowed', 'Tu n’as pas accès à ce client.'); end if;
  select x.key into v_block from public.blocks() x where v_now >= x.start_min and v_now < x.end_min;
  if v_block is null then v_block := case when v_now < 720 then 'am' when v_now < 960 then 'pm' else 'eve' end; end if;
  v_dur := greatest(15, least(720, coalesce(nullif(p_job->>'duration_min', '')::int,
    (select sum(coalesce((e->>'duration_min')::int, 0)) from jsonb_array_elements(p_items) e), 60)));
  perform set_config('garage.rpc', 'on', true);
  insert into public.jobs (id, customer_id, vehicle_id, day, block, truck_id, truck_pinned, duration_min, status, problem, notes,
    address, unit, postal_code, lat, lng, source, quote_id, arrived_at, started_at, created_by)
  values (v_id, (p_job->>'customer_id')::uuid, nullif(p_job->>'vehicle_id', '')::uuid, public.local_today(), v_block, v_truck, v_truck is not null,
    v_dur, 'on_site', nullif(p_job->>'problem', ''), nullif(p_job->>'notes', ''), nullif(p_job->>'address', ''), nullif(p_job->>'unit', ''),
    nullif(p_job->>'postal_code', ''), nullif(p_job->>'lat', '')::double precision, nullif(p_job->>'lng', '')::double precision,
    case when nullif(p_job->>'quote_id', '') is null then 'walk_in' else 'quote' end, nullif(p_job->>'quote_id', '')::uuid, now(), now(), auth.uid());
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    k := k + 1;
    insert into public.job_items (id, job_id, kind, service_id, item_id, description, qty, unit_cents, taxable, duration_min, status, sort)
    values (coalesce(nullif(it->>'id', '')::uuid, gen_random_uuid()), v_id, coalesce(nullif(it->>'kind', ''), 'service'), nullif(it->>'service_id', '')::uuid,
      nullif(it->>'item_id', '')::uuid, it->>'description', coalesce((it->>'qty')::numeric, 1), coalesce((it->>'unit_cents')::int, 0),
      coalesce((it->>'taxable')::boolean, true), nullif(it->>'duration_min', '')::int, 'done', k);
  end loop;
  if nullif(p_job->>'quote_id', '') is not null then
    update public.quotes set status = 'converted', job_id = v_id where id = (p_job->>'quote_id')::uuid;
  end if;
  return public.op_save(p_op, 'walk_in', jsonb_build_object('ok', true, 'job_id', v_id, 'rows', public.job_payload(v_id)));
end $$;

-- extra work: the mechanic's own answer for the customer standing there (signature or « il a dit oui »)
create or replace function public.extra_answer(p_op uuid, p_item uuid, p_accept boolean, p_via text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); it public.job_items; j public.jobs;
begin
  if v_done is not null then return v_done; end if;
  select * into it from public.job_items where id = p_item and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Ce travail n’existe plus.'); end if;
  select * into j from public.jobs where id = it.job_id;
  if not public.job_actor(j) then perform public.fail('not_allowed', 'Cette job n’est pas à toi.'); end if;
  if p_via not in ('signature','verbal') then perform public.fail('via', 'Réponse inconnue.'); end if;
  if it.status not in ('proposed','approved','declined') then perform public.fail('not_extra', 'Ce n’est pas un travail proposé.'); end if;
  update public.job_items set status = case when p_accept then 'approved' else 'declined' end, answered_at = now(), answered_via = p_via where id = it.id;
  return public.op_save(p_op, 'extra_answer', jsonb_build_object('ok', true, 'rows', public.job_payload(j.id)));
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema public to service_role;
