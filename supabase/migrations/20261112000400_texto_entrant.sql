-- Part 24 quindecies: « Texto entrant » from GoHighLevel.
-- A text that comes in on the garage's GoHighLevel number is told to the server function « ring » (a GoHighLevel
-- automation: customer replied → webhook, the same address as the calls with « &t=sms »), which notes it here; the owner's
-- app opens a small conversation bubble with the number, the name and the words. Only the server writes (service role);
-- only an owner who asked for it on their own account reads (staff.prefs.texts = true, the switch « Recevoir les textos dans
-- mon compte » in Réglages → Branchements: the garage may have several owners, one of them takes the texts). Not backed up: the whole conversation stays in GoHighLevel, these rows only wake the bubble (a week kept).
create table if not exists public.incoming_texts (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  name text,
  body text not null default '',
  at timestamptz not null default now()
);
create index if not exists incoming_texts_at on public.incoming_texts (at desc);
alter table public.incoming_texts enable row level security;
drop policy if exists incoming_texts_owner on public.incoming_texts;
create policy incoming_texts_owner on public.incoming_texts for select to authenticated
  using (public.is_owner() and exists (select 1 from public.staff s where s.id = auth.uid() and s.prefs->>'texts' = 'true'));
revoke all on public.incoming_texts from public, anon, authenticated;
grant select on public.incoming_texts to authenticated;
grant all on public.incoming_texts to service_role;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'incoming_texts') then
    alter publication supabase_realtime add table public.incoming_texts;
  end if;
end $$;
