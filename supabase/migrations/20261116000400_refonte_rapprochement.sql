-- Part 28 — « Refonte », le rapprochement quotidien (the daily reconciliation), database side.
--
-- Every night the server checks that the garage's books agree with themselves and keeps the sheet of the day. Each
-- morning the owner (and the person with « Trésorerie ») reads either « tout balance » or the list of differences, in
-- plain words, each one saying what is wrong and what to do.
--
-- ADDITIVE: three new tables and new functions only. No existing function, table, trigger, policy or row is changed.
--
--   ops_recon_runs        one row per day reconciled (running a day again replaces its row): status ok | warn | bad,
--                         counts, the day's sheet
--   ops_recon_findings    one row per difference, by a stable key (check + entity): seen again the next night it stays
--                         the same row (last_day moves); no longer true, it closes by itself; « vu » = acked
--   ops_recon_baseline    the differences that alert only when they CHANGE (S1: stock on hand vs its moves)
--   recon_run(day, source)      service only: every check, in ONE snapshot (recon_collect is one query), in one transaction
--   recon_add(run, …)           service only: a server function adds what needs the outside (Stripe, the backup's age)
--   recon_summary(days)         owner: everything; « Trésorerie »: the money (M…) and stock (S…) checks; others: refused
--   recon_ack(finding, note)    owner or « Trésorerie »: « vu »
--   recon_now()                 owner or « Trésorerie »: yesterday and today so far, at most once a minute, then the summary
--   pg_cron « garage-recon »    07:40 UTC every day when the extension exists (the nightly backup job is the second trigger)
--
-- Every check reads the books AS THEY ARE NOW (the day only chooses the sheet and the dates written on the findings), so
-- running any day again gives the same list, and a difference repaired closes at the next run, whatever day it runs for.
-- A check that throws becomes a finding of its own (« <check>.error ») and the other checks still run; the differences
-- that family had found stay as they were (open or « vu »): not checked is not repaired.
--
-- The checks (check_id = family + number + what; the family decides who sees it: M and S = money and stock):
--   M1.sum  bad   an invoice's lines, subtotal, taxes and total do not add up (the rule of the trigger invoice_totals)
--   M1.tax  warn  an invoice's TPS / TVQ are not what the garage's rates give on its taxable amount
--   M2.paid bad   « payé » on a finished invoice is not the sum of its payments
--   M2.status bad PAYÉE without the money, or the money without PAYÉE
--   M2.over warn  more paid than the total (money to give back, or to explain)
--   M2.draft bad  a draft holds payments (they wait on the job while an invoice is edited)
--   M2.void bad   a cancelled or deleted invoice still holds money
--   M3.double / M3.gap / M3.deleted / M3.counter / M3.nonumber   bad   invoice numbers: unique, no hole, none thrown
--                 away with its invoice, the counter ahead of the last number, a finished invoice has its number and date
--                 (a hole is one finding per run of missing numbers, the 50 newest; older ones in one « M3.gapmore »)
--   M4.orphan bad a payment on nothing, or on another job's invoice;  M4.card bad « carte en ligne » without its Stripe
--                 session;  M4.waiting bad a payment waiting on a job whose invoice is finished;  M4.closed warn a
--                 payment waiting on a finished / cancelled job that has no finished invoice;  M4.double warn the same
--                 amount and method twice on one invoice (or job) within 2 minutes
--   M5.unbilled bad  a finished job (not Coffre) with no invoice;  M5.draft warn  a finished job whose invoice is still a
--                 draft;  M5.unpaid warn  finished, invoice not paid, nobody granted « payer plus tard »
--   M7.sum bad    an expense: before taxes + TPS + TVQ is not the total (or an amount below zero);  M7.stock bad  stock
--                 « payé par la Trésorerie » without its expense;  M7.stockgone warn  its expense was deleted, the stock stayed
--   M8.link bad   a Coffre entry and its jobs do not point to each other;  M8.money bad  a Coffre job has an invoice or
--                 money;  M8.balance info  more spent from the Coffre than noted as received (normal with 0 $ family jobs);
--                 M8.stock bad  a Coffre purchase without its stock entry
--   M9.quote warn a converted estimate without its job
--   D1.past warn  a past job still booked, en route or on site;  D1.stamp warn  a status without its time;  D1.trips warn
--                 two trips under way for one person
--   D2.order / D2.window / D2.mix / D2.machine warn, D2.unplaced info   the coming days: stop order unique per truck and
--                 block, a promised window the plan arrives after, a day mixing « journée » and blocks, tire-machine work
--                 on a vehicle without the machine, the number of jobs « À placer »
--   D3.car / D3.invoice warn   the job's car is another customer's; the invoice is in another customer's name
--   D4.phone / D4.vin info     two customers with the same phone; one VIN on two cars
--   S1.drift bad  stock on hand vs the sum of its moves, against the baseline taken at the first run
--   S2.negative warn  less than zero in stock;  S2.unused warn  a job finished these 14 days that sold a stock item and
--                 took nothing out of the stock

-- ───────────────────────────── tables (server only: row level security on, no policy, no grant to the app) ─────────────────────────────
create table if not exists public.ops_recon_runs (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,
  source      text not null default 'manual',
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'ok' check (status in ('ok', 'warn', 'bad')),
  counts      jsonb not null default '{}'::jsonb,
  sheet       jsonb not null default '{}'::jsonb
);
create unique index if not exists ops_recon_runs_day on public.ops_recon_runs (day);

create table if not exists public.ops_recon_findings (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,                 -- check_id ':' entity_id [':' sig]: the same difference keeps its row
  check_id     text not null,
  severity     text not null check (severity in ('bad', 'warn', 'info')),
  entity_table text,
  entity_id    uuid,
  message_fr   text not null,
  message_en   text not null,
  data         jsonb not null default '{}'::jsonb,
  first_day    date not null,
  last_day     date not null,
  state        text not null default 'open' check (state in ('open', 'acked', 'closed')),
  acked_by     uuid,
  acked_at     timestamptz,
  note         text,
  outside      boolean not null default false,       -- added by recon_add (a check made by a server function)
  last_run     uuid,                                 -- the last run that saw it
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  closed_at    timestamptz
);
create index if not exists ops_recon_findings_state on public.ops_recon_findings (state, severity);

create table if not exists public.ops_recon_baseline (
  id        uuid primary key default gen_random_uuid(),   -- a plain id, so the backup and the restore carry it like the other tables
  check_id  text not null,
  entity_id uuid not null,                           -- the zero uuid: « the baseline of this check was taken »
  value     numeric not null,
  set_on    date not null,
  set_at    timestamptz not null default now(),
  unique (check_id, entity_id)
);

do $$ declare t text; begin
  foreach t in array array['ops_recon_runs', 'ops_recon_findings', 'ops_recon_baseline'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- ───────────────────────────── words ─────────────────────────────
-- 12000 → « 120,00 $ » / « $120.00 »
create or replace function public.recon_money_fr(p_cents numeric) returns text language sql immutable set search_path = public as $$
  select replace(to_char(coalesce(p_cents, 0) / 100.0, 'FM999999990.00'), '.', ',') || ' $'
$$;
create or replace function public.recon_money_en(p_cents numeric) returns text language sql immutable set search_path = public as $$
  select case when coalesce(p_cents, 0) < 0 then '-' else '' end || '$' || to_char(abs(coalesce(p_cents, 0)) / 100.0, 'FM999999990.00')
$$;
-- 12 → « F-0012 » as the app writes it (no number: « sans numéro » / « no number »)
create or replace function public.recon_inv_no(p_number bigint, p_lang text default 'fr') returns text
language sql stable security definer set search_path = public as $$
  select case when p_number is null then case when p_lang = 'en' then 'with no number' else 'sans numéro' end else
    coalesce((select s.billing->>'invoice_prefix' from public.settings s where s.id = 1), '')
    || lpad(p_number::text, greatest(coalesce((select (s.billing->>'pad')::int from public.settings s where s.id = 1), 4), length(p_number::text)), '0') end
$$;
create or replace function public.recon_staff_name(p_staff uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(s.short_name), ''), s.full_name) from public.staff s where s.id = p_staff
$$;
create or replace function public.recon_status_word(p_status text, p_lang text) returns text language sql immutable set search_path = public as $$
  select case when p_lang = 'en' then
    case p_status when 'booked' then 'booked' when 'en_route' then 'on the way' when 'on_site' then 'on site' when 'done' then 'done'
      when 'cancelled' then 'cancelled' when 'no_show' then 'a no-show' else p_status end
  else
    case p_status when 'booked' then 'réservée' when 'en_route' then 'en route' when 'on_site' then 'sur place' when 'done' then 'terminée'
      when 'cancelled' then 'annulée' when 'no_show' then 'client absent' else p_status end end
$$;
create or replace function public.recon_method_word(p_method text, p_lang text) returns text language sql immutable set search_path = public as $$
  select case when p_lang = 'en' then
    case p_method when 'cash' then 'cash' when 'debit' then 'debit' when 'credit' then 'credit' when 'interac' then 'Interac'
      when 'card_online' then 'online card' when 'cheque' then 'cheque' else 'other' end
  else
    case p_method when 'cash' then 'comptant' when 'debit' then 'débit' when 'credit' then 'crédit' when 'interac' then 'Interac'
      when 'card_online' then 'carte en ligne' when 'cheque' then 'chèque' else 'autre' end end
$$;
-- 795 → « 13 h 15 » / « 13:15 »
create or replace function public.recon_hhmm(p_min int, p_lang text) returns text language sql immutable set search_path = public as $$
  select case when p_lang = 'en' then (p_min / 60)::text || ':' || lpad((p_min % 60)::text, 2, '0')
              else (p_min / 60)::text || ' h ' || lpad((p_min % 60)::text, 2, '0') end
$$;
-- who sees a check: the owner every check; « Trésorerie » the money (M…) and stock (S…) checks, and the money checks a server
-- function adds (Stripe: « stripe_… », or any check named « money… » / « stock… »). The backup and the phones: the owner only.
create or replace function public.recon_for_treasury(p_check text) returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_check, '') ~ '^([MS][0-9]|stripe|money|stock)'
$$;

