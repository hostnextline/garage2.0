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
