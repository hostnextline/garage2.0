-- Part 27 — « Refonte », the money rules: invoices, payments, the Coffre, stock purchases.
--
-- Every function here is the LIVE text (pg_get_functiondef) with only what a verified finding needs. Nothing is removed
-- or renamed, no argument changes: yesterday's app keeps working. What changes:
--
--   exactly once          every operation of this file claims its op first (op_begin): the same request arriving twice at
--                         the same instant runs once (before: two payments, two stock purchases).
--   payment_add           · a card payment confirmed by Stripe (the server: no person, « card_online ») is NEVER refused:
--                           on the invoice when it can, else on the job's finished invoice, else waiting on the job, with a
--                           note the owner sees (activity « payment_unmatched »). Before: an invoice cancelled, deleted or
--                           sent to the Coffre while the card page was open lost the payment.
--                         · the same Stripe session twice = once (answer « already »), without an error.
--                         · a person may not record more than what is left to pay (« too_much »), nor « carte en ligne »
--                           by hand, nor a Stripe session; money given back (a negative amount) is for the office only and
--                           never more than what was paid (« refund_too_much »).
--                         · a card refund (the server, a negative « card_online », session « <checkout>#<refund> ») goes
--                           where the original payment is; the invoice follows (no longer fully paid = « issued » again).
--                           A refund that failed, taken back (« …#echec », positive), goes where that refund is.
--                         · locks the job, then the invoice: a card payment that lands while the invoice is being finished
--                           no longer stays beside it.
--   payment_remove        same lock order; a payment whose refund is noted is not removed alone (« refund_first »).
--   invoice_finish        the totals are recomputed before the checks; a first finish under what was paid ahead is kept
--                         « paid » and SAID (« over_cents » in the answer, activity « overpaid »); a reopened invoice keeps
--                         its first date; the number never falls behind the highest one; the answer lists the work of the
--                         job that is not on the invoice (« unbilled »).
--   invoice_reopen        a PAID invoice of an appointment still open opens again too (its payments wait on the job):
--                         the only way to bill work added after the customer paid.
--   invoice_void          a draft that has a number (« Modifier la facture ») is cancelled, never deleted: its number stays
--                         in the books; payments and their refunds that add up to zero no longer block; the customer's
--                         open card page is forgotten.
--   invoice_totals        a finished invoice keeps its totals whoever touches the row (before: only through an operation;
--                         a text sent by the server recomputed the taxes with today's settings).
--   job_items_invoice_follow   work that becomes billable (a new line, an extra the customer accepts) goes on the job's
--                         DRAFT by itself. A finished invoice is never changed by itself:
--   jobs_unbilled_guard   an appointment is not « Terminé » while billable work is on no line of its finished invoice
--                         (« unbilled »): « Modifier la facture », or mark that work « Pas fait ».
--   invoices_number_keep  an invoice that has a number is never deleted (« numbered »), by anybody.
--   coffre_add            written in full (its running text was the base + two patches); a numbered draft is cancelled, not
--                         deleted; the person must see the jobs; payments are counted net.
--   coffre_remove         removing a purchase takes its stock back out (before: the money came back, the stock stayed).
--   inventory_buy         the money row knows its stock move (expenses.move_id, coffre.move_id).
--   use_parts             a quantity that rounds to zero no longer blocks « Terminer ».
--   job_item_price        a line priced below zero (a rebate kept as a service) stays below zero when its price changes.
--
-- New refusal codes: too_much, refund_too_much, refund_first, unbilled, numbered.
-- New columns (no table): coffre.move_id, expenses.move_id (plain ids, no foreign key: the backup restores table by table).

alter table public.coffre add column if not exists move_id uuid;
alter table public.expenses add column if not exists move_id uuid;
comment on column public.coffre.move_id is 'The stock move this Coffre purchase made (inventory_buy); null for a purchase made before Part 27.';
comment on column public.expenses.move_id is 'The stock move this expense paid for (inventory_buy); null for an expense typed by hand.';

-- ───────────────────────── small building blocks (server only) ─────────────────────────

-- 1234567 → « 12 345,67 » is not needed here: the same plain form the refusals already used (« 20,00 »).
create or replace function public.cents_text(p_cents int) returns text language sql immutable set search_path = public as $$
  select replace(to_char(coalesce(p_cents, 0) / 100.0, 'FM9999990.00'), '.', ',')
$$;
revoke all on function public.cents_text(int) from public, anon, authenticated;
grant execute on function public.cents_text(int) to service_role;

-- The work of a job that is billable (planned, done, accepted) and on no line of its FINISHED invoice: [{ id, description }].
-- Empty while the job has no finished invoice (a draft follows the work by itself; a Coffre job has no invoice).
create or replace function public.job_unbilled(p_job uuid) returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'description', i.description) order by i.sort, i.created_at), '[]'::jsonb)
  from public.job_items i
  join public.invoices v on v.job_id = i.job_id and v.deleted_at is null and v.status in ('issued', 'paid')
  where i.job_id = p_job and i.deleted_at is null and i.status in ('planned', 'done', 'approved')
    and not exists (select 1 from jsonb_array_elements(v.lines) l where l->>'item_id' = i.id::text)
$$;
revoke all on function public.job_unbilled(uuid) from public, anon, authenticated;
grant execute on function public.job_unbilled(uuid) to service_role;

-- ───────────────────────── invoices ─────────────────────────

-- A1 of the audit (never applied on live): an issued invoice keeps its totals whoever touches the row. Compatible with
-- « Modifier la facture »: reopening keeps the lines, so the totals stay; the draft then recomputes at its next change.
create or replace function public.invoice_totals() returns trigger language plpgsql security definer set search_path = public as $$
declare tx jsonb := (select taxes from public.settings where id = 1); l jsonb; s int := 0; taxable int := 0; lt int; lines jsonb := '[]';
begin
  if tg_op = 'UPDATE' and old.status <> 'draft' and new.lines = old.lines then
    return new;  -- payment, cancel, re-send… on a finished invoice: its totals stay as issued
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