-- the test hook: a test makes one check throw with « set garage.recon_fail = 'M3' » (never set by the app or the server)
create or replace function public.recon_trip(p_check text) returns void language plpgsql stable set search_path = public as $$
begin
  if coalesce(current_setting('garage.recon_fail', true), '') = p_check then
    raise exception 'recon test: % made to fail', p_check;
  end if;
end $$;

-- the finding that says a check could not be made
create or replace function public.recon_error(p_check text, p_err text) returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_array(jsonb_build_object('c', p_check || '.error', 's', 'warn', 't', null, 'e', null, 'k', null,
    'fr', format('La vérification %s n’a pas pu se faire (%s) : les autres vérifications ont marché. Dis-le au responsable de l’app.', p_check, left(p_err, 200)),
    'en', format('Check %s could not run (%s); the other checks ran. Tell the person in charge of the app.', p_check, left(p_err, 200)),
    'd', jsonb_build_object('check', p_check, 'error', left(p_err, 500))))
$$;

-- ───────────────────────────── the day's sheet ─────────────────────────────
-- { invoiced_cents, received: [{ method, by, by_name, cents }], refunded_cents, expenses: [{ category, cents }],
--   coffre_in_cents, coffre_out_cents, to_receive_cents }  — a Montréal day; « to receive » = the invoices finished by the
-- end of that day that are still not fully paid now.
create or replace function public.recon_sheet(p_day date) returns jsonb
language sql stable security definer set search_path = public as $$
  with b as (select (p_day::timestamp at time zone 'America/Toronto') as d0, ((p_day + 1)::timestamp at time zone 'America/Toronto') as d1),
  pay as (select p.* from public.payments p, b where p.deleted_at is null and p.paid_at >= b.d0 and p.paid_at < b.d1)
  select jsonb_build_object(
    'invoiced_cents', (select coalesce(sum(v.total_cents), 0) from public.invoices v, b
                       where v.deleted_at is null and v.status in ('issued', 'paid') and v.issued_at >= b.d0 and v.issued_at < b.d1),
    'received', (select coalesce(jsonb_agg(jsonb_build_object('method', r.method, 'by', r.by, 'by_name', public.recon_staff_name(r.by), 'cents', r.cents)
                                   order by r.method, r.cents desc), '[]'::jsonb)
                 from (select method, created_by as by, sum(amount_cents)::bigint as cents from pay where amount_cents > 0 group by 1, 2) r),
    'refunded_cents', (select coalesce(-sum(amount_cents), 0) from pay where amount_cents < 0),
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object('category', x.category, 'cents', x.cents) order by x.category), '[]'::jsonb)
                 from (select e.category, sum(e.total_cents)::bigint as cents from public.expenses e
                       where e.deleted_at is null and e.day = p_day group by 1) x),
    'coffre_in_cents', (select coalesce(sum(c.amount_cents), 0) from public.coffre c where c.deleted_at is null and c.kind = 'received' and c.received_on = p_day),
    'coffre_out_cents', (select coalesce(sum(c.amount_cents), 0) from public.coffre c where c.deleted_at is null and c.kind = 'purchase' and c.received_on = p_day),
    'to_receive_cents', (select coalesce(sum(greatest(v.total_cents - v.paid_cents, 0)), 0) from public.invoices v, b
                         where v.deleted_at is null and v.status = 'issued' and v.issued_at < b.d1))
$$;

