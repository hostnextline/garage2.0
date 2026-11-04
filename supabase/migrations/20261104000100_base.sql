-- Mécanique Mobile H.I.S — V2, part 1: tables, team, rights.
-- Every synced table has: id (uuid, may come from the device so a repeat is harmless), created_at, updated_at (set by the
-- server, used to sync), deleted_at (soft delete: other devices learn about it), created_by.
-- Rights are checked HERE (row level security). The app only asks the server what a person may do.

create extension if not exists pgcrypto with schema extensions;

-- ---------- helpers ----------
create or replace function public.touch() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, clock_timestamp());
  else
    new.created_at := old.created_at;  -- never rewritten
  end if;
  return new;
end $$;

create or replace function public.local_now() returns timestamp language sql stable as $$
  select (now() at time zone 'America/Toronto')
$$;
create or replace function public.local_today() returns date language sql stable as $$
  select (now() at time zone 'America/Toronto')::date
$$;

-- ---------- settings (one row) ----------
create table public.settings (
  id int primary key default 1 check (id = 1),
  company jsonb not null default '{}'::jsonb,        -- name, legal_name, phone, email, address, website, tps_no, tvq_no, footer_fr, footer_en
  taxes jsonb not null default '{"enabled": true, "tps": 0.05, "tvq": 0.09975}'::jsonb,
  booking jsonb not null default '{}'::jsonb,        -- blocks, horizon_days, speed_kmh, stop_min, min_block_min, home {label,address,lat,lng}
  billing jsonb not null default '{}'::jsonb,        -- invoice_prefix, quote_prefix, due_days, hourly_cents, travel {cents, free_over_cents}, terms_fr/en
  messages jsonb not null default '{}'::jsonb,       -- sms on/off per kind, templates fr/en
  role_rights jsonb not null default '{}'::jsonb,    -- what each role gives at the start: {office:{book:true,…},…}
  waiver jsonb not null default '{}'::jsonb,         -- {version, fr, en}
  appearance jsonb not null default '{}'::jsonb,     -- team theme {theme, mode}
  maps jsonb not null default '{}'::jsonb,           -- public browser keys {provider, tomtom_key, google_key}, restricted to the site
  expense_categories jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
insert into public.settings (id) values (1) on conflict do nothing;
create trigger settings_touch before insert or update on public.settings for each row execute function public.touch();

-- ---------- team ----------
create table public.staff (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  short_name text,                                    -- the name shown on the agenda and the truck ("Saleh")
  email text,
  phone text,
  roles text[] not null default '{}' check (roles <@ array['owner','office','mechanic','treasurer']::text[] and cardinality(roles) >= 1),
  rights jsonb not null default '{}'::jsonb,          -- changes for THIS person only: {right: true|false}
  active boolean not null default true,
  color text,
  lang text not null default 'fr' check (lang in ('fr','en')),
  prefs jsonb not null default '{}'::jsonb,           -- theme, tour_done, install_done, guide_off… (only the person changes them)
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid
);
create trigger staff_touch before insert or update on public.staff for each row execute function public.touch();
create index staff_updated on public.staff(updated_at);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  short_name text,
  roles text[] not null check (roles <@ array['owner','office','mechanic','treasurer']::text[] and cardinality(roles) >= 1),
  rights jsonb not null default '{}'::jsonb,
  lang text not null default 'fr',
  token_hash text not null unique,
  kind text not null default 'invite' check (kind in ('invite','reset')),
  user_id uuid,                                       -- for a password reset: the account it is for
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

/* ---------- rights ----------
   For each (role, right): 'always' (comes with the role), 'can' (the owner may tick it), or nothing (never).
   The owner has every right. A person's own changes (staff.rights) win over what the role gives at the start
   (settings.role_rights), but can never give a right the role cannot have. */
create or replace function public.right_rule(p_role text, p_right text) returns text language sql immutable as $$
  select case p_right
    when 'agenda'        then case p_role when 'office' then 'always' when 'treasurer' then 'can' when 'mechanic' then 'can' end
    when 'book'          then case p_role when 'office' then 'can' when 'mechanic' then 'can' end
    when 'clients'       then case p_role when 'office' then 'can' when 'mechanic' then 'can' when 'treasurer' then 'can' end
    when 'invoices'      then case p_role when 'office' then 'can' when 'mechanic' then 'can' when 'treasurer' then 'can' end
    when 'edit_invoices' then case p_role when 'office' then 'can' when 'treasurer' then 'can' end
    when 'money'         then case p_role when 'office' then 'can' when 'mechanic' then 'can' when 'treasurer' then 'can' end
    when 'treasury'      then case p_role when 'treasurer' then 'always' when 'office' then 'can' when 'mechanic' then 'can' end
    when 'inventory'     then case p_role when 'office' then 'can' when 'mechanic' then 'can' when 'treasurer' then 'can' end
    when 'map'           then case p_role when 'office' then 'can' when 'mechanic' then 'can' when 'treasurer' then 'can' end
    when 'hours'         then case p_role when 'office' then 'can' when 'mechanic' then 'can' end
    when 'settings'      then case p_role when 'office' then 'can' end
  end
$$;
-- what each role gives at the start, when the owner has not changed it
create or replace function public.right_default(p_role text, p_right text) returns boolean language sql immutable as $$
  select case p_role
    when 'office'    then p_right = any(array['agenda','book','clients','invoices','edit_invoices','money','inventory','map','hours'])
    when 'mechanic'  then p_right = any(array['clients','invoices','inventory','map'])
    when 'treasurer' then p_right = any(array['treasury','clients','invoices','money','inventory','map'])
    else false end
$$;
create or replace function public.all_rights() returns text[] language sql immutable as $$
  select array['agenda','book','clients','invoices','edit_invoices','money','treasury','inventory','map','hours','settings']
$$;

create or replace function public.me() returns public.staff language sql stable security definer set search_path = public as $$
  select s from public.staff s where s.id = auth.uid() and s.active and s.deleted_at is null
$$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.id = auth.uid() and s.active and s.deleted_at is null)
$$;
create or replace function public.has_role(p_role text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.id = auth.uid() and s.active and s.deleted_at is null and p_role = any(s.roles))
$$;
create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('owner')
$$;

