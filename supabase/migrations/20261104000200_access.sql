-- Part 2: who sees and changes what (row level security), enforced by the database for every request.
-- Reading: everyone on the team reads the shared basics (settings, trucks, hours, services, team list).
-- A mechanic sees the jobs of his truck (and the customers, cars, invoices of those jobs); the agenda, clients,
-- invoices, money, treasury, inventory, map rights open the rest. The owner sees everything.

-- ---------- visibility helpers ----------
create or replace function public.job_visible(p_truck uuid, p_created_by uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.can('agenda') or p_truck = any(public.my_truck_ids()) or (p_created_by = auth.uid() and public.is_staff())
$$;
create or replace function public.job_id_visible(p_job uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs j where j.id = p_job and public.job_visible(j.truck_id, j.created_by))
$$;
create or replace function public.customer_visible(p_customer uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.can('clients')
      or exists (select 1 from public.customers c where c.id = p_customer and c.created_by = auth.uid() and public.is_staff())
      or exists (select 1 from public.jobs j where j.customer_id = p_customer and j.deleted_at is null and public.job_visible(j.truck_id, j.created_by))
      or exists (select 1 from public.quotes q where q.customer_id = p_customer and q.created_by = auth.uid() and public.is_staff())
$$;
-- who works on cars and customers (everyone but a person who is only treasurer)
create or replace function public.is_field() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('owner') or public.has_role('office') or public.has_role('mechanic')
$$;
create or replace function public.invoice_visible(p_job uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.can('invoices') or (p_job is not null and public.job_id_visible(p_job))
$$;
-- may change this job's invoice and take its payment: the right, or the mechanic of that job
create or replace function public.invoice_editable(p_job uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.can('edit_invoices')
      or (p_job is not null and exists (select 1 from public.jobs j where j.id = p_job and (j.truck_id = any(public.my_truck_ids()) or j.created_by = auth.uid())) and public.has_role('mechanic'))
      or (p_job is not null and public.can('book') and public.job_id_visible(p_job))
$$;

-- ---------- grants: nothing is open to the public; the team gets only what its rules allow ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on sequence public.job_number_seq, public.quote_number_seq to authenticated;

do $$
declare t text;
begin
  foreach t in array array['settings','staff','trucks','truck_week','truck_days','customers','customer_notes','vehicles','engine_specs',
    'services','inventory_items','service_parts','jobs','job_items','quotes','invoices','payments','attachments','expenses',
    'inventory_moves','shifts','positions','trips','messages','activity','invitations']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['public_links','secrets','op_log','stripe_events','counters','position_log'] loop
    execute format('alter table public.%I enable row level security', t);   -- no policy: only server functions
  end loop;
end $$;
grant insert, update on public.trucks, public.truck_week, public.truck_days, public.customers, public.customer_notes, public.vehicles,
  public.engine_specs, public.services, public.service_parts, public.inventory_items, public.job_items, public.quotes,
  public.invoices, public.attachments, public.expenses, public.inventory_moves to authenticated;
grant update (company, taxes, booking, billing, messages, role_rights, waiver, appearance, maps, expense_categories) on public.settings to authenticated;
grant update (problem, notes, vehicle_id, address, unit, postal_code, lat, lng, card_on_file, duration_min, deleted_at) on public.jobs to authenticated;

-- ---------- shared basics ----------
create policy settings_read on public.settings for select to authenticated using (public.is_staff());
create policy settings_write on public.settings for update to authenticated using (public.can('settings')) with check (public.can('settings'));
-- the role matrix and the team colours: owner only
create or replace function public.settings_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- people on the team: only the owner (server functions and migrations, which have no signed-in person, may)
  if (new.role_rights is distinct from old.role_rights or new.appearance is distinct from old.appearance)
     and auth.uid() is not null and not public.is_owner()
     and coalesce(current_setting('garage.rpc', true), '') <> 'on' then
    raise exception 'Seul le propriétaire change les droits et les couleurs de l''équipe.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger settings_guard before update on public.settings for each row execute function public.settings_guard();

create policy staff_read on public.staff for select to authenticated using (public.is_staff());
create policy invitations_read on public.invitations for select to authenticated using (public.is_owner());

create policy trucks_read on public.trucks for select to authenticated using (public.is_staff());
create policy trucks_write on public.trucks for insert to authenticated with check (public.is_owner() or public.can('hours'));
create policy trucks_update on public.trucks for update to authenticated using (public.is_owner() or public.can('hours')) with check (public.is_owner() or public.can('hours'));

-- a truck's hours: whoever may change everyone's hours, or the mechanic who drives it (his own availability)
create or replace function public.truck_hours_editable(p_truck uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.can('hours') or p_truck = any(public.my_truck_ids())
$$;
create policy truck_week_read on public.truck_week for select to authenticated using (public.is_staff());
create policy truck_week_ins on public.truck_week for insert to authenticated with check (public.truck_hours_editable(truck_id));
create policy truck_week_upd on public.truck_week for update to authenticated using (public.truck_hours_editable(truck_id)) with check (public.truck_hours_editable(truck_id));
create policy truck_days_read on public.truck_days for select to authenticated using (public.is_staff());
create policy truck_days_ins on public.truck_days for insert to authenticated with check (public.truck_hours_editable(truck_id));
create policy truck_days_upd on public.truck_days for update to authenticated using (public.truck_hours_editable(truck_id)) with check (public.truck_hours_editable(truck_id));

create policy services_read on public.services for select to authenticated using (public.is_staff());
create policy services_ins on public.services for insert to authenticated with check (public.can('settings'));
create policy services_upd on public.services for update to authenticated using (public.can('settings')) with check (public.can('settings'));
create policy service_parts_read on public.service_parts for select to authenticated using (public.is_staff());
create policy service_parts_ins on public.service_parts for insert to authenticated with check (public.can('settings') or public.can('inventory'));
create policy service_parts_upd on public.service_parts for update to authenticated using (public.can('settings') or public.can('inventory')) with check (public.can('settings') or public.can('inventory'));

create policy engine_specs_read on public.engine_specs for select to authenticated using (public.is_staff());
create policy engine_specs_ins on public.engine_specs for insert to authenticated with check (public.is_field());
create policy engine_specs_upd on public.engine_specs for update to authenticated using (public.is_field()) with check (public.is_field());

-- ---------- customers, cars ----------
create policy customers_read on public.customers for select to authenticated using (public.customer_visible(id));
create policy customers_ins on public.customers for insert to authenticated with check (public.is_field());
create policy customers_upd on public.customers for update to authenticated using (public.is_field() and public.customer_visible(id)) with check (public.is_field());
create policy customer_notes_read on public.customer_notes for select to authenticated using (public.customer_visible(customer_id));
create policy customer_notes_ins on public.customer_notes for insert to authenticated with check (public.is_field() and public.customer_visible(customer_id));
create policy customer_notes_upd on public.customer_notes for update to authenticated using (public.is_field() and public.customer_visible(customer_id)) with check (public.is_field());
create policy vehicles_read on public.vehicles for select to authenticated using (customer_id is null and created_by = auth.uid() or public.customer_visible(customer_id));
create policy vehicles_ins on public.vehicles for insert to authenticated with check (public.is_field());
create policy vehicles_upd on public.vehicles for update to authenticated using (public.is_field() and (public.customer_visible(customer_id) or created_by = auth.uid())) with check (public.is_field());

-- ---------- jobs ----------
create policy jobs_read on public.jobs for select to authenticated using (public.job_visible(truck_id, created_by));
-- jobs are created, moved and moved forward only by the server operations (book_job, move_job, job_step…);
-- a direct change may only touch the descriptive fields granted above
create policy jobs_upd on public.jobs for update to authenticated
  using (public.job_visible(truck_id, created_by) and (public.can('book') or truck_id = any(public.my_truck_ids()) or created_by = auth.uid()))
  with check (public.job_visible(truck_id, created_by));

create policy job_items_read on public.job_items for select to authenticated using (public.job_id_visible(job_id));
create or replace function public.job_items_editable(p_job uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs j where j.id = p_job and j.deleted_at is null
    and (public.can('book') or j.truck_id = any(public.my_truck_ids()) or j.created_by = auth.uid())
    and public.job_visible(j.truck_id, j.created_by))
$$;
create policy job_items_ins on public.job_items for insert to authenticated with check (public.job_items_editable(job_id));
create policy job_items_upd on public.job_items for update to authenticated using (public.job_items_editable(job_id)) with check (public.job_items_editable(job_id));

create policy quotes_read on public.quotes for select to authenticated using (created_by = auth.uid() and public.is_staff() or public.can('book') or public.can('invoices'));
create policy quotes_ins on public.quotes for insert to authenticated with check (public.is_field());
create policy quotes_upd on public.quotes for update to authenticated using (created_by = auth.uid() and public.is_staff() or public.can('book')) with check (public.is_field());

-- ---------- money ----------
create policy invoices_read on public.invoices for select to authenticated using (public.invoice_visible(job_id));
create policy invoices_ins on public.invoices for insert to authenticated with check (public.invoice_editable(job_id) and status = 'draft' and number is null);
create policy invoices_upd on public.invoices for update to authenticated using (public.invoice_editable(job_id)) with check (public.invoice_editable(job_id));
-- a finished invoice is locked: only the server operations (payment, cancel) change it
create or replace function public.invoices_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('garage.rpc', true), '') = 'on' then return new; end if;
  if old.status <> 'draft' then
    raise exception 'Cette facture est terminée : elle ne se modifie plus. Annule-la pour en faire une nouvelle.' using errcode = '42501';
  end if;
  if new.number is distinct from old.number or new.status <> 'draft' or new.paid_cents is distinct from old.paid_cents then
    raise exception 'Le numéro, le statut et les paiements passent par le serveur.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger invoices_guard before update on public.invoices for each row execute function public.invoices_guard();

create or replace function public.payment_visible(p_invoice uuid, p_job uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.invoice_visible(coalesce(p_job, (select i.job_id from public.invoices i where i.id = p_invoice)))
$$;
create policy payments_read on public.payments for select to authenticated using (public.payment_visible(invoice_id, job_id));

create policy attachments_read on public.attachments for select to authenticated using (
  case kind when 'receipt' then public.can('treasury')
            when 'signature' then job_id is not null and public.job_id_visible(job_id)
            else public.is_staff() end);
create policy attachments_ins on public.attachments for insert to authenticated with check (
  case kind when 'receipt' then public.can('treasury')
            when 'signature' then job_id is not null and public.job_items_editable(job_id)
            when 'logo' then public.can('settings')
            else public.is_staff() end);
create policy attachments_upd on public.attachments for update to authenticated using (created_by = auth.uid() or public.is_owner()) with check (true);

create policy expenses_read on public.expenses for select to authenticated using (public.can('treasury'));
create policy expenses_ins on public.expenses for insert to authenticated with check (public.can('treasury'));
create policy expenses_upd on public.expenses for update to authenticated using (public.can('treasury')) with check (public.can('treasury'));

create policy inventory_items_read on public.inventory_items for select to authenticated using (public.is_staff());
create policy inventory_items_ins on public.inventory_items for insert to authenticated with check (public.can('inventory'));
create policy inventory_items_upd on public.inventory_items for update to authenticated using (public.can('inventory')) with check (public.can('inventory'));
create policy inventory_moves_read on public.inventory_moves for select to authenticated using (public.can('inventory'));
create policy inventory_moves_ins on public.inventory_moves for insert to authenticated with check (public.can('inventory'));
create policy inventory_moves_upd on public.inventory_moves for update to authenticated using (public.can('inventory')) with check (public.can('inventory'));
-- the quantity follows the moves only
create or replace function public.inventory_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.qty is distinct from old.qty and coalesce(current_setting('garage.rpc', true), '') <> 'on' and pg_trigger_depth() <= 1 then
    raise exception 'La quantité change par une entrée ou une sortie de stock.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger inventory_guard before update on public.inventory_items for each row execute function public.inventory_guard();

-- ---------- day, positions, trips, texts, history ----------
create policy shifts_read on public.shifts for select to authenticated using (staff_id = auth.uid() or public.can('map'));
create policy positions_read on public.positions for select to authenticated using (id = auth.uid() or public.can('map'));
create policy trips_read on public.trips for select to authenticated using (staff_id = auth.uid() or public.can('map') or public.job_id_visible(job_id));
create policy messages_read on public.messages for select to authenticated using (public.can('agenda') or (job_id is not null and public.job_id_visible(job_id)));
create policy activity_read on public.activity for select to authenticated using (public.is_owner());

-- ---------- realtime: the tables the devices follow ----------
do $$
declare t text;
begin
  foreach t in array array['settings','staff','trucks','truck_week','truck_days','customers','customer_notes','vehicles','engine_specs',
    'services','inventory_items','service_parts','jobs','job_items','quotes','invoices','payments','expenses','inventory_moves',
    'shifts','positions','trips','messages']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- functions: none is callable by the public unless said so ----------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