-- ───────────────────────────── the checks ─────────────────────────────
-- ONE call = one snapshot (a stable function reads everything as of the query that called it). Each check is one query
-- in its own block: a check that throws gives its « .error » finding and the others go on. Each row:
-- { c: check_id, s: severity, t: entity_table, e: entity_id, k: extra key (when one entity can differ twice), fr, en, d: data }.
-- Answer: { findings: [...], sheet: {...}, baseline: [{ id, value }] (only while S1 has no baseline yet) }.
create or replace function public.recon_collect(p_day date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_all jsonb := '[]'::jsonb;
  v_part jsonb;
  v_today date := public.local_today();
  v_taxes jsonb := (select s.taxes from public.settings s where s.id = 1);
  v_tax_on boolean := coalesce((v_taxes->>'enabled')::boolean, true);
  v_tps numeric := coalesce((v_taxes->>'tps')::numeric, 0.05);
  v_tvq numeric := coalesce((v_taxes->>'tvq')::numeric, 0.09975);
  v_base_set boolean := exists (select 1 from public.ops_recon_baseline b where b.check_id = 'S1' and b.entity_id = '00000000-0000-0000-0000-000000000000');
  v_baseline jsonb;
  v_sheet jsonb;
  v_t timestamptz;
  v_ms jsonb := '{}'::jsonb;    -- how long each check took (ms), kept in the run's counts
begin
  -- ══════ M1: each invoice adds up (the rule of invoice_totals: a discount always takes off) ══════
  begin
    perform public.recon_trip('M1');
    v_t := clock_timestamp();
    with l as (
      select v.id, x.l,
             (case when x.l->>'kind' = 'discount' then -abs(round(coalesce((x.l->>'qty')::numeric, 1) * coalesce((x.l->>'unit_cents')::numeric, 0)))
                   else round(coalesce((x.l->>'qty')::numeric, 1) * coalesce((x.l->>'unit_cents')::numeric, 0)) end)::bigint as lt,
             coalesce((x.l->>'taxable')::boolean, true) as taxable
      from public.invoices v cross join lateral jsonb_array_elements(v.lines) x(l)
      where v.deleted_at is null and v.status in ('issued', 'paid')
    ), s as (
      select id, sum(lt)::bigint as sub, coalesce(sum(lt) filter (where taxable), 0)::bigint as tx,
             count(*) filter (where (l->>'total_cents') is null or (l->>'total_cents')::numeric <> lt) as off
      from l group by id
    )
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'M1.sum' c, 'bad' s, 'invoices' t, v.id e, null::text k,
             format('Les montants de la facture %s ne s’additionnent pas (lignes : %s, avant taxes : %s, taxes : %s, total : %s) : ouvre la facture et vérifie ses lignes.',
                    public.recon_inv_no(v.number), public.recon_money_fr(coalesce(s.sub, 0)), public.recon_money_fr(v.subtotal_cents),
                    public.recon_money_fr(v.tps_cents + v.tvq_cents), public.recon_money_fr(v.total_cents)) fr,
             format('The amounts of invoice %s do not add up (lines: %s, before taxes: %s, taxes: %s, total: %s): open the invoice and check its lines.',
                    public.recon_inv_no(v.number, 'en'), public.recon_money_en(coalesce(s.sub, 0)), public.recon_money_en(v.subtotal_cents),
                    public.recon_money_en(v.tps_cents + v.tvq_cents), public.recon_money_en(v.total_cents)) en,
             jsonb_build_object('number', v.number, 'job_id', v.job_id, 'lines', coalesce(s.sub, 0), 'subtotal', v.subtotal_cents, 'taxable_lines', greatest(coalesce(s.tx, 0), 0),
                                'taxable', v.taxable_cents, 'tps', v.tps_cents, 'tvq', v.tvq_cents, 'total', v.total_cents, 'lines_off', coalesce(s.off, 0)) d
      from public.invoices v left join s on s.id = v.id
      where v.deleted_at is null and v.status in ('issued', 'paid')
        and (coalesce(s.sub, 0) <> v.subtotal_cents or greatest(coalesce(s.tx, 0), 0) <> v.taxable_cents or coalesce(s.off, 0) > 0
             or v.total_cents <> v.subtotal_cents + v.tps_cents + v.tvq_cents)
      union all
      select 'M1.tax', 'warn', 'invoices', v.id, null,
             format('Les taxes de la facture %s (TPS %s, TVQ %s) ne sont pas celles du taux du garage (TPS %s, TVQ %s) : vérifie si la facture a été changée à la main.',
                    public.recon_inv_no(v.number), public.recon_money_fr(v.tps_cents), public.recon_money_fr(v.tvq_cents), public.recon_money_fr(w.tps), public.recon_money_fr(w.tvq)),
             format('The taxes of invoice %s (GST %s, QST %s) are not the garage''s rates (GST %s, QST %s): check whether the invoice was changed by hand.',
                    public.recon_inv_no(v.number, 'en'), public.recon_money_en(v.tps_cents), public.recon_money_en(v.tvq_cents), public.recon_money_en(w.tps), public.recon_money_en(w.tvq)),
             jsonb_build_object('number', v.number, 'job_id', v.job_id, 'taxable', v.taxable_cents, 'tps', v.tps_cents, 'tvq', v.tvq_cents, 'want_tps', w.tps, 'want_tvq', w.tvq)
      from public.invoices v
      cross join lateral (select case when v.taxes_on and v_tax_on and v.taxable_cents > 0 then round(v.taxable_cents * v_tps)::int else 0 end as tps,
                                 case when v.taxes_on and v_tax_on and v.taxable_cents > 0 then round(v.taxable_cents * v_tvq)::int else 0 end as tvq) w
      where v.deleted_at is null and v.status in ('issued', 'paid') and (v.tps_cents <> w.tps or v.tvq_cents <> w.tvq)
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('M1', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('M1', sqlerrm);
  end;

  -- ══════ M2: « payé » is the sum of the payments, the status follows; drafts and cancelled invoices hold no money ══════
  begin
    perform public.recon_trip('M2');
    v_t := clock_timestamp();
    with p as (select invoice_id, sum(amount_cents)::bigint as s, count(*) as n from public.payments where deleted_at is null and invoice_id is not null group by invoice_id),
    v as (select v.*, coalesce(p.s, 0) as pay, coalesce(p.n, 0) as n from public.invoices v left join p on p.invoice_id = v.id)
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'M2.paid' c, 'bad' s, 'invoices' t, v.id e, null::text k,
             format('La facture %s dit payé %s, mais ses paiements font %s : ouvre la facture et vérifie les paiements.',
                    public.recon_inv_no(v.number), public.recon_money_fr(v.paid_cents), public.recon_money_fr(v.pay)) fr,
             format('Invoice %s says %s paid, but its payments add up to %s: open the invoice and check the payments.',
                    public.recon_inv_no(v.number, 'en'), public.recon_money_en(v.paid_cents), public.recon_money_en(v.pay)) en,
             jsonb_build_object('number', v.number, 'job_id', v.job_id, 'paid', v.paid_cents, 'payments', v.pay, 'n', v.n, 'total', v.total_cents) d
      from v where v.deleted_at is null and v.status in ('issued', 'paid') and v.paid_cents <> v.pay
      union all
      select 'M2.status', 'bad', 'invoices', v.id, null,
             format('La facture %s est marquée « %s », mais il a été payé %s sur %s : ouvre la facture et vérifie son état.',
                    public.recon_inv_no(v.number), case when v.status = 'paid' then 'payée' else 'à payer' end, public.recon_money_fr(v.paid_cents), public.recon_money_fr(v.total_cents)),
             format('Invoice %s is marked « %s », but %s of %s was paid: open the invoice and check its status.',
                    public.recon_inv_no(v.number, 'en'), case when v.status = 'paid' then 'paid' else 'to pay' end, public.recon_money_en(v.paid_cents), public.recon_money_en(v.total_cents)),
             jsonb_build_object('number', v.number, 'job_id', v.job_id, 'status', v.status, 'paid', v.paid_cents, 'total', v.total_cents)
      from v where v.deleted_at is null and v.paid_cents = v.pay
        and ((v.status = 'paid' and v.paid_cents < v.total_cents) or (v.status = 'issued' and v.paid_cents >= v.total_cents))
      union all
      select 'M2.over', 'warn', 'invoices', v.id, null,
             format('Le client a payé %s de trop sur la facture %s (payé %s, total %s) : rembourse-le, ou note pourquoi.',
                    public.recon_money_fr(v.pay - v.total_cents), public.recon_inv_no(v.number), public.recon_money_fr(v.pay), public.recon_money_fr(v.total_cents)),
             format('The customer paid %s too much on invoice %s (paid %s, total %s): give it back, or note why.',
                    public.recon_money_en(v.pay - v.total_cents), public.recon_inv_no(v.number, 'en'), public.recon_money_en(v.pay), public.recon_money_en(v.total_cents)),
             jsonb_build_object('number', v.number, 'job_id', v.job_id, 'paid', v.pay, 'total', v.total_cents, 'over', v.pay - v.total_cents)
      from v where v.deleted_at is null and v.status in ('issued', 'paid') and v.pay > v.total_cents and v.paid_cents = v.pay
      union all
      select 'M2.draft', 'bad', 'invoices', v.id, null,
             format('La facture %s est un brouillon, mais %s de paiements y sont attachés : termine la facture (les paiements doivent attendre sur la job).',
                    public.recon_inv_no(v.number), public.recon_money_fr(greatest(v.pay, v.paid_cents))),
             format('Invoice %s is a draft, but %s of payments are attached to it: finish the invoice (payments must wait on the job).',
                    public.recon_inv_no(v.number, 'en'), public.recon_money_en(greatest(v.pay, v.paid_cents))),
             jsonb_build_object('number', v.number, 'job_id', v.job_id, 'payments', v.pay, 'n', v.n, 'paid', v.paid_cents)
      from v where v.deleted_at is null and v.status = 'draft' and (v.n > 0 or v.paid_cents <> 0)
      union all
      select 'M2.void', 'bad', 'invoices', v.id, null,
             format('La facture %s est %s, mais elle garde %s de paiements : rembourse le client, ou remets le paiement sur la bonne facture.',
                    public.recon_inv_no(v.number), case when v.deleted_at is not null then 'effacée' else 'annulée' end, public.recon_money_fr(v.pay)),
             format('Invoice %s is %s, but it still holds %s of payments: give the money back, or put the payment on the right invoice.',
                    public.recon_inv_no(v.number, 'en'), case when v.deleted_at is not null then 'deleted' else 'cancelled' end, public.recon_money_en(v.pay)),
             jsonb_build_object('number', v.number, 'job_id', v.job_id, 'payments', v.pay, 'n', v.n, 'deleted', v.deleted_at is not null)
      from v where (v.status = 'void' or v.deleted_at is not null) and v.pay <> 0
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('M2', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('M2', sqlerrm);
  end;

  -- ══════ M3: invoice numbers ══════
  begin
    perform public.recon_trip('M3');
    v_t := clock_timestamp();
    with k as (select next_value from public.counters where name = 'invoice'),
    b as (select max(v.number) as mx from public.invoices v where v.number is not null),
    -- the holes as runs of missing numbers (gaps and islands): between two numbers in use, and after the last one up to the
    -- counter. One finding per run, the 50 newest; the older runs together in one finding (a counter set far ahead by a
    -- bad restore is ONE finding, not thousands).
    nums as (select distinct v.number as n from public.invoices v where v.number is not null),
    holes as (select x.g0, x.g1, row_number() over (order by x.g0 desc) as rk
              from (select s.n + 1 as g0, s.nn - 1 as g1 from (select n, lead(n) over (order by n) as nn from nums) s where s.nn > s.n + 1
                    union all
                    select b.mx + 1, k.next_value - 1 from b cross join k where b.mx is not null and k.next_value - 1 > b.mx) x)
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'M3.double' c, 'bad' s, null::text t, null::uuid e, 'n' || v.number k,
             format('Le numéro de facture %s est sur %s factures : dis-le au responsable de l’app.', public.recon_inv_no(v.number), count(*)) fr,
             format('Invoice number %s is on %s invoices: tell the person in charge of the app.', public.recon_inv_no(v.number, 'en'), count(*)) en,
             jsonb_build_object('number', v.number, 'n', count(*)) d
      from public.invoices v where v.number is not null group by v.number having count(*) > 1
      union all
      select 'M3.gap', 'bad', null, null, 'n' || h.g0,
             case when h.g0 = h.g1
                  then format('Le numéro de facture %s manque : aucune facture ne l’a. Vérifie si une facture a été effacée, et note-le pour le comptable.', public.recon_inv_no(h.g0))
                  else format('Les numéros de facture %s à %s manquent (%s numéros) : aucune facture ne les a. Vérifie si des factures ont été effacées ou si le compteur a sauté, et note-le pour le comptable.',
                              public.recon_inv_no(h.g0), public.recon_inv_no(h.g1), h.g1 - h.g0 + 1) end,
             case when h.g0 = h.g1
                  then format('Invoice number %s is missing: no invoice has it. Check whether an invoice was deleted, and note it for the accountant.', public.recon_inv_no(h.g0, 'en'))
                  else format('Invoice numbers %s to %s are missing (%s numbers): no invoice has them. Check whether invoices were deleted or the counter jumped, and note it for the accountant.',
                              public.recon_inv_no(h.g0, 'en'), public.recon_inv_no(h.g1, 'en'), h.g1 - h.g0 + 1) end,
             jsonb_build_object('number', h.g0, 'to', h.g1, 'n', h.g1 - h.g0 + 1)
      from holes h where h.rk <= 50
      union all
      select 'M3.gapmore', 'bad', null, null, 'more',
             format('Il manque aussi %s autres séries de numéros de facture, plus anciennes (%s numéros, jusqu’à %s) : dis-le au responsable de l’app, et note-le pour le comptable.',
                    count(*), sum(h.g1 - h.g0 + 1), public.recon_inv_no(max(h.g1))),
             format('%s more, older runs of invoice numbers are missing too (%s numbers, up to %s): tell the person in charge of the app, and note it for the accountant.',
                    count(*), sum(h.g1 - h.g0 + 1), public.recon_inv_no(max(h.g1), 'en')),
             jsonb_build_object('runs', count(*), 'n', sum(h.g1 - h.g0 + 1), 'to', max(h.g1))
      from holes h where h.rk > 50 having count(*) > 0
      union all
      select 'M3.deleted', 'bad', 'invoices', v.id, null,
             format('La facture %s a été effacée alors qu’elle avait un numéro : son numéro manque dans les livres. Note-le pour le comptable (la prochaine fois, annule-la plutôt).', public.recon_inv_no(v.number)),
             format('Invoice %s was deleted although it had a number: its number is missing from the books. Note it for the accountant (next time, cancel it instead).', public.recon_inv_no(v.number, 'en')),
             jsonb_build_object('number', v.number, 'job_id', v.job_id, 'total', v.total_cents)
      from public.invoices v where v.number is not null and v.deleted_at is not null
      union all
      select 'M3.counter', 'bad', null, null, 'counter',
             format('Le compteur des factures (prochain numéro : %s) n’est pas après la dernière facture (%s) : la prochaine facture ne pourra pas se terminer. Dis-le au responsable de l’app.',
                    coalesce((select next_value from k)::text, '?'), public.recon_inv_no(b.mx)),
             format('The invoice counter (next number: %s) is not after the last invoice (%s): the next invoice will not finish. Tell the person in charge of the app.',
                    coalesce((select next_value from k)::text, '?'), public.recon_inv_no(b.mx, 'en')),
             jsonb_build_object('next', (select next_value from k), 'max', b.mx)
      from b where b.mx is not null and coalesce((select next_value from k), 0) <= b.mx
      union all
      select 'M3.nonumber', 'bad', 'invoices', v.id, null,
             format('Une facture terminée (%s) n’a pas %s : dis-le au responsable de l’app.', public.recon_money_fr(v.total_cents),
                    case when v.number is null then 'de numéro' else 'de date' end),
             format('A finished invoice (%s) has no %s: tell the person in charge of the app.', public.recon_money_en(v.total_cents),
                    case when v.number is null then 'number' else 'date' end),
             jsonb_build_object('number', v.number, 'job_id', v.job_id, 'issued_at', v.issued_at)
      from public.invoices v where v.deleted_at is null and v.status in ('issued', 'paid') and (v.number is null or v.issued_at is null)
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('M3', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('M3', sqlerrm);
  end;

  -- ══════ M4: each payment sits on the right document ══════
  begin
    perform public.recon_trip('M4');
    v_t := clock_timestamp();
    with fin as (select v.job_id, v.id, v.number from public.invoices v where v.deleted_at is null and v.status in ('issued', 'paid') and v.job_id is not null),
    p as (select p.*, j.number as job_no, j.status as job_status, j.coffre_id, v.job_id as inv_job, v.number as inv_no
          from public.payments p left join public.jobs j on j.id = p.job_id left join public.invoices v on v.id = p.invoice_id
          where p.deleted_at is null)
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'M4.orphan' c, 'bad' s, 'payments' t, p.id e, null::text k,
             case when p.invoice_id is null and p.job_id is null
                  then format('Un paiement de %s (%s, le %s) n’est attaché à aucune facture ni aucune job : retrouve à qui il est.',
                              public.recon_money_fr(p.amount_cents), public.recon_method_word(p.method, 'fr'), to_char(p.paid_at at time zone 'America/Toronto', 'YYYY-MM-DD'))
                  else format('Un paiement de %s est sur la facture %s, qui est celle d’une autre job (job %s) : remets-le sur la bonne facture.',
                              public.recon_money_fr(p.amount_cents), public.recon_inv_no(p.inv_no), coalesce(p.job_no::text, '?')) end fr,
             case when p.invoice_id is null and p.job_id is null
                  then format('A payment of %s (%s, on %s) is attached to no invoice and no job: find out whose it is.',
                              public.recon_money_en(p.amount_cents), public.recon_method_word(p.method, 'en'), to_char(p.paid_at at time zone 'America/Toronto', 'YYYY-MM-DD'))
                  else format('A payment of %s is on invoice %s, which belongs to another job (job %s): put it on the right invoice.',
                              public.recon_money_en(p.amount_cents), public.recon_inv_no(p.inv_no, 'en'), coalesce(p.job_no::text, '?')) end en,
             jsonb_build_object('amount', p.amount_cents, 'method', p.method, 'invoice_id', p.invoice_id, 'job_id', p.job_id) d
      from p where (p.invoice_id is null and p.job_id is null) or (p.invoice_id is not null and p.job_id is not null and p.inv_job is distinct from p.job_id)
      union all
      select 'M4.card', 'bad', 'payments', p.id, null,
             format('Un paiement « carte en ligne » de %s n’a pas sa session Stripe : vérifie dans Stripe que la carte a vraiment été payée.', public.recon_money_fr(p.amount_cents)),
             format('An « online card » payment of %s has no Stripe session: check in Stripe that the card was really charged.', public.recon_money_en(p.amount_cents)),
             jsonb_build_object('amount', p.amount_cents, 'invoice_id', p.invoice_id, 'job_id', p.job_id)
      from p where p.method = 'card_online' and p.stripe_session is null
      union all
      select 'M4.waiting', 'bad', 'payments', p.id, null,
             format('Un paiement de %s (%s) attend sur la job %s alors que sa facture %s est terminée : il ne compte pas sur la facture. Ouvre la facture et vérifie les paiements.',
                    public.recon_money_fr(p.amount_cents), public.recon_method_word(p.method, 'fr'), p.job_no, public.recon_inv_no(fin.number)),
             format('A payment of %s (%s) is waiting on job %s although its invoice %s is finished: it does not count on the invoice. Open the invoice and check the payments.',
                    public.recon_money_en(p.amount_cents), public.recon_method_word(p.method, 'en'), p.job_no, public.recon_inv_no(fin.number, 'en')),
             jsonb_build_object('amount', p.amount_cents, 'method', p.method, 'job_id', p.job_id, 'invoice_id', fin.id)
      from p join fin on fin.job_id = p.job_id where p.invoice_id is null
      union all
      select 'M4.closed', 'warn', 'payments', p.id, null,
             format('Un paiement de %s attend sur la job %s, qui est %s, sans facture terminée : fais la facture, ou rembourse le client.',
                    public.recon_money_fr(p.amount_cents), p.job_no, public.recon_status_word(p.job_status, 'fr')),
             format('A payment of %s is waiting on job %s, which is %s, with no finished invoice: make the invoice, or give the money back.',
                    public.recon_money_en(p.amount_cents), p.job_no, public.recon_status_word(p.job_status, 'en')),
             jsonb_build_object('amount', p.amount_cents, 'method', p.method, 'job_id', p.job_id, 'job_status', p.job_status)
      from p where p.invoice_id is null and p.job_id is not null and p.coffre_id is null and p.job_status in ('done', 'cancelled', 'no_show')
        and not exists (select 1 from fin where fin.job_id = p.job_id)
      union all
      select 'M4.double', 'warn', 'payments', b.id, null,
             format('Deux paiements de %s (%s) à moins de 2 minutes sur %s : vérifie que le client n’a pas payé deux fois.',
                    public.recon_money_fr(b.amount_cents), public.recon_method_word(b.method, 'fr'),
                    case when b.invoice_id is not null then 'la facture ' || public.recon_inv_no(b.inv_no) else 'la job ' || b.job_no end),
             format('Two payments of %s (%s) less than 2 minutes apart on %s: check that the customer did not pay twice.',
                    public.recon_money_en(b.amount_cents), public.recon_method_word(b.method, 'en'),
                    case when b.invoice_id is not null then 'invoice ' || public.recon_inv_no(b.inv_no, 'en') else 'job ' || b.job_no end),
             jsonb_build_object('amount', b.amount_cents, 'method', b.method, 'invoice_id', b.invoice_id, 'job_id', b.job_id)
      from (select p.*, lag(p.paid_at) over (partition by coalesce(p.invoice_id, p.job_id), p.invoice_id is null, p.method, p.amount_cents order by p.paid_at, p.id) as prev_at
            from p where p.amount_cents > 0 and (p.invoice_id is not null or p.job_id is not null)) b
      where b.prev_at is not null and b.paid_at - b.prev_at <= interval '2 minutes'
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('M4', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('M4', sqlerrm);
  end;

  -- ══════ M5: every finished job is billed and paid (or known as « payer plus tard ») ══════
  begin
    perform public.recon_trip('M5');
    v_t := clock_timestamp();
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'M5.unbilled' c, 'bad' s, 'jobs' t, j.id e, null::text k,
             format('La job %s du %s est terminée, mais elle n’a pas de facture : fais sa facture et encaisse-la (ou mets-la au Coffre).', j.number, j.day) fr,
             format('Job %s of %s is done, but it has no invoice: make its invoice and get it paid (or put it in the Coffre).', j.number, j.day) en,
             jsonb_build_object('job', j.number, 'day', j.day, 'pay_later', j.pay_later) d
      from public.jobs j
      where j.deleted_at is null and j.status = 'done' and j.coffre_id is null and not exists (select 1 from public.invoices i where i.job_id = j.id and i.deleted_at is null and i.status <> 'void')
      union all
      select 'M5.draft', 'warn', 'jobs', j.id, null,
             format('La job %s du %s est terminée, mais sa facture est encore un brouillon%s : termine la facture.', j.number, j.day,
                    case when i.created_at < now() - interval '2 days' then ' depuis plus de 2 jours' else '' end),
             format('Job %s of %s is done, but its invoice is still a draft%s: finish the invoice.', j.number, j.day,
                    case when i.created_at < now() - interval '2 days' then ' for more than 2 days' else '' end),
             jsonb_build_object('job', j.number, 'day', j.day, 'invoice_id', i.id, 'number', i.number, 'total', i.total_cents)
      from public.jobs j join public.invoices i on i.job_id = j.id and i.deleted_at is null and i.status = 'draft'
      where j.deleted_at is null and j.status = 'done' and j.coffre_id is null
      union all
      select 'M5.unpaid', 'warn', 'jobs', j.id, null,
             format('La job %s du %s est terminée, mais sa facture %s n’est pas payée (reste %s) et personne n’a permis « payer plus tard » : encaisse-la, ou note pourquoi.',
                    j.number, j.day, public.recon_inv_no(i.number), public.recon_money_fr(i.total_cents - i.paid_cents)),
             format('Job %s of %s is done, but its invoice %s is not paid (%s left) and nobody allowed « pay later »: get it paid, or note why.',
                    j.number, j.day, public.recon_inv_no(i.number, 'en'), public.recon_money_en(i.total_cents - i.paid_cents)),
             jsonb_build_object('job', j.number, 'day', j.day, 'invoice_id', i.id, 'number', i.number, 'due', i.total_cents - i.paid_cents)
      from public.jobs j join public.invoices i on i.job_id = j.id and i.deleted_at is null and i.status = 'issued'
      where j.deleted_at is null and j.status = 'done' and j.coffre_id is null and not j.pay_later and i.paid_cents < i.total_cents
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('M5', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('M5', sqlerrm);
  end;

  -- ══════ M7: expenses add up; stock paid by the Trésorerie has its expense ══════
  begin
    perform public.recon_trip('M7');
    v_t := clock_timestamp();
    with mv as materialized (select m.id, m.item_id, m.delta, m.created_at, i.name from public.inventory_moves m join public.inventory_items i on i.id = m.item_id
                where m.deleted_at is null and m.reason = 'restock' and m.note like '%Payé par la Trésorerie'),
    -- the expense of a purchase: the one that names the move (expenses.move_id, when that column exists), else the one made
    -- in the same transaction (inventory_buy writes both at the same instant). Each expense is read ONCE (to_jsonb only
    -- here), and moves and expenses are matched by GROUPING them on the shared key, never by a join: the time is moves +
    -- expenses (one sort each) whatever plan the database picks (a join here was moves × moves × expenses when the
    -- planner, without statistics, took nested loops: 16 s for 100 purchases and 400 expenses).
    e1 as materialized (select e.created_at, e.category, e.deleted_at is null as alive, to_jsonb(e)->>'move_id' as move_id
                        from public.expenses e),
    -- by instant (inst): the moves and the « Pièces » expenses made at that instant
    inst as (select t.ts, array_agg(t.mid) filter (where t.mid is not null) as mids, bool_or(t.alive) as alive, count(t.alive) as ne
           from (select mv.created_at as ts, mv.id::text as mid, null::boolean as alive from mv
                 union all
                 select x.created_at, null, x.alive from e1 x where x.category = 'Pièces') t
           group by t.ts),
    hit as (select mv.id::text as mid, null::boolean as alive, true as is_move from mv
            union all
            select x.move_id, x.alive, false from e1 x where x.move_id is not null
            union all
            select unnest(a.mids), a.alive, false from inst a where a.ne > 0 and a.mids is not null),
    -- per move, alive: true = a live expense, false = only deleted ones, null = none at all; only the moves with a problem
    ex as (select h.mid as move_id, bool_or(h.alive) as alive from hit h group by h.mid
           having bool_or(h.is_move) and bool_or(h.alive) is distinct from true)
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'M7.sum' c, 'bad' s, 'expenses' t, e.id e, null::text k,
             format('La dépense %s du %s ne s’additionne pas (avant taxes %s + TPS %s + TVQ %s, total %s) : ouvre la dépense et corrige les montants du reçu.',
                    coalesce(nullif(trim(e.vendor), ''), e.category), e.day, public.recon_money_fr(e.subtotal_cents), public.recon_money_fr(e.tps_cents),
                    public.recon_money_fr(e.tvq_cents), public.recon_money_fr(e.total_cents)) fr,
             format('Expense %s of %s does not add up (before taxes %s + GST %s + QST %s, total %s): open the expense and fix the amounts from the receipt.',
                    coalesce(nullif(trim(e.vendor), ''), e.category), e.day, public.recon_money_en(e.subtotal_cents), public.recon_money_en(e.tps_cents),
                    public.recon_money_en(e.tvq_cents), public.recon_money_en(e.total_cents)) en,
             jsonb_build_object('day', e.day, 'subtotal', e.subtotal_cents, 'tps', e.tps_cents, 'tvq', e.tvq_cents, 'total', e.total_cents) d
      from public.expenses e
      where e.deleted_at is null and (e.subtotal_cents + e.tps_cents + e.tvq_cents <> e.total_cents or e.total_cents <= 0
         or e.subtotal_cents < 0 or e.tps_cents < 0 or e.tvq_cents < 0)
      union all
      select case when ex.alive is null then 'M7.stock' else 'M7.stockgone' end, case when ex.alive is null then 'bad' else 'warn' end, 'inventory_moves', mv.id, null,
             case when ex.alive is null
                  then format('L’achat de stock « %s » (%s, le %s) dit « payé par la Trésorerie », mais il n’a pas de dépense : ajoute la dépense dans la Trésorerie.',
                              mv.name, mv.delta, to_char(mv.created_at at time zone 'America/Toronto', 'YYYY-MM-DD'))
                  else format('La dépense de l’achat de stock « %s » (%s, le %s) a été effacée, mais le stock est resté : remets la dépense, ou retire le stock.',
                              mv.name, mv.delta, to_char(mv.created_at at time zone 'America/Toronto', 'YYYY-MM-DD')) end,
             case when ex.alive is null
                  then format('The stock purchase « %s » (%s, on %s) says « paid by the Treasury », but it has no expense: add the expense in the Treasury.',
                              mv.name, mv.delta, to_char(mv.created_at at time zone 'America/Toronto', 'YYYY-MM-DD'))
                  else format('The expense of the stock purchase « %s » (%s, on %s) was deleted, but the stock stayed: put the expense back, or take the stock out.',
                              mv.name, mv.delta, to_char(mv.created_at at time zone 'America/Toronto', 'YYYY-MM-DD')) end,
             jsonb_build_object('item_id', mv.item_id, 'qty', mv.delta)
      from ex join mv on mv.id::text = ex.move_id
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('M7', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('M7', sqlerrm);
  end;

  -- ══════ M8: the Coffre ══════
  begin
    perform public.recon_trip('M8');
    v_t := clock_timestamp();
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'M8.link' c, 'bad' s, 'coffre' t, k.id e, x.id::text k,
             format('Une entrée du Coffre du %s nomme la job %s, mais cette job %s : dis-le au responsable de l’app.', k.received_on, coalesce(j.number::text, '?'),
                    case when j.id is null then 'n’existe plus' else 'n’est plus au Coffre' end) fr,
             format('A Coffre entry of %s names job %s, but that job %s: tell the person in charge of the app.', k.received_on, coalesce(j.number::text, '?'),
                    case when j.id is null then 'no longer exists' else 'is no longer in the Coffre' end) en,
             jsonb_build_object('job_id', x.id, 'job', j.number) d
      from public.coffre k cross join lateral unnest(k.job_ids) x(id) left join public.jobs j on j.id = x.id
      where k.deleted_at is null and k.kind = 'received' and (j.id is null or j.coffre_id is distinct from k.id)
      union all
      select 'M8.link', 'bad', 'jobs', j.id, null,
             format('La job %s dit « payée par le Coffre », mais son entrée du Coffre %s : ouvre le Coffre et vérifie cette job.', j.number,
                    case when k.id is null or k.deleted_at is not null then 'n’existe plus' else 'ne la nomme pas' end),
             format('Job %s says « paid by the Coffre », but its Coffre entry %s: open the Coffre and check this job.', j.number,
                    case when k.id is null or k.deleted_at is not null then 'no longer exists' else 'does not name it' end),
             jsonb_build_object('job', j.number, 'coffre_id', j.coffre_id)
      from public.jobs j left join public.coffre k on k.id = j.coffre_id
      where j.coffre_id is not null and (k.id is null or k.deleted_at is not null or k.kind <> 'received' or not (j.id = any (k.job_ids)))
      union all
      select 'M8.money', 'bad', 'jobs', j.id, null,
             format('La job %s est payée par le Coffre, mais elle a %s : une job du Coffre n’a ni facture ni paiement. Annule la facture ou rembourse le paiement.', j.number,
                    concat_ws(' et ', case when i.id is not null then 'une facture' end, case when pay.s <> 0 then public.recon_money_fr(pay.s) || ' de paiements' end)),
             format('Job %s is paid by the Coffre, but it has %s: a Coffre job has no invoice and no payment. Cancel the invoice or give the payment back.', j.number,
                    concat_ws(' and ', case when i.id is not null then 'an invoice' end, case when pay.s <> 0 then public.recon_money_en(pay.s) || ' of payments' end)),
             jsonb_build_object('job', j.number, 'invoice_id', i.id, 'payments', pay.s)
      from public.jobs j
      left join public.invoices i on i.job_id = j.id and i.deleted_at is null and i.status <> 'void'
      cross join lateral (select coalesce(sum(p.amount_cents), 0)::bigint as s from public.payments p left join public.invoices pv on pv.id = p.invoice_id
                          where p.deleted_at is null and (p.job_id = j.id or pv.job_id = j.id)) pay
      where j.deleted_at is null and j.coffre_id is not null and (i.id is not null or pay.s <> 0)
      union all
      -- info only: the app lets a Coffre job be noted at 0 $ (« 0 $ si rien ») and buys Coffre stock without looking at the
      -- balance, so a Coffre under zero is a normal state, not a mistake (a daily « bad » here would cry wolf)
      select 'M8.balance', 'info', null, null, 'balance',
             format('Le Coffre est à %s : il a été dépensé plus que ce qui y a été noté comme reçu. Si c’est normal (des jobs de famille à 0 $), il n’y a rien à faire ; sinon, vérifie les entrées et les achats du Coffre.', public.recon_money_fr(b.s)),
             format('The Coffre is at %s: more was spent than what was noted as received. If that is normal (family jobs at $0), there is nothing to do; otherwise, check the Coffre''s entries and purchases.', public.recon_money_en(b.s)),
             jsonb_build_object('balance', b.s)
      from (select coalesce(sum(case when kind = 'purchase' then -amount_cents else amount_cents end), 0)::bigint as s from public.coffre where deleted_at is null) b
      where b.s < 0
      union all
      select 'M8.stock', 'bad', 'coffre', k.id, null,
             format('L’achat du Coffre « %s » du %s n’a pas son entrée de stock : ajoute l’entrée dans le stock du Coffre.', coalesce(k.item_name, '?'), k.received_on),
             format('The Coffre purchase « %s » of %s has no stock entry: add the entry in the Coffre''s stock.', coalesce(k.item_name, '?'), k.received_on),
             jsonb_build_object('item_id', k.item_id, 'qty', k.qty, 'amount', k.amount_cents)
      from public.coffre k cross join lateral (select to_jsonb(k)->>'move_id' as mid) km    -- read once per purchase
      where k.deleted_at is null and k.kind = 'purchase' and k.item_id is not null
        and not exists (select 1 from public.inventory_moves m where m.deleted_at is null and m.reason = 'restock' and m.item_id = k.item_id
                          and (m.id::text = km.mid or m.created_at = k.created_at))
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('M8', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('M8', sqlerrm);
  end;

  -- ══════ M9: a converted estimate has its job ══════
  begin
    perform public.recon_trip('M9');
    v_t := clock_timestamp();
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'M9.quote' c, 'warn' s, 'quotes' t, q.id e, null::text k,
             format('L’estimation %s est marquée « convertie », mais elle n’a pas de job : réserve la job, ou remets l’estimation ouverte.', q.number) fr,
             format('Estimate %s is marked « converted », but it has no job: book the job, or open the estimate again.', q.number) en,
             jsonb_build_object('quote', q.number, 'job_id', q.job_id) d
      from public.quotes q left join public.jobs j on j.id = q.job_id
      where q.deleted_at is null and q.status = 'converted' and (j.id is null or j.deleted_at is not null)
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('M9', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('M9', sqlerrm);
  end;

  -- ══════ D1: past jobs closed, each status with its time, one trip at a time ══════
  begin
    perform public.recon_trip('D1');
    v_t := clock_timestamp();
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'D1.past' c, 'warn' s, 'jobs' t, j.id e, null::text k,
             format('La job %s du %s est encore « %s » : termine-la, annule-la ou déplace-la.', j.number, j.day, public.recon_status_word(j.status, 'fr')) fr,
             format('Job %s of %s is still « %s »: finish it, cancel it or move it.', j.number, j.day, public.recon_status_word(j.status, 'en')) en,
             jsonb_build_object('job', j.number, 'day', j.day, 'status', j.status) d
      from public.jobs j where j.deleted_at is null and j.status in ('booked', 'en_route', 'on_site') and j.day < v_today
      union all
      select 'D1.stamp', 'warn', 'jobs', j.id, null,
             format('La job %s est « %s » sans l’heure qui va avec : dis-le au responsable de l’app.', j.number, public.recon_status_word(j.status, 'fr')),
             format('Job %s is « %s » without its time: tell the person in charge of the app.', j.number, public.recon_status_word(j.status, 'en')),
             jsonb_build_object('job', j.number, 'status', j.status)
      from public.jobs j
      where j.deleted_at is null and ((j.status = 'done' and j.finished_at is null) or (j.status = 'on_site' and j.arrived_at is null)
         or (j.status = 'en_route' and j.started_at is null) or (j.status in ('cancelled', 'no_show') and j.cancelled_at is null))
      union all
      select 'D1.trips', 'warn', 'staff', t.staff_id, null,
             format('%s a %s trajets en cours en même temps : termine ceux qui sont finis (« Je suis arrivé » ou « Annuler »).', coalesce(public.recon_staff_name(t.staff_id), '?'), count(*)),
             format('%s has %s trips under way at the same time: end the ones that are over (« I have arrived » or « Cancel »).', coalesce(public.recon_staff_name(t.staff_id), '?'), count(*)),
             jsonb_build_object('n', count(*), 'trips', jsonb_agg(t.id order by t.started_at))
      from public.trips t where t.status = 'active' and t.deleted_at is null and t.staff_id is not null
      group by t.staff_id having count(*) > 1
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('D1', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('D1', sqlerrm);
  end;

  -- ══════ D2: the coming days ══════
  begin
    perform public.recon_trip('D2');
    v_t := clock_timestamp();
    with c as (select j.* from public.jobs j where j.deleted_at is null and j.day >= v_today and j.status in ('booked', 'en_route', 'on_site'))
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'D2.order' c, 'warn' s, 'trucks' t, c.truck_id e, c.day || '|' || c.block || '|' || c.stop_order k,
             format('Le %s, %s jobs du camion « %s » ont le même numéro d’arrêt (%s) : ouvre la journée pour la replanifier.', c.day, count(*),
                    coalesce((select tr.name from public.trucks tr where tr.id = c.truck_id), '?'), c.stop_order) fr,
             format('On %s, %s jobs of truck « %s » have the same stop number (%s): open the day to plan it again.', c.day, count(*),
                    coalesce((select tr.name from public.trucks tr where tr.id = c.truck_id), '?'), c.stop_order) en,
             jsonb_build_object('day', c.day, 'block', c.block, 'order', c.stop_order, 'jobs', jsonb_agg(c.id)) d
      from c where c.truck_id is not null and c.stop_order is not null group by c.truck_id, c.day, c.block, c.stop_order having count(*) > 1
      union all
      select 'D2.window', 'warn', 'jobs', c.id, null,
             format('La job %s du %s est promise entre %s et %s, mais le plan arrive à %s : appelle le client ou change l’ordre des arrêts.', c.number, c.day,
                    public.recon_hhmm(c.win_start, 'fr'), public.recon_hhmm(c.win_end, 'fr'), public.recon_hhmm(c.eta_min, 'fr')),
             format('Job %s of %s is promised between %s and %s, but the plan arrives at %s: call the customer or change the order of the stops.', c.number, c.day,
                    public.recon_hhmm(c.win_start, 'en'), public.recon_hhmm(c.win_end, 'en'), public.recon_hhmm(c.eta_min, 'en')),
             jsonb_build_object('job', c.number, 'day', c.day, 'win_start', c.win_start, 'win_end', c.win_end, 'eta', c.eta_min)
      from c where c.status = 'booked' and c.win_start is not null and c.truck_id is not null and c.eta_min is not null
        and not c.forced and c.manual_order is null and c.eta_min > c.win_end
      union all
      select 'D2.mix', 'warn', null, null, c.day::text,
             format('Le %s mélange des jobs « journée » (plages d’arrivée) et des jobs par bloc : ouvre la journée et vérifie les rendez-vous.', c.day),
             format('%s mixes « whole day » jobs (arrival windows) and block jobs: open the day and check the appointments.', c.day),
             jsonb_build_object('day', c.day)
      from c group by c.day having bool_or(c.block = 'day') and bool_or(c.block <> 'day')
      union all
      select 'D2.machine', 'warn', 'jobs', c.id, null,
             format('La job %s du %s a besoin de la machine à pneus, mais elle est sur « %s », qui ne l’a pas : déplace-la sur le camion.', c.number, c.day, tr.name),
             format('Job %s of %s needs the tire machine, but it is on « %s », which does not have it: move it to the truck.', c.number, c.day, tr.name),
             jsonb_build_object('job', c.number, 'day', c.day, 'truck_id', tr.id)
      from c join public.trucks tr on tr.id = c.truck_id where c.needs_machine and not tr.tire_machine
      union all
      select 'D2.unplaced', 'info', null, null, 'count',
             format('%s rendez-vous à venir sont « À placer » (sans camion) : ouvre l’agenda pour leur trouver une place.', count(*)),
             format('%s coming appointments are « To place » (no truck): open the agenda to find them a place.', count(*)),
             jsonb_build_object('n', count(*), 'first_day', min(c.day))
      from c where c.status = 'booked' and c.truck_id is null having count(*) > 0
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('D2', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('D2', sqlerrm);
  end;

  -- ══════ D3: the car and the invoice belong to the job's customer ══════
  begin
    perform public.recon_trip('D3');
    v_t := clock_timestamp();
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'D3.car' c, 'warn' s, 'jobs' t, j.id e, null::text k,
             format('La voiture de la job %s du %s est au dossier d’un autre client : ouvre la job et choisis la bonne voiture.', j.number, j.day) fr,
             format('The car of job %s of %s is on another customer''s file: open the job and pick the right car.', j.number, j.day) en,
             jsonb_build_object('job', j.number, 'day', j.day, 'vehicle_id', j.vehicle_id) d
      from public.jobs j join public.vehicles w on w.id = j.vehicle_id
      where j.deleted_at is null and j.status in ('booked', 'en_route', 'on_site') and w.customer_id is distinct from j.customer_id
      union all
      select 'D3.invoice', 'warn', 'invoices', i.id, null,
             format('La facture %s (job %s) est au nom d’un autre client que la job : vérifie le client de la facture.', public.recon_inv_no(i.number), j.number),
             format('Invoice %s (job %s) is in the name of another customer than the job: check the invoice''s customer.', public.recon_inv_no(i.number, 'en'), j.number),
             jsonb_build_object('number', i.number, 'job_id', j.id)
      from public.invoices i join public.jobs j on j.id = i.job_id
      where i.deleted_at is null and i.status <> 'void' and i.customer_id is distinct from j.customer_id
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('D3', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('D3', sqlerrm);
  end;

  -- ══════ D4: doubles (info only) ══════
  begin
    perform public.recon_trip('D4');
    v_t := clock_timestamp();
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'D4.phone' c, 'info' s, 'customers' t, (array_agg(c.id order by c.created_at desc, c.id))[1] e, c.phone_digits k,
             format('%s dossiers de clients ont le même numéro de téléphone (%s) : si c’est la même personne, garde un seul dossier.', count(*), max(c.phone)) fr,
             format('%s customer files have the same phone number (%s): if it is the same person, keep one file.', count(*), max(c.phone)) en,
             jsonb_build_object('n', count(*), 'customers', jsonb_agg(c.id)) d
      from public.customers c where c.deleted_at is null and length(coalesce(c.phone_digits, '')) >= 7
      group by c.phone_digits having count(*) > 1
      union all
      select 'D4.vin', 'info', 'vehicles', (array_agg(w.id order by w.created_at desc, w.id))[1], upper(trim(w.vin)),
             format('Le NIV %s est sur %s voitures : si c’est la même auto, garde une seule fiche.', upper(trim(w.vin)), count(*)),
             format('VIN %s is on %s cars: if it is the same car, keep one file.', upper(trim(w.vin)), count(*)),
             jsonb_build_object('n', count(*), 'vehicles', jsonb_agg(w.id))
      from public.vehicles w where w.deleted_at is null and length(trim(coalesce(w.vin, ''))) >= 11
      group by upper(trim(w.vin)) having count(*) > 1
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('D4', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('D4', sqlerrm);
  end;

  -- ══════ S1: stock on hand = the sum of its moves (against the baseline: only a CHANGE is said) ══════
  begin
    perform public.recon_trip('S1');
    v_t := clock_timestamp();
    if not v_base_set then
      -- the very first run: the differences of today become the baseline, nothing is said
      select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'value', x.diff)), '[]'::jsonb) into v_baseline
      from (select i.id, i.qty - coalesce(sum(m.delta) filter (where m.deleted_at is null), 0) as diff
            from public.inventory_items i left join public.inventory_moves m on m.item_id = i.id
            where i.deleted_at is null group by i.id, i.qty) x
      where x.diff <> 0;
    else
      select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
        select 'S1.drift' c, 'bad' s, 'inventory_items' t, x.id e, null::text k,
               format('Le stock de « %s » dit %s %s, mais ses entrées et sorties donnent %s : une quantité a été changée sans entrée de stock. Compte l’article, puis dis-le au responsable de l’app.',
                      x.name, trim_scale(x.qty), x.unit, trim_scale(x.qty - x.diff + x.base)) fr,
               format('The stock of « %s » says %s %s, but its entries and exits give %s: a quantity was changed without a stock entry. Count the item, then tell the person in charge of the app.',
                      x.name, trim_scale(x.qty), x.unit, trim_scale(x.qty - x.diff + x.base)) en,
               jsonb_build_object('qty', x.qty, 'moves', x.qty - x.diff, 'diff', x.diff, 'baseline', x.base, 'pool', x.pool) d
        from (select i.id, i.name, i.unit, i.pool, i.qty, i.qty - coalesce(sum(m.delta) filter (where m.deleted_at is null), 0) as diff, coalesce(b.value, 0) as base
              from public.inventory_items i left join public.inventory_moves m on m.item_id = i.id
              left join public.ops_recon_baseline b on b.check_id = 'S1' and b.entity_id = i.id
              where i.deleted_at is null group by i.id, i.name, i.unit, i.pool, i.qty, b.value) x
        where x.diff <> x.base
      ) f;
      v_all := v_all || v_part;
    end if;
    v_ms := v_ms || jsonb_build_object('S1', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('S1', sqlerrm);
  end;

  -- ══════ S2: negative stock; a stock item sold on a finished job and never taken out ══════
  begin
    perform public.recon_trip('S2');
    v_t := clock_timestamp();
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_part from (
      select 'S2.negative' c, 'warn' s, 'inventory_items' t, i.id e, null::text k,
             format('Le stock de « %s » est sous zéro (%s %s) : compte l’article et corrige avec « Compter ».', i.name, trim_scale(i.qty), i.unit) fr,
             format('The stock of « %s » is below zero (%s %s): count the item and fix it with « Count ».', i.name, trim_scale(i.qty), i.unit) en,
             jsonb_build_object('qty', i.qty, 'pool', i.pool) d
      from public.inventory_items i where i.deleted_at is null and i.active and i.qty < 0
      union all
      select 'S2.unused', 'warn', 'jobs', j.id, null,
             format('La job %s du %s a vendu %s du stock, mais rien n’est sorti du stock : vérifie les pièces utilisées et corrige le stock.', j.number, j.day, x.names),
             format('Job %s of %s sold %s from the stock, but nothing left the stock: check the parts used and fix the stock.', j.number, j.day, x.names),
             jsonb_build_object('job', j.number, 'day', j.day, 'items', x.items)
      from public.jobs j
      join (select i.job_id, string_agg(distinct it.name, ', ') as names, jsonb_agg(distinct i.item_id) as items
            from public.job_items i join public.inventory_items it on it.id = i.item_id and it.deleted_at is null
            where i.deleted_at is null and i.item_id is not null and i.status in ('planned', 'done', 'approved')
            group by i.job_id) x on x.job_id = j.id
      left join (select distinct m.job_id from public.inventory_moves m where m.reason = 'used' and m.deleted_at is null and m.job_id is not null) u on u.job_id = j.id
      where j.deleted_at is null and j.status = 'done' and j.finished_at >= now() - interval '14 days' and u.job_id is null
    ) f;
    v_all := v_all || v_part;
    v_ms := v_ms || jsonb_build_object('S2', round(extract(epoch from clock_timestamp() - v_t) * 1000)::int);
  exception when others then v_all := v_all || public.recon_error('S2', sqlerrm);
  end;

  -- the day's sheet, in the same snapshot
  begin
    perform public.recon_trip('sheet');
    v_t := clock_timestamp();
    v_sheet := public.recon_sheet(p_day);
  exception when others then
    v_sheet := '{}'::jsonb;
    v_all := v_all || public.recon_error('M0', sqlerrm);
  end;

  return jsonb_build_object('findings', v_all, 'sheet', v_sheet, 'ms', v_ms) || case when v_baseline is not null then jsonb_build_object('baseline', v_baseline) else '{}'::jsonb end;
end $$;

-- ───────────────────────────── counts and status of a run ─────────────────────────────
-- counts = { bad, warn, info, acked, limited: { bad, warn, info, acked, new, closed, errors, seen } } over the differences not closed
-- (limited = the money and stock ones, what « Trésorerie » sees) plus what the run itself noted (new, closed, errors, seen,
-- checks_ms, ms). Status: bad when an open
-- difference is bad, warn when one is warn, else ok (« tout balance »). A difference seen (« vu ») no longer colours the day.
create or replace function public.recon_tally(p_run uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_counts jsonb; v_status text;
begin
  select jsonb_build_object(
    'bad', count(*) filter (where state = 'open' and severity = 'bad'),
    'warn', count(*) filter (where state = 'open' and severity = 'warn'),
    'info', count(*) filter (where state = 'open' and severity = 'info'),
    'acked', count(*) filter (where state = 'acked'),
    'limited', jsonb_build_object(
      'bad', count(*) filter (where state = 'open' and severity = 'bad' and public.recon_for_treasury(check_id)),
      'warn', count(*) filter (where state = 'open' and severity = 'warn' and public.recon_for_treasury(check_id)),
      'info', count(*) filter (where state = 'open' and severity = 'info' and public.recon_for_treasury(check_id)),
      'acked', count(*) filter (where state = 'acked' and public.recon_for_treasury(check_id))))
  into v_counts
  from public.ops_recon_findings where state <> 'closed';
  v_status := case when (v_counts->>'bad')::int > 0 then 'bad' when (v_counts->>'warn')::int > 0 then 'warn' else 'ok' end;
  -- « limited » is merged, not replaced: it also holds what the run noted for « Trésorerie » (new, closed, errors, seen)
  update public.ops_recon_runs
     set counts = counts || (v_counts - 'limited') || jsonb_build_object('limited', coalesce(counts->'limited', '{}'::jsonb) || (v_counts->'limited')),
         status = v_status
   where id = p_run;
  return (select jsonb_build_object('status', r.status, 'counts', r.counts) from public.ops_recon_runs r where r.id = p_run);
end $$;

-- what one person sees of the counts and the status (« Trésorerie »: the limited ones)
create or replace function public.recon_view_counts(p_counts jsonb, p_full boolean) returns jsonb language sql immutable set search_path = public as $$
  select case when p_full or p_counts->'limited' is null then p_counts
              else (p_counts - 'limited') || (p_counts->'limited') end
$$;
create or replace function public.recon_view_status(p_status text, p_counts jsonb, p_full boolean) returns text language sql immutable set search_path = public as $$
  select case when p_full or p_counts->'limited' is null then p_status
              when coalesce((p_counts #>> '{limited,bad}')::int, 0) > 0 then 'bad'
              when coalesce((p_counts #>> '{limited,warn}')::int, 0) > 0 then 'warn' else 'ok' end
$$;

-- ───────────────────────────── recon_run: service only ─────────────────────────────
create or replace function public.recon_run(p_day date default public.local_today() - 1, p_source text default 'manual') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_day date := coalesce(p_day, public.local_today() - 1);
  v_t0 timestamptz := clock_timestamp();
  v jsonb; v_run uuid; v_new int; v_closed int; v_errors int; v_t jsonb;
  v_new_l int; v_closed_l int; v_errors_l int; v_seen int; v_seen_l int;
  v_failed text[];    -- the check families that threw this time (« M2 » for « M2.error »): their differences are left as they were
  v_mark date;        -- the day written on what is seen (first_day / last_day)
begin
  -- one run at a time (the cron, the backup and « Vérifier maintenant » may meet); recon_ack and recon_add take the same
  -- lock first, so the three always lock in the same order (the lock, the run row, the findings) and never deadlock
  perform pg_advisory_xact_lock(hashtext('garage.recon_run'));
  v := public.recon_collect(v_day);     -- ONE query: every check sees the same snapshot
  -- the checks read the books AS THEY ARE NOW: running an old day again never dates a difference back before the newest
  -- day already reconciled
  v_mark := greatest(v_day, coalesce((select max(r.day) from public.ops_recon_runs r), v_day));

  delete from public.ops_recon_runs where day = v_day;     -- running a day again replaces that day's run
  insert into public.ops_recon_runs (day, source, started_at, sheet)
  values (v_day, left(coalesce(nullif(trim(p_source), ''), 'manual'), 40), v_t0, coalesce(v->'sheet', '{}'::jsonb))
  returning id into v_run;

  -- S1, the very first run: the baseline
  if v ? 'baseline' then
    insert into public.ops_recon_baseline (check_id, entity_id, value, set_on)
    select 'S1', (b->>'id')::uuid, (b->>'value')::numeric, v_day from jsonb_array_elements(v->'baseline') b
    on conflict (check_id, entity_id) do nothing;
    insert into public.ops_recon_baseline (check_id, entity_id, value, set_on)
    values ('S1', '00000000-0000-0000-0000-000000000000', 0, v_day) on conflict (check_id, entity_id) do nothing;
  end if;

  create temp table if not exists recon_seen (key text primary key, c text, s text, t text, e uuid, fr text, en text, d jsonb) on commit drop;
  truncate recon_seen;
  insert into recon_seen
  select distinct on (key) key, c, s, t, e, fr, en, coalesce(d, '{}'::jsonb)
  from (select x.*, x.c || ':' || coalesce(x.e::text, '') || coalesce(':' || x.k, '') as key
        from jsonb_to_recordset(coalesce(v->'findings', '[]'::jsonb)) as x(c text, s text, t text, e uuid, k text, fr text, en text, d jsonb)) y
  order by key;

  select count(*), count(*) filter (where public.recon_for_treasury(n.c)) into v_new, v_new_l from recon_seen n
  where not exists (select 1 from public.ops_recon_findings f where f.key = n.key and f.state <> 'closed');
  select count(*), count(*) filter (where public.recon_for_treasury(c)),
         count(*) filter (where c like '%.error'), count(*) filter (where c like '%.error' and public.recon_for_treasury(c)),
         coalesce(array_agg(distinct split_part(c, '.', 1)) filter (where c like '%.error'), '{}')
    into v_seen, v_seen_l, v_errors, v_errors_l, v_failed
    from recon_seen;

  -- seen again: the same row (last_day moves, first_day stays); closed before: open again from this day; « vu » stays while
  -- the words stay the same (an « info » never opens again for new words: it never colours the day, its count just moves)
  insert into public.ops_recon_findings as f (key, check_id, severity, entity_table, entity_id, message_fr, message_en, data, first_day, last_day, last_run)
  select key, c, s, t, e, fr, en, d, v_mark, v_mark, v_run from recon_seen
  on conflict (key) do update set
    check_id = excluded.check_id, severity = excluded.severity, entity_table = excluded.entity_table, entity_id = excluded.entity_id,
    data = excluded.data, last_run = excluded.last_run, outside = false, updated_at = now(), closed_at = null,
    first_day = case when f.state = 'closed' then excluded.first_day else f.first_day end,
    last_day = case when f.state = 'closed' then excluded.last_day else greatest(f.last_day, excluded.last_day) end,
    state = case when f.state = 'closed' then 'open'
                 when f.state = 'acked' and (f.severity is distinct from excluded.severity
                                             or (excluded.severity <> 'info' and f.message_fr is distinct from excluded.message_fr)) then 'open'
                 else f.state end,
    acked_by = case when f.state = 'closed' or f.severity is distinct from excluded.severity
                         or (excluded.severity <> 'info' and f.message_fr is distinct from excluded.message_fr) then null else f.acked_by end,
    acked_at = case when f.state = 'closed' or f.severity is distinct from excluded.severity
                         or (excluded.severity <> 'info' and f.message_fr is distinct from excluded.message_fr) then null else f.acked_at end,
    message_fr = excluded.message_fr, message_en = excluded.message_en;

  -- no longer true: closed by itself. A check made outside (recon_add) closes when it was not added again for a day.
  -- A family that threw this time was NOT checked: its differences stay as they were (open or « vu »), never closed as if
  -- the books were repaired.
  with c as (
    update public.ops_recon_findings f set state = 'closed', closed_at = now(), updated_at = now()
    where f.state <> 'closed'
      and ((not f.outside and f.last_run is distinct from v_run and split_part(f.check_id, '.', 1) <> all (v_failed))
           or (f.outside and f.last_day < v_day - 1))
    returning f.check_id)
  select count(*), count(*) filter (where public.recon_for_treasury(c.check_id)) into v_closed, v_closed_l from c;

  update public.ops_recon_runs set finished_at = clock_timestamp(),
    counts = jsonb_build_object('new', v_new, 'closed', v_closed, 'errors', v_errors, 'seen', v_seen, 'checks_ms', coalesce(v->'ms', '{}'::jsonb),
                                'ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000)::int,
                                'limited', jsonb_build_object('new', v_new_l, 'closed', v_closed_l, 'errors', v_errors_l, 'seen', v_seen_l))
  where id = v_run;
  v_t := public.recon_tally(v_run);
  return jsonb_build_object('run_id', v_run, 'day', v_day, 'status', v_t->>'status', 'counts', v_t->'counts');
end $$;

-- ───────────────────────────── recon_add: service only (the checks that need the outside) ─────────────────────────────
-- p_data->>'sig' tells apart two findings of one check on the same entity (or on none). Answer: the finding's id.
create or replace function public.recon_add(p_run uuid, p_check text, p_severity text, p_entity_table text, p_entity_id uuid,
  p_message_fr text, p_message_en text, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.ops_recon_runs; v_key text; v_id uuid;
begin
  -- the lock of recon_run first: its run cannot be replaced under it, and the lock order stays the same (no deadlock)
  perform pg_advisory_xact_lock(hashtext('garage.recon_run'));
  select * into r from public.ops_recon_runs where id = p_run;
  if not found then perform public.fail('not_found', 'Ce rapprochement n’existe plus.'); end if;
  if coalesce(trim(p_check), '') = '' or p_severity is null or p_severity not in ('bad', 'warn', 'info') or coalesce(trim(p_message_fr), '') = '' then
    perform public.fail('bad_finding', 'Une différence a besoin d’une vérification, d’une gravité (bad, warn, info) et d’un message.');
  end if;
  v_key := trim(p_check) || ':' || coalesce(p_entity_id::text, '') || coalesce(':' || nullif(p_data->>'sig', ''), '');
  insert into public.ops_recon_findings as f (key, check_id, severity, entity_table, entity_id, message_fr, message_en, data, first_day, last_day, outside, last_run)
  values (v_key, trim(p_check), p_severity, p_entity_table, p_entity_id, left(p_message_fr, 1000), left(coalesce(nullif(trim(p_message_en), ''), p_message_fr), 1000),
          coalesce(p_data, '{}'::jsonb), r.day, r.day, true, p_run)
  on conflict (key) do update set
    severity = excluded.severity, entity_table = excluded.entity_table, entity_id = excluded.entity_id, data = excluded.data,
    last_run = excluded.last_run, outside = true, updated_at = now(), closed_at = null,
    first_day = case when f.state = 'closed' then excluded.first_day else f.first_day end,
    last_day = case when f.state = 'closed' then excluded.last_day else greatest(f.last_day, excluded.last_day) end,
    state = case when f.state = 'closed' then 'open'
                 when f.state = 'acked' and (f.severity is distinct from excluded.severity
                                             or (excluded.severity <> 'info' and f.message_fr is distinct from excluded.message_fr)) then 'open'
                 else f.state end,
    acked_by = case when f.state = 'closed' or f.severity is distinct from excluded.severity
                         or (excluded.severity <> 'info' and f.message_fr is distinct from excluded.message_fr) then null else f.acked_by end,
    acked_at = case when f.state = 'closed' or f.severity is distinct from excluded.severity
                         or (excluded.severity <> 'info' and f.message_fr is distinct from excluded.message_fr) then null else f.acked_at end,
    message_fr = excluded.message_fr, message_en = excluded.message_en
  returning id into v_id;
  perform public.recon_tally(p_run);
  return v_id;
end $$;

-- ───────────────────────────── recon_summary: what the app shows ─────────────────────────────
-- { ok, can_ack, last_run: { day, status, finished_at, counts, sheet } | null, runs: [{ day, status, finished_at, counts }] newest first,
--   findings: [{ id, check_id, severity, entity_table, entity_id, message_fr, message_en, first_day, last_day, state, note }] }
create or replace function public.recon_summary(p_days int default 14) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner boolean := public.is_owner();
  v_treasury boolean := public.can('treasury');
  v_days int := least(greatest(coalesce(p_days, 14), 1), 92);
  v_last jsonb;
begin
  if not (v_owner or v_treasury) then
    perform public.fail('not_allowed', 'Le rapprochement est pour le propriétaire et la Trésorerie.');
  end if;
  select jsonb_build_object('day', r.day, 'status', public.recon_view_status(r.status, r.counts, v_owner), 'finished_at', r.finished_at,
                            'counts', public.recon_view_counts(r.counts, v_owner), 'sheet', r.sheet)
  into v_last
  from public.ops_recon_runs r where r.finished_at is not null order by r.day desc limit 1;
  return jsonb_build_object(
    'ok', true,
    'can_ack', v_owner or v_treasury,
    'last_run', v_last,
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('day', r.day, 'status', public.recon_view_status(r.status, r.counts, v_owner),
                                                          'finished_at', r.finished_at, 'counts', public.recon_view_counts(r.counts, v_owner)) order by r.day desc), '[]'::jsonb)
             from (select * from public.ops_recon_runs where finished_at is not null order by day desc limit v_days) r),
    'findings', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'check_id', f.check_id, 'severity', f.severity, 'entity_table', f.entity_table,
                                    'entity_id', f.entity_id, 'message_fr', f.message_fr, 'message_en', f.message_en, 'first_day', f.first_day,
                                    'last_day', f.last_day, 'state', f.state, 'note', f.note) order by f.ord1, f.ord2, f.last_day desc, f.check_id, f.key), '[]'::jsonb)
                 from (select x.*, case when x.state = 'closed' then 1 else 0 end as ord1,
                              case x.severity when 'bad' then 0 when 'warn' then 1 else 2 end as ord2
                       from public.ops_recon_findings x
                       where (v_owner or public.recon_for_treasury(x.check_id))
                         and (x.state <> 'closed' or x.closed_at >= now() - make_interval(days => v_days))
                       order by (x.state = 'closed'), x.updated_at desc limit 500) f));
end $$;

-- ───────────────────────────── recon_ack: « vu » ─────────────────────────────
-- The owner, or « Trésorerie » for the money and stock differences. The note says why it is fine (optional). A difference
-- already closed keeps its state (only the note changes). Answer: the summary, as recon_summary() gives it.
create or replace function public.recon_ack(p_finding uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f public.ops_recon_findings; v_owner boolean := public.is_owner(); v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
begin
  if not (v_owner or public.can('treasury')) then
    perform public.fail('not_allowed', 'Le rapprochement est pour le propriétaire et la Trésorerie.');
  end if;
  -- the lock of recon_run first (then the finding, then the run row): the same order as recon_run, so « vu » and a run
  -- that meet wait for each other instead of deadlocking (Postgres would abort one of them, maybe the nightly run)
  perform pg_advisory_xact_lock(hashtext('garage.recon_run'));
  select * into f from public.ops_recon_findings where id = p_finding for update;
  if not found or not (v_owner or public.recon_for_treasury(f.check_id)) then
    perform public.fail('not_found', 'Cette différence n’existe plus.');
  end if;
  update public.ops_recon_findings set
    state = case when state = 'open' then 'acked' else state end,
    acked_by = case when state = 'closed' then acked_by else auth.uid() end,
    acked_at = case when state = 'closed' then acked_at else now() end,
    note = coalesce(v_note, note), updated_at = now()
  where id = f.id;
  insert into public.activity (actor, entity, entity_id, action, data)
  values (auth.uid(), 'recon', f.id, 'recon_ack', jsonb_build_object('check', f.check_id, 'key', f.key, 'note', v_note));
  -- the run of that day (and the last one) follow: a difference « vu » no longer colours the day
  perform public.recon_tally(r.id) from public.ops_recon_runs r where r.day = (select max(day) from public.ops_recon_runs);
  return public.recon_summary(14);
end $$;

-- ───────────────────────────── recon_now: « Vérifier maintenant » ─────────────────────────────
-- Yesterday and today so far, at most once a minute for the whole garage (rate_hit); braked, it answers the summary as it is.
create or replace function public.recon_now() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_owner() or public.can('treasury')) then
    perform public.fail('not_allowed', 'Le rapprochement est pour le propriétaire et la Trésorerie.');
  end if;
  if public.rate_hit('recon_now', 60, 1) then
    perform public.recon_run(public.local_today() - 1, 'button');
    perform public.recon_run(public.local_today(), 'button');
  end if;
  return public.recon_summary(14);
end $$;

-- ───────────────────────────── rights ─────────────────────────────
-- the app calls recon_summary, recon_ack, recon_now (each checks the person inside); everything else is the server's own
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array['recon_money_fr', 'recon_money_en', 'recon_inv_no', 'recon_staff_name', 'recon_status_word',
      'recon_method_word', 'recon_hhmm', 'recon_for_treasury', 'recon_trip', 'recon_error', 'recon_sheet', 'recon_collect', 'recon_tally',
      'recon_view_counts', 'recon_view_status', 'recon_run', 'recon_add', 'recon_summary', 'recon_ack', 'recon_now'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname in ('recon_summary', 'recon_ack', 'recon_now') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

-- every morning at 07:40 UTC (02:40 or 03:40 in Montréal), when the database offers scheduled jobs: yesterday's reconciliation.
-- The nightly backup job is the second trigger (its server function calls recon_run before it downloads).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('garage-recon', '40 7 * * *', $cron$select public.recon_run(public.local_today() - 1, 'cron')$cron$);
  end if;
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;