create or replace function public.right_of(p_staff public.staff, p_right text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  rr jsonb := (select role_rights from public.settings where id = 1);
  r text;
  allowed boolean := false;
  gives boolean := false;
begin
  if p_staff.id is null or not p_staff.active or p_staff.deleted_at is not null then return false; end if;
  if 'owner' = any(p_staff.roles) then return true; end if;
  foreach r in array p_staff.roles loop
    if public.right_rule(r, p_right) = 'always' then return true; end if;
    if public.right_rule(r, p_right) = 'can' then
      allowed := true;
      if coalesce((rr -> r ->> p_right)::boolean, public.right_default(r, p_right)) then gives := true; end if;
    end if;
  end loop;
  if not allowed then return false; end if;
  if p_staff.rights ? p_right then return coalesce((p_staff.rights ->> p_right)::boolean, false); end if;
  return gives;
end $$;

create or replace function public.can(p_right text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.right_of(s, p_right) from public.staff s where s.id = auth.uid()), false)
$$;

-- ---------- trucks and their hours ----------
create table public.trucks (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  driver_id uuid references public.staff(id) on delete set null,   -- the mechanic who drives it (his own truck)
  active boolean not null default true,                            -- « En service »
  color text,
  plate text,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger trucks_touch before insert or update on public.trucks for each row execute function public.touch();
create index trucks_updated on public.trucks(updated_at);

-- the usual week of a truck: for each weekday (0 = Sunday), its working hours in minutes [[480,720],[780,1080]]
create table public.truck_week (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks(id) on delete cascade,
  dow smallint not null check (dow between 0 and 6),
  ranges jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid(),
  unique (truck_id, dow)
);
create trigger truck_week_touch before insert or update on public.truck_week for each row execute function public.touch();
create index truck_week_updated on public.truck_week(updated_at);

-- a day that differs from the usual week (today only, the next N weeks, a holiday): its hours for that date ([] = closed)
create table public.truck_days (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks(id) on delete cascade,
  day date not null,
  ranges jsonb not null default '[]'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid(),
  unique (truck_id, day)
);
create trigger truck_days_touch before insert or update on public.truck_days for each row execute function public.touch();
create index truck_days_updated on public.truck_days(updated_at);
create index truck_days_day on public.truck_days(day);

create or replace function public.my_truck_ids() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(t.id), '{}') from public.trucks t where t.driver_id = auth.uid() and t.deleted_at is null
$$;

