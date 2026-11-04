-- Part 14: the confirmation text leads to the estimate the customer signs on their phone (with the authorization of
-- work, so nothing is left to sign at the door) and may pay at once; when the mechanic arrives, a text brings the
-- invoice to pay during the work; a card payment that arrives after the invoice was finished goes on that invoice.

-- ---------- the estimate signed online ----------
alter table public.jobs add column if not exists estimate_signed_at timestamptz;
alter table public.jobs add column if not exists estimate_signer text;
alter table public.jobs add column if not exists estimate_attachment uuid references public.attachments(id) on delete set null;
-- the total (taxes included) the customer saw when signing: a change after that asks for a new signature
alter table public.jobs add column if not exists estimate_cents int;
-- where the authorization was signed: on the mechanic's phone, or by the customer online
alter table public.jobs add column if not exists waiver_via text check (waiver_via in ('phone', 'online'));

-- a signature taken at the door says so (the online one is written by the customer's page)
create or replace function public.jobs_waiver_via() returns trigger language plpgsql set search_path = public as $$
begin
  -- the authorization written again without saying where (« Faire signer » on the phone): at the door
  if new.waiver_signed_at is not null and new.waiver_via is not distinct from old.waiver_via then
    new.waiver_via := 'phone';
  end if;
  if new.waiver_signed_at is null then new.waiver_via := null; end if;
  return new;
end $$;
create or replace trigger jobs_waiver_via before update of waiver_signed_at on public.jobs for each row execute function public.jobs_waiver_via();
update public.jobs set waiver_via = 'phone' where waiver_signed_at is not null and waiver_via is null;

-- ---------- the texts ----------
-- the confirmation: the block, the estimate to sign, paying now (when card payment is on); changed only where the garage
-- kept the first wording. The new text when the mechanic arrives (with or without card payment).
update public.settings set messages = jsonb_set(jsonb_set(messages,
    '{fr,booking}', case when messages #>> '{fr,booking}' is null
        or messages #>> '{fr,booking}' = 'Bonjour {prenom}, votre rendez-vous avec {garage} est confirmé : {jour}, entre {debut} et {fin}. Total prévu : {total} (taxes incluses). Détails : {lien}'
      then to_jsonb('Bonjour {prenom}, votre rendez-vous avec {garage} est confirmé : {jour}, {bloc} (entre {debut} et {fin}). Estimation : {total} taxes incluses. Pour voir et signer votre estimation{payer} : {lien}'::text)
      else messages #> '{fr,booking}' end),
    '{en,booking}', case when messages #>> '{en,booking}' is null
        or messages #>> '{en,booking}' = 'Hello {prenom}, your appointment with {garage} is confirmed: {jour}, between {debut} and {fin}. Expected total: {total} (taxes included). Details: {lien}'
      then to_jsonb('Hello {prenom}, your appointment with {garage} is confirmed: {jour}, {bloc} (between {debut} and {fin}). Estimate: {total} taxes included. To see and sign your estimate{payer}: {lien}'::text)
      else messages #> '{en,booking}' end)
where id = 1;
update public.settings set messages = messages
  || jsonb_build_object('on', coalesce(messages -> 'on', '{}'::jsonb) || jsonb_build_object('arrived', coalesce((messages #> '{on,arrived}'), 'true'::jsonb)))
  || jsonb_build_object('fr', coalesce(messages -> 'fr', '{}'::jsonb) || jsonb_build_object(
       'arrived', coalesce(messages #>> '{fr,arrived}', 'Bonjour {prenom}, {mecano} de {garage} est arrivé. Votre facture : {total} taxes incluses. Vous pouvez la payer en ligne pendant les travaux : {lien}'),
       'arrived_no_pay', coalesce(messages #>> '{fr,arrived_no_pay}', 'Bonjour {prenom}, {mecano} de {garage} est arrivé. Votre facture : {total} taxes incluses. Détails : {lien}')))
  || jsonb_build_object('en', coalesce(messages -> 'en', '{}'::jsonb) || jsonb_build_object(
       'arrived', coalesce(messages #>> '{en,arrived}', 'Hello {prenom}, {mecano} from {garage} has arrived. Your invoice: {total} taxes included. You can pay it online while the work is being done: {lien}'),
       'arrived_no_pay', coalesce(messages #>> '{en,arrived_no_pay}', 'Hello {prenom}, {mecano} from {garage} has arrived. Your invoice: {total} taxes included. Details: {lien}')))
where id = 1;

-- ---------- a card payment that arrives after the invoice was finished goes on it ----------
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
    if inv.status = 'draft' then perform public.fail('invoice_first', 'Termine la facture avant d’encaisser.'); end if;
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
