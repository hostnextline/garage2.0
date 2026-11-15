-- Part 26: « Notes d'appels ».
-- The garage's phone calls go through GoHighLevel, which records them. After a call the server function « calls » fetches
-- the recording, has it written down (OpenAI), and keeps a short note here: what the customer wanted, what the garage told
-- them, what is left to do. One row per call (GoHighLevel's message id). Only the server writes (service role); only an
-- owner reads. Backed up (the notes are worth keeping; the recordings themselves stay in GoHighLevel).
create table if not exists public.call_notes (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,            -- GoHighLevel's id of the call (a message of the conversation)
  conversation_id text,
  contact_id text,
  phone text,
  phone_digits text generated always as (nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')) stored,
  customer_id uuid references public.customers(id) on delete set null,
  dir text check (dir in ('in', 'out')),
  at timestamptz,                             -- when the call happened
  duration_sec int,
  status text not null default 'new' check (status in ('new', 'done', 'short', 'no_recording', 'failed')),
  summary text,                               -- what the customer wanted
  told text,                                  -- what the garage told them (prices, day, promises)
  todo text,                                  -- what is left to do
  lang text,
  transcript text,
  error text,
  tries int not null default 0,
  busy_until timestamptz,                     -- being written down right now (so two requests never pay for the same call)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists call_notes_customer on public.call_notes (customer_id, at desc);
create index if not exists call_notes_at on public.call_notes (at desc);
create index if not exists call_notes_digits on public.call_notes (phone_digits) where customer_id is null;
drop trigger if exists call_notes_touch on public.call_notes;
create trigger call_notes_touch before insert or update on public.call_notes for each row execute function public.touch();

-- whose call it is: the customer on file with that number (the newest file when two share it). Set when the row is made…
create or replace function public.call_notes_match() returns trigger language plpgsql security definer set search_path = public as $$
declare d text := nullif(right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10), '');
begin
  if new.customer_id is null and length(d) = 10 then
    select c.id into new.customer_id from public.customers c
     where c.phone_digits = d and c.deleted_at is null order by c.created_at desc limit 1;
  end if;
  return new;
end $$;
drop trigger if exists call_notes_match on public.call_notes;
create trigger call_notes_match before insert on public.call_notes for each row execute function public.call_notes_match();

-- …and when a file with that number appears later (a new customer made during or after the call, a number corrected)
create or replace function public.call_notes_follow() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null and length(new.phone_digits) = 10 then
    update public.call_notes n set customer_id = new.id where n.customer_id is null and n.phone_digits = new.phone_digits;
  end if;
  return null;
end $$;
drop trigger if exists customers_call_notes on public.customers;
create trigger customers_call_notes after insert or update of phone on public.customers for each row execute function public.call_notes_follow();

-- the same, asked by the server at each look at GoHighLevel (rows still without a file)
create or replace function public.call_notes_link() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.call_notes k set customer_id = (select c.id from public.customers c
      where c.phone_digits = k.phone_digits and c.deleted_at is null order by c.created_at desc limit 1)
   where k.customer_id is null and length(k.phone_digits) = 10
     and exists (select 1 from public.customers c where c.phone_digits = k.phone_digits and c.deleted_at is null);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.call_notes_match(), public.call_notes_follow(), public.call_notes_link() from public, anon, authenticated;
grant execute on function public.call_notes_link() to service_role;

alter table public.call_notes enable row level security;
drop policy if exists call_notes_owner on public.call_notes;
create policy call_notes_owner on public.call_notes for select to authenticated using (public.is_owner());
revoke all on public.call_notes from public, anon, authenticated;
grant select on public.call_notes to authenticated;
grant all on public.call_notes to service_role;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_notes') then
    alter publication supabase_realtime add table public.call_notes;
  end if;
end $$;
