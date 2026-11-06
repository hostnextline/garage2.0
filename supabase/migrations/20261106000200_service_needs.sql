-- Part 16: what a service takes that depends on the car (its oil, its filters, new tires by its size…), for
-- « Besoins de la semaine » (Inventaire). null: guessed by the app from the service's name; []: nothing.
alter table public.services add column if not exists needs jsonb
  constraint services_needs_array check (needs is null or jsonb_typeof(needs) = 'array');
