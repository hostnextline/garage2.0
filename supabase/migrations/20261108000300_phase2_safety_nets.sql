-- Part 26: phase 2 of the audit of 2026-11-08 — safety nets and hygiene.
--   default privileges   a function made from now on is closed to the app (anon, authenticated) and to everyone (PUBLIC)
--                        until a migration opens it. Postgres gives EXECUTE to PUBLIC by default, and a per-schema default
--                        only ADDS to that: the revoke has to be global for the role that makes the functions (postgres).
--                        Before: a function without a word about rights was callable by anyone signed in (jobs_waiver_via,
--                        a trigger, was in that state; closed here)
--   coffre_may_add       « Payé par le Coffre » is for every member of the team (Part 22 kept it to the owner and the
--                        mechanic of the job's truck; the office takes those payments too)
--   coffre_add           written out in full (Part 22 patched its text with replace(); a text patch cannot be replayed)
--   app_errors           the phones tell the server when the app breaks (report_error: 20 an hour per person, the same
--                        error counted once an hour; kept 90 days). The owner reads them with SQL or the connector.
--   heartbeats, health() when the last backup ran (written by the backup function), the newest migration applied; read
--                        by the ping of GitHub every 6 hours and by the publishing workflow before it publishes the app
--   housekeeping         prunes app_errors after 90 days

-- ---------- closed by default ----------
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
revoke execute on function public.jobs_waiver_via() from public, anon, authenticated;

-- ---------- the Coffre: every member of the team may put jobs in it ----------
create or replace function public.coffre_may_add(p_jobs uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() and cardinality(coalesce(p_jobs, '{}')) > 0
$$;
revoke all on function public.coffre_may_add(uuid[]) from public, anon;
grant execute on function public.coffre_may_add(uuid[]) to authenticated, service_role;

-- ---------- coffre_add, whole (Part 20 + Part 22 + everyone) ----------
create or replace function public.coffre_add(p_op uuid, p_jobs uuid[], p_amount int, p_note text default null, p_day date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb := public.op_done(p_op);
  v_id uuid := gen_random_uuid(); j record; v_cust uuid; v_value int := 0; v_nums bigint[] := '{}'; v_ids uuid[] := '{}'; inv record;
begin
  if v_done is not null then return v_done; end if;
  if not public.coffre_may_add(p_jobs) then perform public.fail('not_allowed', 'Connecte-toi avec ton compte de l’équipe pour mettre des jobs au Coffre.'); end if;
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
revoke all on function public.coffre_add(uuid, uuid[], int, text, date) from public, anon;
grant execute on function public.coffre_add(uuid, uuid[], int, text, date) to authenticated, service_role;

-- ---------- the app's errors ----------
create table if not exists public.app_errors (
  id bigserial primary key,
  at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  n int not null default 1,                       -- the same error (person, version, message) within an hour counts here
  who uuid,                                       -- the signed-in person (null: not known)
  version text,                                   -- the app's version (the commit) and page
  page text,
  message text not null,
  stack text,
  agent text                                      -- the phone's browser, shortened
);
alter table public.app_errors enable row level security;   -- no policy: read with SQL (owner) or the connector only
revoke all on table public.app_errors from public, anon, authenticated;
grant all on table public.app_errors to service_role;
create index if not exists app_errors_last_at on public.app_errors (last_at desc);

/* report_error(message, stack, page, version, agent): called by the app itself when something breaks (window error,
   unhandled promise, content-security-policy violation). Never raises (an error reporter that errors helps nobody):
   over the brake (20 an hour per person), or with nothing to say, it just returns false. */
create or replace function public.report_error(p_message text, p_stack text default null, p_page text default null, p_version text default null, p_agent text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_msg text := left(trim(coalesce(p_message, '')), 500); v_who uuid := auth.uid(); v_id bigint;
begin
  if v_msg = '' then return false; end if;
  if not public.rate_hit('err:' || coalesce(v_who::text, 'anon'), 3600, 20) then return false; end if;
  select id into v_id from public.app_errors
   where who is not distinct from v_who and message = v_msg and version is not distinct from left(p_version, 64) and last_at > now() - interval '1 hour'
   order by last_at desc limit 1;
  if v_id is not null then
    update public.app_errors set n = n + 1, last_at = now() where id = v_id;
  else
    insert into public.app_errors (who, version, page, message, stack, agent)
    values (v_who, left(p_version, 64), left(p_page, 200), v_msg, left(p_stack, 4000), left(p_agent, 200));
  end if;
  return true;
exception when others then
  return false;
end $$;
revoke all on function public.report_error(text, text, text, text, text) from public, anon;
grant execute on function public.report_error(text, text, text, text, text) to authenticated, service_role;

-- ---------- the server's pulse ----------
create table if not exists public.heartbeats (
  name text primary key,                          -- backup_started, backup_done
  at timestamptz not null default now(),
  note text
);
alter table public.heartbeats enable row level security;
revoke all on table public.heartbeats from public, anon, authenticated;
grant all on table public.heartbeats to service_role;

/* health(): what the outside may know to tell the garage something is wrong — the newest migration applied, when the
   last backup started and finished, the clock. Open to the public (the anon key is in every phone anyway): no data. */
create or replace function public.health() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_schema text;
begin
  -- the real project keeps its migrations in supabase_migrations; the local test copy in public.local_migrations
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select max(version) from supabase_migrations.schema_migrations' into v_schema;
  elsif to_regclass('public.local_migrations') is not null then
    execute 'select max(left(name, 14)) from public.local_migrations' into v_schema;
  end if;
  return jsonb_build_object(
    'ok', true,
    'now', now(),
    'schema', v_schema,
    'backup_started', (select at from public.heartbeats where name = 'backup_started'),
    'backup_done', (select at from public.heartbeats where name = 'backup_done'),
    'backup_rows', (select note from public.heartbeats where name = 'backup_done'));
end $$;
revoke all on function public.health() from public;
grant execute on function public.health() to anon, authenticated, service_role;

-- ---------- housekeeping: errors kept 90 days ----------
create or replace function public.housekeeping() returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select staff_id from public.shifts where ended_at is null and deleted_at is null and started_at < now() - interval '16 hours' loop
    perform public.close_day(r.staff_id);
  end loop;
  update public.trips set status = 'cancelled', ended_at = now() where status = 'active' and expires_at < now();
  delete from public.position_log where at < now() - interval '30 days';
  delete from public.op_log where at < now() - interval '60 days';
  delete from public.activity where at < now() - interval '24 months';
  delete from public.app_errors where last_at < now() - interval '90 days';
end $$;
revoke all on function public.housekeeping() from public, anon, authenticated;
grant execute on function public.housekeeping() to service_role;
