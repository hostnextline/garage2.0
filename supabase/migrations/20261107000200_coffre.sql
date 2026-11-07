-- Part 20: « Coffre » — family and friends.
-- Jobs done for family and friends are not sales: no invoice, no TPS/TVQ, nothing in the revenue or the taxes of the
-- treasury. What they give (cash, a gift, a tip) is written in the Coffre, its own register, with the jobs it covers.
-- 1. coffre: {customer, amount given, day, note, the jobs (numbers kept), what the work was worth before taxes}.
--    Read only through coffre_report (the owner, and the « Trésorerie » right: the accountant exports it apart).
-- 2. coffre_add(op, jobs, amount, note, day): the owner only. Each job: not cancelled, not already in the Coffre, no
--    payment taken on it. Its draft invoice is removed; a finished invoice with nothing paid is cancelled (reason
--    « Coffre (famille et amis) »: its number stays in the books). The job counts as settled: it can be finished.
-- 3. coffre_remove(op, id): the owner, a mistake: the jobs go back to normal (an invoice can be made again).
-- 4. No invoice is ever made for a job in the Coffre.

create table if not exists public.coffre (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete restrict,
  amount_cents int not null default 0 check (amount_cents >= 0),
  value_cents int not null default 0,
  received_on date not null default public.local_today(),
  note text check (note is null or length(note) <= 500),
  job_ids uuid[] not null default '{}',
  job_numbers bigint[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create or replace trigger coffre_touch before insert or update on public.coffre for each row execute function public.touch();
alter table public.coffre enable row level security;   -- no policy: only the server functions below read and write it
revoke all on public.coffre from anon, authenticated;

alter table public.jobs add column if not exists coffre_id uuid references public.coffre(id) on delete set null;
create index if not exists jobs_coffre on public.jobs(coffre_id) where coffre_id is not null;

-- a job in the Coffre is settled (it can be finished, the truck can leave)
create or replace function public.job_paid(p_job uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs j where j.id = p_job and j.coffre_id is not null)
      or coalesce((select v.status = 'paid' from public.invoices v where v.job_id = p_job and v.status <> 'void' and v.deleted_at is null limit 1), false)
$$;

-- no invoice for a job in the Coffre
create or replace function public.invoices_no_coffre() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.job_id is not null and new.deleted_at is null and new.status <> 'void'
     and exists (select 1 from public.jobs j where j.id = new.job_id and j.coffre_id is not null) then
    perform public.fail('coffre_job', 'Cette job est au Coffre (famille et amis) : elle n’a pas de facture.');
  end if;
  return new;
end $$;
create or replace trigger invoices_no_coffre before insert or update of job_id, status, deleted_at on public.invoices
  for each row execute function public.invoices_no_coffre();

-- ---------- putting jobs in the Coffre ----------
create or replace function public.coffre_add(p_op uuid, p_jobs uuid[], p_amount int, p_note text default null, p_day date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb := public.op_done(p_op);
  v_id uuid := gen_random_uuid(); j record; v_cust uuid; v_value int := 0; v_nums bigint[] := '{}'; v_ids uuid[] := '{}'; inv record;
begin
  if v_done is not null then return v_done; end if;
  if not public.is_owner() then perform public.fail('not_allowed', 'Seul le propriétaire met des jobs au Coffre.'); end if;
  if p_jobs is null or cardinality(p_jobs) = 0 then perform public.fail('no_job', 'Choisis les jobs payées par le Coffre.'); end if;
  if cardinality(p_jobs) > 30 then perform public.fail('too_many', 'Au plus 30 jobs à la fois.'); end if;
  if p_amount is null or p_amount < 0 or p_amount > 10000000 then perform public.fail('bad_amount', 'Écris le montant reçu (0 $ si rien).'); end if;
  perform set_config('garage.rpc', 'on', true);
  for j in select * from public.jobs where id = any(p_jobs) order by day, number for update loop
    if j.deleted_at is not null or j.status in ('cancelled','no_show') then
      perform public.fail('bad_job', format('La job %s est annulée : elle ne va pas au Coffre.', j.number));
    end if;
    if j.coffre_id is not null then perform public.fail('already', format('La job %s est déjà au Coffre.', j.number)); end if;
    if exists (select 1 from public.payments p left join public.invoices v on v.id = p.invoice_id
               where p.deleted_at is null and (p.job_id = j.id or v.job_id = j.id)) then
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
  -- their invoices: a draft goes away, a finished one with nothing paid is cancelled (its number stays in the books)
  for inv in select * from public.invoices where job_id = any(v_ids) and deleted_at is null and status <> 'void' loop
    if inv.status = 'draft' then
      update public.invoices set deleted_at = now() where id = inv.id;
    else
      update public.invoices set status = 'void', voided_at = now(), void_reason = 'Coffre (famille et amis)' where id = inv.id;
    end if;
  end loop;
  return public.op_save(p_op, 'coffre_add', jsonb_build_object('ok', true, 'id', v_id, 'rows', jsonb_build_object(
    'jobs', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.jobs x where x.id = any(v_ids)),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.invoices x where x.job_id = any(v_ids)))));
end $$;

-- ---------- a mistake: out of the Coffre ----------
create or replace function public.coffre_remove(p_op uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); v_ids uuid[];
begin
  if v_done is not null then return v_done; end if;
  if not public.is_owner() then perform public.fail('not_allowed', 'Seul le propriétaire change le Coffre.'); end if;
  select job_ids into v_ids from public.coffre where id = p_id and deleted_at is null;
  if not found then perform public.fail('not_found', 'Cette entrée du Coffre n’existe plus.'); end if;
  perform set_config('garage.rpc', 'on', true);
  update public.coffre set deleted_at = now() where id = p_id;
  update public.jobs set coffre_id = null where coffre_id = p_id;
  return public.op_save(p_op, 'coffre_remove', jsonb_build_object('ok', true, 'rows', jsonb_build_object(
    'jobs', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.jobs x where x.id = any(v_ids)))));