-- ---------- customers and vehicles ----------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  company text,
  phone text,
  phone_digits text generated always as (nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')) stored,
  email text,
  lang text not null default 'fr' check (lang in ('fr','en')),
  address text,
  unit text,
  city text,
  postal_code text,
  lat double precision,
  lng double precision,
  notes text,
  card_on_file boolean not null default false,
  no_shows int not null default 0,
  sms_ok boolean not null default true,              -- the customer accepts texts
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid(),
  check (coalesce(trim(first_name), '') <> '' or coalesce(trim(last_name), '') <> '' or coalesce(trim(company), '') <> '')
);
create trigger customers_touch before insert or update on public.customers for each row execute function public.touch();
create index customers_updated on public.customers(updated_at);
create index customers_phone on public.customers(phone_digits);

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  remind_on date,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger customer_notes_touch before insert or update on public.customer_notes for each row execute function public.touch();
create index customer_notes_updated on public.customer_notes(updated_at);
create index customer_notes_customer on public.customer_notes(customer_id);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  year int check (year between 1950 and 2100),
  make text,
  model text,
  trim text,
  engine text,                    -- "2.0 L 4 cyl." as shown
  displacement numeric(4,1),
  cylinders smallint,
  fuel text,
  drive text,
  vin text check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{11,17}$'),
  plate text,
  odometer_km int check (odometer_km is null or odometer_km between 0 and 3000000),
  color text,
  tire_size text,
  spec_key text,                  -- the engine sheet it uses (engine_specs.key)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger vehicles_touch before insert or update on public.vehicles for each row execute function public.touch();
create index vehicles_updated on public.vehicles(updated_at);
create index vehicles_customer on public.vehicles(customer_id);

