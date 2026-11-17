-- Part 26 — « Refonte », the nightly backup says « done ».
--
-- Until now nothing in the database knew whether last night's backup happened: a job that stops (GitHub refuses a file
-- that is too big, a ticket refused, the project paused) was seen only in GitHub's own e-mail. The backup job now ends by
-- calling the « backup » function with { action: 'done', tables, rows, commit } (the same GitHub ticket as its other
-- actions), which writes one row here. The daily reconciliation (function « recon ») reads it: the last good backup
-- must be younger than 26 hours.
--
-- No access from the app: row level security on, no policy, no grant (only the server functions, with the service
-- role). The table is part of the backup itself (the history of the nights and the commit of each one).

create table if not exists public.ops_backup_runs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),                    -- when the job said « done »
  tables int not null default 0 check (tables >= 0),        -- how many tables it wrote
  rows bigint not null default 0 check (rows >= 0),         -- how many rows in all
  commit text,                                              -- the commit of the private repository that holds this night
  ok boolean not null default true                          -- false: the job ran and says it failed
);
create index if not exists ops_backup_runs_at on public.ops_backup_runs (at desc);

alter table public.ops_backup_runs enable row level security;
revoke all on public.ops_backup_runs from public, anon, authenticated;
grant all on public.ops_backup_runs to service_role;

-- ───────────────────────────── the backup's heartbeat, in every reconciliation ─────────────────────────────
-- The age of the last good backup was checked only by the « recon » function, which only the nightly job calls, and only
-- after a night that went well: a night that fails, or a job that never starts, was seen by nobody, and the runs of the
-- schedule (pg_cron) and of « Vérifier maintenant » (recon_now) closed the warning a day later. Now every run of the
-- reconciliation (recon_run, whoever starts it) adds the same finding as the function: « backup_late » (bad, the owner's
-- only), with the same key and the same words, so the two never make two rows. It is a check made outside the books
-- (recon_add: it closes a day after it was last added, like the function's).
-- Armed once the backup job has reached the server (a « done » row, or the repository pin written by its first ticket):
-- a database with no backup set up yet (a test copy) says nothing; the function still says « never ».
create or replace function public.recon_backup_age(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_last record; v_hours numeric;
begin
  if not exists (select 1 from public.ops_backup_runs)
     and not exists (select 1 from public.secrets where key like 'backup_repo:%') then
    return;
  end if;
  select id, at into v_last from public.ops_backup_runs where ok order by at desc limit 1;
  if not found then
    perform public.recon_add(p_run, 'backup_late', 'bad', 'ops_backup_runs', null,
      'Aucune sauvegarde réussie n’est inscrite : la sauvegarde de nuit n’a jamais dit « terminé ».',
      'No successful backup is on record: the nightly backup never said “done”.', jsonb_build_object('last_at', null));
    return;
  end if;
  v_hours := round(extract(epoch from now() - v_last.at) / 360) / 10;
  if v_hours > 26 then
    perform public.recon_add(p_run, 'backup_late', 'bad', 'ops_backup_runs', v_last.id,
      format('La dernière sauvegarde réussie date de %s heures : elle devrait avoir moins de 26 heures.', floor(v_hours)),
      format('The last successful backup is %s hours old: it should be less than 26 hours old.', floor(v_hours)),
      jsonb_build_object('last_at', v_last.at, 'hours', v_hours));
  end if;
exception when others then
  -- never stops the reconciliation: said as a check that could not be made
  begin
    perform public.recon_add(p_run, 'backup_unknown', 'warn', 'ops_backup_runs', null, 'La dernière sauvegarde n’a pas pu être lue.',
      'The last backup could not be read.', jsonb_build_object('error', left(sqlerrm, 200)));
  exception when others then null;
  end;
end $$;
revoke all on function public.recon_backup_age(uuid) from public, anon, authenticated;
grant execute on function public.recon_backup_age(uuid) to service_role;

create or replace function public.ops_recon_runs_backup_age() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recon_backup_age(new.id);
  return null;
end $$;
revoke all on function public.ops_recon_runs_backup_age() from public, anon, authenticated;

-- the reconciliation's tables come with 20261116000400: a database without them yet gets the trigger later (this file again)
do $$
begin
  if to_regclass('public.ops_recon_runs') is not null and to_regclass('public.ops_recon_findings') is not null then
    drop trigger if exists ops_recon_runs_backup_age on public.ops_recon_runs;
    create trigger ops_recon_runs_backup_age after insert on public.ops_recon_runs
      for each row execute function public.ops_recon_runs_backup_age();
  end if;
end $$;