end $$;

-- ---------- the Coffre report (owner, « Trésorerie »): apart from the revenue and the taxes ----------
create or replace function public.coffre_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not (public.is_owner() or public.can('treasury')) then perform public.fail('not_allowed', 'Tu n’as pas accès au Coffre.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'day', c.received_on, 'customer_id', c.customer_id,
      'customer', coalesce(nullif(trim(concat_ws(' ', cu.first_name, cu.last_name)), ''), cu.company, '—'),
      'amount_cents', c.amount_cents, 'value_cents', c.value_cents, 'note', c.note, 'job_ids', to_jsonb(c.job_ids), 'job_numbers', to_jsonb(c.job_numbers),
      'work', (select coalesce(string_agg(distinct i.description, ', '), '') from public.job_items i
               where i.job_id = any(c.job_ids) and i.deleted_at is null and i.status in ('planned','done','approved')),
      'by', (select coalesce(s.short_name, s.full_name) from public.staff s where s.id = c.created_by))
    order by c.received_on, c.created_at), '[]'::jsonb) into v_rows
  from public.coffre c left join public.customers cu on cu.id = c.customer_id
  where c.deleted_at is null and c.received_on between coalesce(p_from, '2000-01-01') and coalesce(p_to, '2999-12-31');
  return jsonb_build_object('from', p_from, 'to', p_to, 'rows', v_rows,
    'count', jsonb_array_length(v_rows),
    'amount_cents', (select coalesce(sum((x->>'amount_cents')::int), 0) from jsonb_array_elements(v_rows) x),
    'value_cents', (select coalesce(sum((x->>'value_cents')::int), 0) from jsonb_array_elements(v_rows) x));
end $$;

-- rights: the operations are for signed-in people (each checks who); the trigger is the server's own
revoke all on function public.coffre_add(uuid, uuid[], int, text, date) from public, anon;
grant execute on function public.coffre_add(uuid, uuid[], int, text, date) to authenticated;
revoke all on function public.coffre_remove(uuid, uuid) from public, anon;
grant execute on function public.coffre_remove(uuid, uuid) to authenticated;
revoke all on function public.coffre_report(date, date) from public, anon;
grant execute on function public.coffre_report(date, date) to authenticated;
revoke all on function public.invoices_no_coffre() from public, anon, authenticated;
