-- Part 24 quaterdecies: « Appel entrant » from GoHighLevel.
-- A call that comes in on the garage's GoHighLevel number is told to the server function « ring » (a GoHighLevel
-- automation: inbound call → webhook), which notes it here; the owner's app shows « Appel entrant » with the number and the
-- contact's name. Only the server writes (service role); only the owner reads. Not backed up (worth nothing the day after).
create table if not exists public.incoming_calls (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  name text,
  at timestamptz not null default now()
);
create index if not exists incoming_calls_at on public.incoming_calls (at desc);
alter table public.incoming_calls enable row level security;
drop policy if exists incoming_calls_owner on public.incoming_calls;
create policy incoming_calls_owner on public.incoming_calls for select to authenticated using (public.is_owner());
revoke all on public.incoming_calls from public, anon, authenticated;
grant select on public.incoming_calls to authenticated;
grant all on public.incoming_calls to service_role;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'incoming_calls') then
    alter publication supabase_realtime add table public.incoming_calls;
  end if;
end $$;