-- An invoice that has a number is never deleted: it is cancelled (« void », its number stays in the books).
create or replace function public.invoices_number_keep() returns trigger language plpgsql set search_path = public as $$
begin
  perform public.fail('numbered', 'Une facture qui a un numéro ne se supprime pas : annule-la (son numéro reste dans les livres).');
  return new;
end $$;
revoke all on function public.invoices_number_keep() from public, anon, authenticated;
drop trigger if exists invoices_number_keep on public.invoices;
create trigger invoices_number_keep before update of deleted_at on public.invoices for each row
  when (new.deleted_at is not null and old.deleted_at is null and new.number is not null)
  execute function public.invoices_number_keep();

create or replace function public.invoice_for_job(p_op uuid, p_job uuid, p_refresh boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; j public.jobs; inv public.invoices; v_lang text;
begin
  v_done := public.op_begin(p_op, 'invoice_for_job');
  if v_done is not null then return v_done; end if;
  -- the job is locked: two requests making the same draft at once make one (the second finds it)
  select * into j from public.jobs where id = p_job and deleted_at is null for update;
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

create or replace function public.invoice_finish(p_op uuid, p_invoice uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; inv public.invoices; v_no bigint; v_paid int; v_due int; v_max bigint; v_over int;
  v_bill jsonb := (select billing from public.settings where id = 1);
begin
  v_done := public.op_begin(p_op, 'invoice_finish');
  if v_done is not null then return v_done; end if;
  -- the job first, then the invoice: the same order as payment_add, so a card payment landing now waits for this finish
  select * into inv from public.invoices where id = p_invoice and deleted_at is null;
  if not found then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
  if inv.job_id is not null then perform 1 from public.jobs where id = inv.job_id for update; end if;
  select * into inv from public.invoices where id = p_invoice and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
  if not public.invoice_editable(inv.job_id) then perform public.fail('not_allowed', 'Tu ne peux pas terminer cette facture.'); end if;
  if inv.status <> 'draft' then
    return public.op_save(p_op, 'invoice_finish', jsonb_build_object('ok', true, 'already', true, 'rows', public.job_payload(inv.job_id)));
  end if;
  perform set_config('garage.rpc', 'on', true);
  -- its totals as its lines and today's taxes make them (a draft last saved before the tax settings changed)
  update public.invoices set updated_at = now() where id = inv.id returning * into inv;
  if jsonb_array_length(inv.lines) = 0 then perform public.fail('empty', 'Ajoute au moins une ligne avant de terminer la facture.'); end if;
  if exists (select 1 from jsonb_array_elements(inv.lines) l where coalesce(trim(l->>'description'), '') = '') then
    perform public.fail('no_description', 'Une ligne n’a pas de description.');
  end if;
  if inv.total_cents < 0 then perform public.fail('negative', 'Le total est négatif. Vérifie le rabais.'); end if;
  -- payments made before the invoice (online prepayment, or paid before « Modifier la facture ») count on it
  update public.payments set invoice_id = inv.id where job_id = inv.job_id and invoice_id is null and deleted_at is null;
  select coalesce(sum(amount_cents), 0)::int into v_paid from public.payments where invoice_id = inv.id and deleted_at is null;
  if inv.number is not null and v_paid > inv.total_cents then
    perform public.fail('below_paid', format('Le client a déjà payé %s $ : le total ne peut pas être plus bas.', public.cents_text(v_paid)));
  end if;
  v_no := inv.number;
  if v_no is null then
    -- the next number; never behind the highest one already given (a counter put back by a partial restore)
    select coalesce(max(number), 0) into v_max from public.invoices;
    insert into public.counters as c (name, next_value) values ('invoice', v_max + 2)
    on conflict (name) do update set next_value = greatest(c.next_value, v_max + 1) + 1
    returning c.next_value - 1 into v_no;
  end if;
  v_due := coalesce((v_bill->>'due_days')::int, 0);
  -- a reopened invoice keeps the day it was first issued (its number and its date stay in the same order)
  update public.invoices set number = v_no, status = case when v_paid >= total_cents then 'paid' else 'issued' end,
    issued_at = case when inv.number is not null then coalesce(issued_at, now()) else now() end,
    due_on = case when inv.number is not null then coalesce(due_on, public.local_today() + v_due) else public.local_today() + v_due end,
    paid_cents = v_paid
  where id = inv.id;
  -- paid ahead more than the final total (a line taken off after the customer paid): the money is in, the invoice is
  -- paid, and what must go back to the customer is said (never silent)
  v_over := greatest(v_paid - inv.total_cents, 0);
  if v_over > 0 then
    insert into public.activity (actor, entity, entity_id, action, data)
    values (auth.uid(), case when inv.job_id is null then 'invoices' else 'job' end, coalesce(inv.job_id, inv.id), 'overpaid',
      jsonb_build_object('invoice', inv.id, 'number', v_no, 'total', inv.total_cents, 'paid', v_paid, 'over', v_over));
  end if;
  return public.op_save(p_op, 'invoice_finish', jsonb_build_object('ok', true, 'number', v_no, 'again', inv.number is not null,
    'over_cents', v_over, 'unbilled', public.job_unbilled(inv.job_id), 'rows', public.job_payload(inv.job_id)));
end $$;

create or replace function public.invoice_reopen(p_op uuid, p_invoice uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; inv public.invoices; j public.jobs; v_pays int;
begin
  v_done := public.op_begin(p_op, 'invoice_reopen');
  if v_done is not null then return v_done; end if;
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi avec ton compte de l’équipe.'); end if;
  select * into inv from public.invoices where id = p_invoice and deleted_at is null;
  if not found then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
  if inv.job_id is not null then perform 1 from public.jobs where id = inv.job_id for update; end if;   -- the job, then the invoice
  select * into inv from public.invoices where id = p_invoice and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
  if not public.invoice_editable(inv.job_id) then perform public.fail('not_allowed', 'Tu ne peux pas modifier cette facture.'); end if;
  if inv.status = 'draft' then
    return public.op_save(p_op, 'invoice_reopen', jsonb_build_object('ok', true, 'already', true, 'rows', public.job_payload(inv.job_id)));
  end if;
  if inv.status = 'void' then perform public.fail('void', 'Cette facture est annulée.'); end if;
  -- (a PAID invoice opens again too while the appointment is still open: work added after the customer paid can be
  -- billed; what was paid waits on the job, and the invoice finished again is « issued » with the rest to pay)
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
    'total', inv.total_cents, 'paid', inv.paid_cents, 'payments', v_pays, 'was', inv.status));
  return public.op_save(p_op, 'invoice_reopen', jsonb_build_object('ok', true, 'number', inv.number, 'rows', public.job_payload(j.id)));
end $$;

create or replace function public.invoice_void(p_op uuid, p_invoice uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; inv public.invoices; v_paid int;
begin
  v_done := public.op_begin(p_op, 'invoice_void');
  if v_done is not null then return v_done; end if;
  select * into inv from public.invoices where id = p_invoice and deleted_at is null;
  if not found then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
  if inv.job_id is not null then perform 1 from public.jobs where id = inv.job_id for update; end if;   -- the job, then the invoice
  select * into inv from public.invoices where id = p_invoice and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
  if not (public.is_owner() or public.can('edit_invoices')) then perform public.fail('not_allowed', 'Seul le bureau peut annuler une facture.'); end if;
  if coalesce(trim(p_reason), '') = '' then perform public.fail('reason', 'Écris pourquoi la facture est annulée.'); end if;
  if inv.status = 'draft' and inv.number is null then
    perform set_config('garage.rpc', 'on', true);
    update public.invoices set deleted_at = now() where id = inv.id;
  elsif inv.status = 'draft' then
    -- a draft that already has its number (« Modifier la facture »): the number was given, perhaps texted to the
    -- customer. It is cancelled with its reason and stays in the books; what was paid keeps waiting on the job.
    perform set_config('garage.rpc', 'on', true);
    update public.invoices set status = 'void', voided_at = now(), void_reason = p_reason where id = inv.id;
  else
    -- payments and the money given back that add up to zero do not hold the invoice
    select coalesce(sum(amount_cents), 0)::int into v_paid from public.payments where invoice_id = inv.id and deleted_at is null;
    if v_paid <> 0 then
      perform public.fail('has_payments', 'Cette facture a des paiements : retire-les (ou rembourse) avant de l’annuler.');
    end if;
    perform set_config('garage.rpc', 'on', true);
    update public.payments set invoice_id = null where invoice_id = inv.id and deleted_at is null and job_id is not null;
    update public.invoices set status = 'void', voided_at = now(), void_reason = p_reason where id = inv.id;
  end if;
  -- the card page the customer may have open for this invoice is not offered again
  if inv.job_id is not null then
    update public.public_links set last_session = null, last_session_url = null, last_session_amount = null, last_session_expires = null
    where job_id = inv.job_id and last_session is not null;
  end if;
  return public.op_save(p_op, 'invoice_void', jsonb_build_object('ok', true, 'rows', public.job_payload(inv.job_id)));
end $$;

-- ───────────────────────── payments ─────────────────────────

/* payment_add(op, invoice, amount, method, reference, job, session)
   A person (signed in): the invoice must be finished; never more than what is left to pay; never « card_online » nor a
     Stripe session; a negative amount = money given back by hand, for the office (owner / « edit_invoices ») only and
     never more than what was paid.
   The server (no person):
     card_online, amount > 0   a card payment Stripe confirmed. Never refused: on the invoice named when it is finished;
                               else on the job's finished invoice; else waiting on the job; noted for the owner when it
                               is not where it was meant to go.
     card_online, amount < 0   a card refund. session = « <checkout session>#<refund id> »: it goes where the payment of
                               that checkout session is (its invoice, or waiting on the job); the invoice follows.
     card_online, « …#echec »  a refund that failed, taken back (the opposite amount): it goes where that refund is.
     the same session again    nothing is written twice: { ok, already: true }. */
create or replace function public.payment_add(p_op uuid, p_invoice uuid, p_amount_cents integer, p_method text, p_reference text default null, p_job uuid default null, p_session text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; inv public.invoices; j public.jobs; v_paid int; v_job uuid; v_inv uuid := p_invoice;
  v_person boolean := auth.uid() is not null;
  v_card boolean := auth.uid() is null and p_method = 'card_online';          -- Stripe's word, brought by the server
  v_session text := case when auth.uid() is null then nullif(p_session, '') end;  -- a person never writes a Stripe session
  v_office boolean := false;   -- a person giving money back by hand
  v_pjob uuid := p_job; v_stay boolean := false;
  dup public.payments; orig public.payments;
  v_why text; v_was uuid; v_was_no bigint; v_left int; v_over int := 0; v_id uuid;
begin
  v_done := public.op_begin(p_op, 'payment_add');
  if v_done is not null then return v_done; end if;
  if p_amount_cents is null or p_amount_cents = 0 then perform public.fail('amount', 'Écris le montant reçu.'); end if;
  if p_method is null or p_method not in ('cash','debit','credit','interac','card_online','cheque','other') then perform public.fail('method', 'Choisis le mode de paiement.'); end if;
  if v_person then
    if p_method = 'card_online' then
      perform public.fail('method', 'La carte en ligne s’inscrit toute seule quand le client paie sa facture : choisis un autre mode de paiement.');
    end if;
    if p_amount_cents < 0 then
      if not (public.is_owner() or public.can('edit_invoices')) then perform public.fail('not_allowed', 'Seul le bureau peut noter de l’argent remis au client.'); end if;
      v_office := true;
    end if;
  end if;
  perform set_config('garage.rpc', 'on', true);

  -- the same Stripe session (or refund) is written once, whoever brings it (the notice, the customer's page, a retry)
  if v_session is not null then
    perform pg_advisory_xact_lock(hashtextextended('payment:' || v_session, 0));
    select * into dup from public.payments where stripe_session = v_session;
    if found then
      return public.op_save(p_op, 'payment_add', jsonb_build_object('ok', true, 'already', true,
        'rows', public.job_payload(coalesce(dup.job_id, (select v.job_id from public.invoices v where v.id = dup.invoice_id)))));
    end if;
    -- one rule for the money that belongs to a card payment: a card refund (« <checkout>#<refund> », negative) and a
    -- refund that failed, taken back (« <checkout>#<refund>#echec », positive) go where that money is NOW — the refund
    -- it takes back, else the payment of that checkout — never by their own way (before: a failed refund of a payment
    -- waiting on the job went on the job's finished invoice while its refund stayed on the job)
    if v_card and position('#' in v_session) > 1 and (p_amount_cents < 0 or v_session like '%#echec') then
      if p_amount_cents > 0 then
        select * into orig from public.payments where stripe_session = left(v_session, length(v_session) - length('#echec'));
      end if;
      if orig.id is null then
        select * into orig from public.payments where stripe_session = split_part(v_session, '#', 1);
      end if;
      if orig.id is not null then
        v_inv := orig.invoice_id; v_stay := true;
        v_pjob := coalesce(orig.job_id, (select v.job_id from public.invoices v where v.id = orig.invoice_id));
      end if;
    end if;
  end if;

  -- where it is meant to go (read without a lock: the job is locked first, then the invoice, in every money operation)
  if v_inv is not null then
    select * into inv from public.invoices where id = v_inv;                       -- a deleted one too
    if not found then
      if not v_card then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
      v_why := 'missing'; v_was := v_inv; v_inv := null; v_job := v_pjob;
    else
      v_job := coalesce(inv.job_id, case when v_card and (inv.deleted_at is not null or inv.status = 'void') then v_pjob end);
    end if;
  else
    v_job := v_pjob;
    if v_job is null and not v_card then perform public.fail('not_found', 'Rien à payer.'); end if;
  end if;
  if v_job is not null then
    select * into j from public.jobs where id = v_job for update;
    if not found then
      if not v_card then perform public.fail('not_found', 'Cette job n’existe plus.'); end if;
      v_why := coalesce(v_why, 'no_job'); v_job := null;
    elsif v_card and (j.deleted_at is not null or j.coffre_id is not null or j.status in ('cancelled', 'no_show')) then
      v_why := coalesce(v_why, case when j.coffre_id is not null then 'coffre' else 'job_closed' end);
    end if;
  elsif v_inv is null then
    v_why := coalesce(v_why, 'no_job');     -- the card only (a person was refused above): kept with nothing to hold it
  end if;

  if v_inv is not null then
    select * into inv from public.invoices where id = v_inv for update;
    if v_card then
      -- the card: the money came in (or went back), it is never refused
      if inv.deleted_at is not null or inv.status = 'void' then
        v_why := coalesce(v_why, case when inv.deleted_at is not null then 'deleted' else 'void' end);
        v_was := inv.id; v_was_no := inv.number; v_inv := null;
      elsif inv.status = 'draft' then
        v_inv := null;   -- paid by card while « Modifier la facture » is open: the money is in, it waits on the job
      end if;
    else
      if inv.deleted_at is not null then perform public.fail('not_found', 'Cette facture n’existe plus.'); end if;
      if v_person and not public.invoice_editable(inv.job_id) then perform public.fail('not_allowed', 'Tu ne peux pas encaisser cette facture.'); end if;
      if inv.status = 'void' then perform public.fail('void', 'Cette facture est annulée.'); end if;
      if inv.status = 'draft' then
        -- (the server, as before) or money given back by the office while « Modifier la facture » is open: on the job
        if inv.number is not null and inv.job_id is not null and (not v_person or v_office) then v_inv := null;
        else perform public.fail('invoice_first', 'Termine la facture avant d’encaisser.'); end if;
      end if;
    end if;
  elsif v_job is not null and v_person and not public.invoice_editable(v_job) then
    perform public.fail('not_allowed', 'Tu ne peux pas encaisser cette job.');
  end if;
  if v_inv is null and v_job is not null and not v_stay then
    -- paid ahead (online) while the invoice was being finished, or the invoice it was for is gone: the payment goes on
    -- the job's finished invoice when it has one
    select * into inv from public.invoices v where v.job_id = v_job and v.status in ('issued','paid') and v.deleted_at is null limit 1 for update;
    if found then v_inv := inv.id; end if;
  end if;

  -- a person: never more than what is left to pay, never more given back than what was paid
  if v_person then
    if v_inv is not null then
      select coalesce(sum(amount_cents), 0)::int into v_paid from public.payments where invoice_id = v_inv and deleted_at is null;
    else
      select coalesce(sum(amount_cents), 0)::int into v_paid from public.payments where job_id = v_job and invoice_id is null and deleted_at is null;
    end if;
    if p_amount_cents < 0 then
      if v_paid + p_amount_cents < 0 then
        perform public.fail('refund_too_much', format('Le client a payé %s $ : tu ne peux pas lui remettre plus.', public.cents_text(greatest(v_paid, 0))));
      end if;
    elsif v_inv is not null then
      v_left := greatest(inv.total_cents - v_paid, 0);
      if v_left = 0 then
        perform public.fail('too_much', 'Cette facture est déjà payée au complet : il ne reste rien à encaisser.');
      elsif p_amount_cents > v_left then
        perform public.fail('too_much', format('Il reste %s $ à payer sur cette facture : le montant écrit est trop haut.', public.cents_text(v_left)));
      end if;
    end if;
  end if;

  insert into public.payments (invoice_id, job_id, amount_cents, method, reference, stripe_session, created_by)
  values (v_inv, v_job, p_amount_cents, p_method, nullif(p_reference, ''), v_session, auth.uid())
  returning id into v_id;
  if v_inv is not null then
    select coalesce(sum(amount_cents), 0)::int into v_paid from public.payments where invoice_id = v_inv and deleted_at is null;
    -- (an invoice that is no longer fully paid — money given back — is « issued » again)
    update public.invoices set paid_cents = v_paid, status = case when v_paid >= total_cents then 'paid' else 'issued' end where id = v_inv;
    v_over := greatest(v_paid - inv.total_cents, 0);
  end if;

  -- what the owner must know (the history of the job; the nightly reconciliation lists them too)
  if v_why is not null then
    insert into public.activity (actor, entity, entity_id, action, data)
    values (auth.uid(), case when v_job is null then 'payments' else 'job' end, coalesce(v_job, v_id), 'payment_unmatched',
      jsonb_build_object('payment', v_id, 'amount', p_amount_cents, 'why', v_why, 'invoice', v_was, 'number', v_was_no,
        'now_on', v_inv, 'session', v_session, 'reference', nullif(p_reference, '')));
  end if;
  if p_amount_cents < 0 then
    insert into public.activity (actor, entity, entity_id, action, data)
    values (auth.uid(), case when v_job is null then 'payments' else 'job' end, coalesce(v_job, v_id), 'payment_refund',
      jsonb_build_object('payment', v_id, 'amount', p_amount_cents, 'method', p_method, 'invoice', v_inv, 'of', orig.id, 'session', v_session));
  elsif v_over > 0 then
    insert into public.activity (actor, entity, entity_id, action, data)
    values (auth.uid(), case when v_job is null then 'payments' else 'job' end, coalesce(v_job, v_id), 'overpaid',
      jsonb_build_object('payment', v_id, 'amount', p_amount_cents, 'invoice', v_inv, 'number', inv.number, 'total', inv.total_cents,
        'paid', v_paid, 'over', v_over));
  end if;
  return public.op_save(p_op, 'payment_add', jsonb_build_object('ok', true, 'rows', public.job_payload(v_job))
    || case when v_why is not null then jsonb_build_object('unmatched', v_why) else '{}'::jsonb end
    || case when v_over > 0 then jsonb_build_object('over_cents', v_over) else '{}'::jsonb end);
end $$;

create or replace function public.payment_remove(p_op uuid, p_payment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; p public.payments; v_paid int; v_job uuid;
begin
  v_done := public.op_begin(p_op, 'payment_remove');
  if v_done is not null then return v_done; end if;
  select * into p from public.payments where id = p_payment and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce paiement n’existe plus.'); end if;
  if not (public.is_owner() or public.can('edit_invoices')) then perform public.fail('not_allowed', 'Seul le bureau peut retirer un paiement.'); end if;
  if p.method = 'card_online' then perform public.fail('online', 'Un paiement par carte en ligne se rembourse dans Stripe.'); end if;
  -- the job, then the invoice, then the payment: the same order as the other money operations
  v_job := coalesce(p.job_id, (select job_id from public.invoices where id = p.invoice_id));
  if v_job is not null then perform 1 from public.jobs where id = v_job for update; end if;
  if p.invoice_id is not null then perform 1 from public.invoices where id = p.invoice_id for update; end if;
  select * into p from public.payments where id = p_payment and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Ce paiement n’existe plus.'); end if;
  perform set_config('garage.rpc', 'on', true);
  update public.payments set deleted_at = now() where id = p.id;
  if p.invoice_id is not null then
    select coalesce(sum(amount_cents), 0)::int into v_paid from public.payments where invoice_id = p.invoice_id and deleted_at is null;
  else
    select coalesce(sum(amount_cents), 0)::int into v_paid from public.payments where job_id = v_job and invoice_id is null and deleted_at is null;
  end if;
  -- a payment whose refund is noted cannot leave alone (the books would say the customer was given money he never paid)
  if v_paid < 0 then
    perform public.fail('refund_first', 'De l’argent remis au client est noté sur ce paiement : retire d’abord cette remise.');
  end if;
  if p.invoice_id is not null then
    update public.invoices set paid_cents = v_paid, status = case when status in ('void', 'draft') then status when v_paid >= total_cents then 'paid' else 'issued' end where id = p.invoice_id;
  end if;
  return public.op_save(p_op, 'payment_remove', jsonb_build_object('ok', true, 'rows', public.job_payload(v_job)));
end $$;

-- ───────────────────────── the work and the invoice ─────────────────────────

-- The draft follows the work. New in Part 27: work that BECOMES billable (a new line, an extra the customer accepts, a
-- line put back) goes on the job's draft by itself (before: only a banner on the phone said so, and « Terminer la
-- facture » went through without it). A finished invoice is never changed by itself (see jobs_unbilled_guard).
create or replace function public.job_items_invoice_follow() returns trigger language plpgsql security definer set search_path = public as $$
declare inv public.invoices; v_was boolean; v_is boolean; v_person boolean;
begin
  v_is := new.deleted_at is null and new.status in ('planned', 'done', 'approved');
  if tg_op = 'INSERT' then
    v_was := false;
    if not v_is then return new; end if;
  else
    v_was := old.deleted_at is null and old.status in ('planned', 'done', 'approved');
    if v_was = v_is and new.unit_cents is not distinct from old.unit_cents and new.qty is not distinct from old.qty
      and new.description is not distinct from old.description and new.taxable is not distinct from old.taxable then
      return new;
    end if;
  end if;
  select * into inv from public.invoices v where v.job_id = new.job_id and v.status <> 'void' and v.deleted_at is null
    and exists (select 1 from jsonb_array_elements(v.lines) l where l->>'item_id' = new.id::text)
  limit 1 for update;
  if not found then
    if v_is and not v_was then
      select * into inv from public.invoices v where v.job_id = new.job_id and v.status = 'draft' and v.deleted_at is null limit 1 for update;
      if found then
        update public.invoices set lines = inv.lines || jsonb_build_array(jsonb_build_object('description', new.description, 'qty', new.qty,
          'unit_cents', new.unit_cents, 'taxable', new.taxable, 'kind', new.kind, 'item_id', new.id))
        where id = inv.id;
      end if;
    end if;
    return new;
  end if;
  if inv.status <> 'draft' then
    v_person := coalesce(current_setting('role', true), '') in ('authenticated', 'anon') and coalesce(current_setting('garage.rpc', true), '') <> 'on';
    -- (an insert of work already on the finished invoice — its line sent first by a phone — is never refused)
    if tg_op = 'UPDATE' and v_person and (v_was <> v_is or new.unit_cents is distinct from old.unit_cents or new.qty is distinct from old.qty) then
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
drop trigger if exists job_items_invoice_follow on public.job_items;
create trigger job_items_invoice_follow after insert or update on public.job_items for each row execute function public.job_items_invoice_follow();

-- An appointment is not « Terminé » while billable work is on no line of its finished invoice: the customer would leave
-- without paying it. Way out: « Modifier la facture » (a paid one too, see invoice_reopen) or mark that work « Pas fait ».
-- A trigger, so every way of finishing a job is held to it. An operation that has the office's word may set
-- « garage.unbilled_ok » to 'on' for its transaction (set_config(…, true)) to let the job finish as it is.
create or replace function public.jobs_unbilled_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare v_missing jsonb;
begin
  if coalesce(current_setting('garage.unbilled_ok', true), '') = 'on' then return new; end if;
  v_missing := public.job_unbilled(new.id);
  if jsonb_array_length(v_missing) > 0 then
    perform public.fail('unbilled', format('Un travail n’est pas sur la facture (%s) : touche « Modifier la facture » pour l’ajouter, ou marque-le « Pas fait », avant de terminer.',
      (select string_agg(x->>'description', ', ') from jsonb_array_elements(v_missing) x)));
  end if;
  return new;
end $$;
revoke all on function public.jobs_unbilled_guard() from public, anon, authenticated;
drop trigger if exists jobs_unbilled_guard on public.jobs;
create trigger jobs_unbilled_guard before update of status on public.jobs for each row
  when (new.status = 'done' and old.status is distinct from 'done')
  execute function public.jobs_unbilled_guard();

create or replace function public.job_item_price(p_op uuid, p_item uuid, p_unit_cents integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; i record; j record; v_old int;
begin
  v_done := public.op_begin(p_op, 'job_item_price');
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
  -- a discount keeps its sign; the price written is what one unit costs. A line priced below zero (a rebate kept as a
  -- service in the price list) keeps its sign too: the app shows and sends its amount without the sign (Part 27)
  update public.job_items set unit_cents = case when kind = 'discount' or unit_cents < 0 then -abs(p_unit_cents) else p_unit_cents end where id = i.id;
  insert into public.activity (actor, entity, entity_id, action, data)
  values (auth.uid(), 'job', j.id, 'price_changed', jsonb_build_object('item', i.id, 'description', i.description, 'from', v_old, 'to', p_unit_cents));
  return public.op_save(p_op, 'job_item_price', jsonb_build_object('ok', true, 'rows', jsonb_build_object(
    'job_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.job_items x where x.id = i.id),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.invoices x where x.job_id = j.id))));
end $$;

create or replace function public.extra_answer(p_op uuid, p_item uuid, p_accept boolean, p_via text, p_attachment uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; it public.job_items; j public.jobs;
begin
  v_done := public.op_begin(p_op, 'extra_answer');
  if v_done is not null then return v_done; end if;
  select * into it from public.job_items where id = p_item and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Ce travail n’existe plus.'); end if;
  select * into j from public.jobs where id = it.job_id;
  if not public.job_actor(j) then perform public.fail('not_allowed', 'Cette job n’est pas à toi.'); end if;
  if p_via not in ('signature','verbal') then perform public.fail('via', 'Réponse inconnue.'); end if;
  if it.status not in ('proposed','approved','declined') then perform public.fail('not_extra', 'Ce n’est pas un travail proposé.'); end if;
  -- the signature must belong to this job
  if p_attachment is not null and not exists (select 1 from public.attachments a where a.id = p_attachment and a.job_id = j.id and a.kind = 'signature') then
    perform public.fail('signature', 'La signature ne correspond pas à cette job.');
  end if;
  update public.job_items set status = case when p_accept then 'approved' else 'declined' end, answered_at = now(), answered_via = p_via,
    answer_attachment = case when p_via = 'signature' then p_attachment end
  where id = it.id;
  return public.op_save(p_op, 'extra_answer', jsonb_build_object('ok', true, 'rows', public.job_payload(j.id)));
end $$;

-- ───────────────────────── the Coffre ─────────────────────────

-- coffre_add written in full (D2 of the audit): until now its running text was Part 20 + two text patches (Parts 22 and
-- 24 bis). Same rules, plus: the person must see each job; a draft that has a number is cancelled, not deleted; payments
-- are counted net (a payment and its refund no longer hold the job); the customer's open card page is forgotten.
create or replace function public.coffre_add(p_op uuid, p_jobs uuid[], p_amount int, p_note text default null, p_day date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb;
  v_id uuid := gen_random_uuid(); j record; v_cust uuid; v_value int := 0; v_nums bigint[] := '{}'; v_ids uuid[] := '{}'; inv record;
begin
  v_done := public.op_begin(p_op, 'coffre_add');
  if v_done is not null then return v_done; end if;
  if not public.coffre_may_add(p_jobs) then perform public.fail('not_allowed', 'Connecte-toi avec ton compte de l’équipe pour mettre des jobs au Coffre.'); end if;
  if p_jobs is null or cardinality(p_jobs) = 0 then perform public.fail('no_job', 'Choisis les jobs payées par le Coffre.'); end if;
  if cardinality(p_jobs) > 30 then perform public.fail('too_many', 'Au plus 30 jobs à la fois.'); end if;
  if p_amount is null or p_amount < 0 or p_amount > 10000000 then perform public.fail('bad_amount', 'Écris le montant reçu (0 $ si rien).'); end if;
  perform set_config('garage.rpc', 'on', true);
  for j in select * from public.jobs where id = any(p_jobs) order by day, number for update loop
    -- everyone on the team may use the Coffre, for the jobs they see (a job id alone is not enough)
    if not public.job_id_visible(j.id) then
      perform public.fail('not_allowed', 'Une de ces jobs n’est pas dans ce que tu vois : demande au bureau de la mettre au Coffre.');
    end if;
    if j.deleted_at is not null or j.status in ('cancelled','no_show') then
      perform public.fail('bad_job', format('La job %s est annulée : elle ne va pas au Coffre.', j.number));
    end if;
    if j.coffre_id is not null then perform public.fail('already', format('La job %s est déjà au Coffre.', j.number)); end if;
    if coalesce((select sum(p.amount_cents) from public.payments p left join public.invoices v on v.id = p.invoice_id
               where p.deleted_at is null and (p.job_id = j.id or v.job_id = j.id)), 0) <> 0 then
      perform public.fail('has_payment', format('La job %s a déjà un paiement : retire-le d’abord, ou garde-la en facture.', j.number));
    end if;
    v_cust := coalesce(v_cust, j.customer_id);
    v_ids := v_ids || j.id; v_nums := v_nums || j.number;
    v_value := v_value + coalesce((select sum(round(i.qty * case when i.kind = 'discount' then -abs(i.unit_cents) else i.unit_cents end)) from public.job_items i
                                   where i.job_id = j.id and i.deleted_at is null and i.status in ('planned','done','approved')), 0)::int;
  end loop;
  if cardinality(v_ids) <> cardinality(array(select distinct x from unnest(p_jobs) x)) then
    perform public.fail('no_job', 'Une des jobs n’existe plus.');
  end if;
  insert into public.coffre (id, customer_id, amount_cents, value_cents, received_on, note, job_ids, job_numbers, created_by)
  values (v_id, v_cust, p_amount, v_value, coalesce(p_day, public.local_today()), nullif(trim(coalesce(p_note, '')), ''), v_ids, v_nums, auth.uid());
  update public.jobs set coffre_id = v_id, pay_later = false where id = any(v_ids);
  -- their invoices: a draft that never had a number goes away; a finished one with nothing paid — or a draft that
  -- already has its number — is cancelled (its number stays in the books)
  for inv in select * from public.invoices where job_id = any(v_ids) and deleted_at is null and status <> 'void' loop
    if inv.status = 'draft' and inv.number is null then
      update public.invoices set deleted_at = now() where id = inv.id;
    else
      update public.payments set invoice_id = null where invoice_id = inv.id and deleted_at is null and job_id is not null;
      update public.invoices set status = 'void', voided_at = now(), void_reason = 'Coffre (famille et amis)' where id = inv.id;
    end if;
  end loop;
  -- the card page a customer may have open for one of these jobs is not offered again
  update public.public_links set last_session = null, last_session_url = null, last_session_amount = null, last_session_expires = null
  where job_id = any(v_ids) and last_session is not null;
  return public.op_save(p_op, 'coffre_add', jsonb_build_object('ok', true, 'id', v_id, 'rows', jsonb_build_object(
    'jobs', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.jobs x where x.id = any(v_ids)),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.invoices x where x.job_id = any(v_ids)))));
end $$;

-- « Retirer » on a purchase: the stock it brought in leaves with it (before: the Coffre's money came back and the stock
-- stayed). Its own move is removed when the purchase knows it (move_id, Part 27); an older purchase gets a move the other
-- way. A received row: as before, its jobs leave the Coffre.
create or replace function public.coffre_remove(p_op uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; c public.coffre; v_move uuid;
begin
  v_done := public.op_begin(p_op, 'coffre_remove');
  if v_done is not null then return v_done; end if;
  if not public.is_owner() then perform public.fail('not_allowed', 'Seul le propriétaire change le Coffre.'); end if;
  select * into c from public.coffre where id = p_id and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cette entrée du Coffre n’existe plus.'); end if;
  perform set_config('garage.rpc', 'on', true);
  update public.coffre set deleted_at = now() where id = p_id;
  if c.kind = 'purchase' then
    if c.move_id is not null then
      v_move := c.move_id;
      update public.inventory_moves set deleted_at = now() where id = v_move and deleted_at is null;
    elsif c.item_id is not null and coalesce(c.qty, 0) > 0 and exists (select 1 from public.inventory_items i where i.id = c.item_id and i.deleted_at is null) then
      insert into public.inventory_moves (item_id, delta, reason, note, created_by)
      values (c.item_id, -c.qty, 'adjust', 'Achat du Coffre retiré', auth.uid())
      returning id into v_move;
    end if;
  else
    update public.jobs set coffre_id = null where coffre_id = p_id;
  end if;
  return public.op_save(p_op, 'coffre_remove', jsonb_build_object('ok', true, 'rows', jsonb_build_object(
    'jobs', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.jobs x where x.id = any(c.job_ids)),
    'inventory_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.inventory_items x where c.kind = 'purchase' and x.id = c.item_id),
    'inventory_moves', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.inventory_moves x where x.id = v_move))));
end $$;

-- ───────────────────────── stock ─────────────────────────

create or replace function public.inventory_buy(p_op uuid, p_item uuid, p_qty numeric, p_total_cents int, p_from text, p_vendor text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb;
  it record; v_move uuid := gen_random_uuid(); v_expense uuid; v_coffre uuid;
  tx jsonb := (select taxes from public.settings where id = 1);
  v_tps numeric; v_tvq numeric; v_sub int; v_tps_c int; v_tvq_c int; v_desc text;
begin
  v_done := public.op_begin(p_op, 'inventory_buy');
  if v_done is not null then return v_done; end if;
  if not (public.is_owner() or public.can('inventory')) then perform public.fail('not_allowed', 'Tu n’as pas le droit de changer l’inventaire.'); end if;
  if p_from is null or p_from not in ('treasury', 'coffre', 'none') then perform public.fail('bad_from', 'Choisis qui paie : la Trésorerie ou le Coffre.'); end if;
  select * into it from public.inventory_items where id = p_item and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cet article n’existe plus.'); end if;
  -- the Coffre's stock is paid by the Coffre (no taxes, no expense); the garage's stock by the Trésorerie
  if it.pool = 'coffre' and p_from = 'treasury' then perform public.fail('bad_from', 'Un article du Coffre se paie avec l’argent du Coffre.'); end if;
  if it.pool = 'garage' and p_from = 'coffre' then perform public.fail('bad_from', 'Un article du garage se paie par la Trésorerie. Pour l’argent du Coffre, ajoute l’article au stock du Coffre.'); end if;
  if p_qty is null or p_qty <= 0 or p_qty > 100000 then perform public.fail('bad_qty', 'Écris une quantité plus grande que zéro.'); end if;
  if p_from <> 'none' and (p_total_cents is null or p_total_cents <= 0 or p_total_cents > 100000000) then
    perform public.fail('bad_amount', case when it.pool = 'coffre' then 'Écris le prix payé.' else 'Écris le prix payé (le total, taxes incluses).' end);
  end if;
  perform set_config('garage.rpc', 'on', true);
  v_desc := format('%s × %s', public.qty_text(p_qty), it.name);

  insert into public.inventory_moves (id, item_id, delta, reason, note, created_by)
  values (v_move, it.id, p_qty, 'restock',
          nullif(concat_ws(' · ', nullif(trim(coalesce(p_vendor, '')), ''), nullif(trim(coalesce(p_note, '')), ''),
                 case p_from when 'treasury' then 'Payé par la Trésorerie' when 'coffre' then 'Payé par le Coffre' end), ''),
          auth.uid());

  -- (the money row knows its stock move: move_id)
  if p_from = 'treasury' then
    if coalesce((tx->>'enabled')::boolean, true) then
      v_tps := coalesce((tx->>'tps')::numeric, 0.05); v_tvq := coalesce((tx->>'tvq')::numeric, 0.09975);
      v_sub := round(p_total_cents / (1 + v_tps + v_tvq));
      v_tps_c := round(v_sub * v_tps);
      v_tvq_c := p_total_cents - v_sub - v_tps_c;
    else
      v_sub := p_total_cents; v_tps_c := 0; v_tvq_c := 0;
    end if;
    insert into public.expenses (day, vendor, category, description, subtotal_cents, tps_cents, tvq_cents, total_cents, notes, created_by, move_id)
    values (public.local_today(), nullif(trim(coalesce(p_vendor, '')), ''), 'Pièces', v_desc, v_sub, v_tps_c, v_tvq_c, p_total_cents,
            nullif(trim(coalesce(p_note, '')), ''), auth.uid(), v_move)
    returning id into v_expense;
  elsif p_from = 'coffre' then
    insert into public.coffre (kind, customer_id, amount_cents, value_cents, received_on, note, item_id, item_name, qty, created_by, move_id)
    values ('purchase', null, p_total_cents, 0, public.local_today(),
            nullif(concat_ws(' · ', nullif(trim(coalesce(p_vendor, '')), ''), nullif(trim(coalesce(p_note, '')), '')), ''),
            it.id, it.name, p_qty, auth.uid(), v_move)
    returning id into v_coffre;
  end if;

  -- the item's cost: what one unit cost this time
  if p_from <> 'none' then
    update public.inventory_items set cost_cents = round(p_total_cents / p_qty) where id = it.id;
  end if;

  return public.op_save(p_op, 'inventory_buy', jsonb_build_object('ok', true, 'move_id', v_move, 'expense_id', v_expense, 'coffre_id', v_coffre,
    'rows', jsonb_build_object(
      'inventory_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.inventory_items x where x.id = it.id),
      'inventory_moves', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.inventory_moves x where x.id = v_move),
      'expenses', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.expenses x where x.id = v_expense))));
end $$;

create or replace function public.inventory_delete(p_op uuid, p_item uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; v_name text;
begin
  v_done := public.op_begin(p_op, 'inventory_delete');
  if v_done is not null then return v_done; end if;
  if not (public.is_owner() or public.can('inventory')) then perform public.fail('not_allowed', 'Tu n’as pas le droit de changer l’inventaire.'); end if;
  select name into v_name from public.inventory_items where id = p_item;
  if v_name is null then perform public.fail('not_found', 'Cet article n’existe plus.'); end if;
  perform set_config('garage.rpc', 'on', true);
  -- its moves and its links to services go with it (foreign keys); a job's line that pointed to it keeps its words
  delete from public.inventory_items where id = p_item;
  return public.op_save(p_op, 'inventory_delete', jsonb_build_object('ok', true, 'id', p_item, 'name', v_name));
end $$;

-- use_parts: a confirmed quantity that rounds to zero (0,004) is left out instead of stopping « Terminer » with a raw
-- database error (the stock counts to the hundredth).
create or replace function public.use_parts(p_job uuid, p_parts jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_note text := 'Job ' || (select number from public.jobs where id = p_job);
begin
  if exists (select 1 from public.inventory_moves where job_id = p_job and reason = 'used' and deleted_at is null) then return; end if;
  if p_parts is not null and jsonb_typeof(p_parts) = 'array' then
    insert into public.inventory_moves (item_id, delta, reason, job_id, note, created_by)
    select it.id, -x.qty, 'used', p_job, v_note, auth.uid()
    from (
      select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::numeric) as qty
      from jsonb_array_elements(p_parts) e
      where (e->>'item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and (e->>'qty') ~ '^[0-9]+(\.[0-9]+)?$'
      group by 1
    ) x
    join public.inventory_items it on it.id = x.item_id and it.deleted_at is null
    where round(x.qty, 2) > 0;
    return;
  end if;
  insert into public.inventory_moves (item_id, delta, reason, job_id, note, created_by)
  select x.item_id, -sum(x.qty), 'used', p_job, v_note, auth.uid()
  from (
    select i.item_id, i.qty from public.job_items i
    where i.job_id = p_job and i.deleted_at is null and i.item_id is not null and i.status in ('planned','done','approved')
    union all
    select sp.item_id, sp.qty * i.qty from public.job_items i join public.service_parts sp on sp.service_id = i.service_id and sp.deleted_at is null
    where i.job_id = p_job and i.deleted_at is null and i.status in ('planned','done','approved')
  ) x
  join public.inventory_items it on it.id = x.item_id and it.deleted_at is null
  group by x.item_id
  having round(sum(x.qty), 2) > 0;
end $$;