-- an engine's sheet (oil, filters, parts…), filled once by a mechanic, then shown for every car with that engine
create table public.engine_specs (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,       -- 'year-make-model-displacement-cylinders', folded
  year int, make text, model text, engine text,
  data jsonb not null default '{}'::jsonb,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger engine_specs_touch before insert or update on public.engine_specs for each row execute function public.touch();
create index engine_specs_updated on public.engine_specs(updated_at);

-- ---------- services (the price list) and inventory ----------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  name_fr text not null check (length(trim(name_fr)) between 1 and 160),
  name_en text,
  category text not null default 'autre',
  price_cents int check (price_cents is null or price_cents between -10000000 and 10000000),  -- null = priced by the hour
  duration_min int not null default 60 check (duration_min between 5 and 720),
  taxable boolean not null default true,
  is_promo boolean not null default false,          -- « PROMO LIMITÉE »: a set of services at one price
  promo_until date,
  includes jsonb not null default '[]'::jsonb,      -- for a promo: the services it contains, as words [{fr,en}]
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger services_touch before insert or update on public.services for each row execute function public.touch();
create index services_updated on public.services(updated_at);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  sku text,
  category text,
  unit text not null default 'unité',
  qty numeric(12,2) not null default 0,
  min_qty numeric(12,2),
  cost_cents int,
  price_cents int,
  supplier text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger inventory_items_touch before insert or update on public.inventory_items for each row execute function public.touch();
create index inventory_items_updated on public.inventory_items(updated_at);

-- parts a service uses (taken off the inventory when the work is done)
create table public.service_parts (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  qty numeric(10,2) not null default 1 check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid(),
  unique (service_id, item_id)
);
create trigger service_parts_touch before insert or update on public.service_parts for each row execute function public.touch();
create index service_parts_updated on public.service_parts(updated_at);

-- ---------- jobs (appointments / work orders) ----------
create sequence public.job_number_seq start 1001;
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  number int not null unique default nextval('public.job_number_seq'),
  customer_id uuid references public.customers(id) on delete restrict,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  day date not null,
  block text not null check (block in ('am','pm','eve')),
  truck_id uuid references public.trucks(id) on delete set null,   -- chosen by the app (null = « À placer »)
  truck_pinned boolean not null default false,                     -- someone put it on this truck by hand
  stop_order int,
  eta_min int,                                                     -- estimated arrival, minutes after midnight (internal)
  travel_min int,                                                  -- estimated drive to reach it from the previous stop
  duration_min int not null default 60 check (duration_min between 5 and 720),
  status text not null default 'booked' check (status in ('booked','en_route','on_site','done','cancelled','no_show')),
  problem text,                                                    -- what the customer asked for
  notes text,                                                      -- internal notes
  address text,                                                    -- where the work is done (may differ from home)
  unit text,
  postal_code text,
  lat double precision,
  lng double precision,
  card_on_file boolean not null default false,
  lost_cents int,                                                  -- cancelled / no-show: the amount lost
  lost_reason text,
  started_at timestamptz, arrived_at timestamptz, finished_at timestamptz, cancelled_at timestamptz,
  pay_later boolean not null default false,                        -- finished with the invoice still to collect
  pay_later_reason text,
  waiver_signed_at timestamptz,
  waiver_signer text,
  waiver_version text,
  waiver_attachment uuid,
  confirm_sent_at timestamptz,
  source text not null default 'phone' check (source in ('phone','walk_in','quote','web')),
  quote_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger jobs_touch before insert or update on public.jobs for each row execute function public.touch();
create index jobs_updated on public.jobs(updated_at);
create index jobs_day_block on public.jobs(day, block) where deleted_at is null;
create index jobs_truck on public.jobs(truck_id);
create index jobs_customer on public.jobs(customer_id);

create table public.job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind text not null default 'service' check (kind in ('service','part','labour','fee','discount')),
  service_id uuid references public.services(id) on delete set null,
  item_id uuid references public.inventory_items(id) on delete set null,
  description text not null check (length(trim(description)) between 1 and 300),
  qty numeric(10,2) not null default 1 check (qty > 0),
  unit_cents int not null default 0,
  taxable boolean not null default true,
  duration_min int,
  -- planned = booked; done = work done; proposed = extra work waiting for the customer's answer;
  -- approved / declined = the customer's answer; removed = not done
  status text not null default 'planned' check (status in ('planned','done','proposed','approved','declined','removed')),
  answered_at timestamptz,
  answered_via text check (answered_via is null or answered_via in ('signature','link','verbal')),
  note text,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger job_items_touch before insert or update on public.job_items for each row execute function public.touch();
create index job_items_updated on public.job_items(updated_at);
create index job_items_job on public.job_items(job_id);

-- ---------- quick estimates ----------
create sequence public.quote_number_seq start 1;
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  number int not null unique default nextval('public.quote_number_seq'),
  customer_id uuid references public.customers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  vehicle_text text,
  contact_name text,
  contact_phone text,
  items jsonb not null default '[]'::jsonb,       -- [{description, qty, unit_cents, taxable, service_id, duration_min}]
  notes text,
  status text not null default 'open' check (status in ('open','sent','accepted','declined','converted')),
  job_id uuid references public.jobs(id) on delete set null,
  lang text not null default 'fr',
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger quotes_touch before insert or update on public.quotes for each row execute function public.touch();
create index quotes_updated on public.quotes(updated_at);

-- ---------- invoices and payments ----------
create table public.counters (name text primary key, next_value bigint not null);
insert into public.counters values ('invoice', 1) on conflict do nothing;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  number bigint unique,                     -- given by the server when the invoice is finished (never twice, never skipped)
  status text not null default 'draft' check (status in ('draft','issued','paid','void')),
  issued_at timestamptz,
  due_on date,
  lines jsonb not null default '[]'::jsonb, -- the lines as printed: [{description, qty, unit_cents, taxable, total_cents, kind}]
  taxes_on boolean not null default true,
  subtotal_cents int not null default 0,
  taxable_cents int not null default 0,
  tps_cents int not null default 0,
  tvq_cents int not null default 0,
  total_cents int not null default 0,
  paid_cents int not null default 0,
  lang text not null default 'fr',
  notes text,
  sent_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger invoices_touch before insert or update on public.invoices for each row execute function public.touch();
create index invoices_updated on public.invoices(updated_at);
create index invoices_customer on public.invoices(customer_id);
-- one live invoice per job (a cancelled one can be replaced)
create unique index invoices_one_per_job on public.invoices(job_id) where status <> 'void' and deleted_at is null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete restrict,        -- a prepayment before the invoice exists
  amount_cents int not null check (amount_cents <> 0),
  method text not null check (method in ('cash','debit','credit','interac','card_online','cheque','other')),
  paid_at timestamptz not null default now(),
  reference text,
  stripe_session text unique,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger payments_touch before insert or update on public.payments for each row execute function public.touch();
create index payments_updated on public.payments(updated_at);
create index payments_invoice on public.payments(invoice_id);

-- ---------- treasury ----------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('receipt','signature','logo','other')),
  mime text not null check (mime in ('image/jpeg','image/png','image/webp','image/svg+xml','application/pdf')),
  data text not null check (length(data) <= 4000000),   -- base64 (receipts are shrunk on the phone first)
  bytes int,
  width int, height int,
  job_id uuid references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger attachments_touch before insert or update on public.attachments for each row execute function public.touch();
