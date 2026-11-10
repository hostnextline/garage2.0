-- Part 24 octies: 🤖 Hermes, the team's assistant (function « hermes »): every question is kept, with its answer.
--   Each person sees only their own conversation in the app; the owner alone reads everyone's questions
--   (« Questions de l'équipe » in Hermes), through the function. No policy: only the server (service role) writes and reads.
create table if not exists public.hermes_questions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  session text,
  question text not null,
  answer text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists hermes_questions_at on public.hermes_questions (created_at desc);
create index if not exists hermes_questions_staff on public.hermes_questions (staff_id, created_at desc);
alter table public.hermes_questions enable row level security;
revoke all on public.hermes_questions from public, anon, authenticated;