create index attachments_job on public.attachments(job_id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  day date not null default public.local_today(),
  vendor text,
  category text not null default 'autre',
  description text,
  subtotal_cents int not null default 0,
  tps_cents int not null default 0,
  tvq_cents int not null default 0,
  total_cents int not null default 0,
  method text,
  truck_id uuid references public.trucks(id) on delete set null,
  receipt_id uuid references public.attachments(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger expenses_touch before insert or update on public.expenses for each row execute function public.touch();
create index expenses_updated on public.expenses(updated_at);
create index expenses_day on public.expenses(day);

create table public.inventory_moves (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  delta numeric(12,2) not null check (delta <> 0),
  reason text not null check (reason in ('used','restock','adjust','return')),
  job_id uuid references public.jobs(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger inventory_moves_touch before insert or update on public.inventory_moves for each row execute function public.touch();
create index inventory_moves_updated on public.inventory_moves(updated_at);
create index inventory_moves_item on public.inventory_moves(item_id);
-- the quantity on hand follows every move, in the same transaction
create or replace function public.inventory_apply_move() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.deleted_at is null then
    update public.inventory_items set qty = qty + new.delta where id = new.item_id;
  elsif tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    update public.inventory_items set qty = qty - old.delta where id = old.item_id;
  end if;
  return new;
end $$;
create trigger inventory_moves_apply after insert or update on public.inventory_moves for each row execute function public.inventory_apply_move();

-- ---------- the mechanic's day, positions, trips ----------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger shifts_touch before insert or update on public.shifts for each row execute function public.touch();
create index shifts_updated on public.shifts(updated_at);
create unique index shifts_one_open on public.shifts(staff_id) where ended_at is null and deleted_at is null;

-- the last known position of each person on shift (one row per person, rewritten)
create table public.positions (
  id uuid primary key references public.staff(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m int,
  heading int,
  speed_kmh int,
  job_id uuid references public.jobs(id) on delete set null,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger positions_touch before insert or update on public.positions for each row execute function public.touch();
create index positions_updated on public.positions(updated_at);
-- the path of the day (kept 30 days, for the office)
create table public.position_log (
  id bigserial primary key,
  staff_id uuid not null references public.staff(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  at timestamptz not null default now()
);
create index position_log_staff_at on public.position_log(staff_id, at);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  token_hash text unique,
  status text not null default 'active' check (status in ('active','arrived','cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  eta_at timestamptz,
  km numeric(8,1),
  minutes int,
  route jsonb,                -- [[lat,lng],…] (at most 250 points)
  dest_lat double precision,
  dest_lng double precision,
  sms_status text,
  expires_at timestamptz not null default now() + interval '4 hours',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger trips_touch before insert or update on public.trips for each row execute function public.touch();
create index trips_updated on public.trips(updated_at);
create unique index trips_one_active on public.trips(job_id) where status = 'active' and deleted_at is null;

-- ---------- links sent to customers, texts, history, secrets ----------
create table public.public_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  job_id uuid references public.jobs(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  views int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (job_id is not null or quote_id is not null)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  kind text not null,
  channel text not null default 'sms' check (channel in ('sms','email')),
  to_addr text,
  body text,
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  provider_ref text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create trigger messages_touch before insert or update on public.messages for each row execute function public.touch();
create index messages_updated on public.messages(updated_at);
create index messages_job on public.messages(job_id);

create table public.activity (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  entity text not null,
  entity_id uuid,
  action text not null,
  data jsonb
);
create index activity_entity on public.activity(entity, entity_id);
create index activity_at on public.activity(at);

-- keys of outside services (texts, card payments): only the server functions read them
create table public.secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- an operation sent twice from a phone (answer lost on a weak signal) runs once
create table public.op_log (
  op uuid primary key,
  name text not null,
  result jsonb,
  at timestamptz not null default now(),
  by uuid default auth.uid()
);

-- payment notices already handled (Stripe sends some twice)
create table public.stripe_events (id text primary key, at timestamptz not null default now());
