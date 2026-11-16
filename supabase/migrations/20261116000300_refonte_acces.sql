-- Part 26 — « Refonte », rights and privacy: who may see and change what, the public entry points, the clean-up.
--
-- Every change here closes a door a scan of the code found open (the ids are the ones of the scan reports). Nothing is
-- removed or renamed, and yesterday's app keeps working: a rule only becomes stricter where the old one was wrong.
--
--  1. Direct writes on the tables (what a signed-in person could send to the API that no screen sends)
--     trucks              only the owner or « Réglages » add / change a vehicle, as the app shows it. Before: « Horaires »
--                         (every mechanic on live) could make himself the driver of any truck, or switch one off
--     jobs                duration_min and deleted_at are no longer writable directly (set_job_duration, job_step)
--     customers           a file with a coming appointment or a finished invoice not paid is not deleted (the rule lived
--                         in the screen only, on the phone's own copy); a person without « Clients » can create a customer;
--                         a phone number corrected closes the customer's links texted to the old one (open jobs, open
--                         estimates) and lets the booking text go again
--     attachments         written once (a signature could be replaced after the fact); no SVG (a picture that runs code)
--     push_subs           a device's alert address follows the person who asks last (a second owner got a raw error)
--     settings.booking    web.on (the public booking page) changes only through web_switch: a settings save from a
--                         phone that still has an old copy never opens the page again
--  2. Rights
--     job_visible, truck_hours_editable   a blocked person whose session is still alive no longer reads or changes the
--                         truck he drove
--     right_of, right_flag   a value that is not yes / no in the rights never stops the person's app
--     member_update       keeps only known rights with yes / no; an empty or unknown list of roles is refused in words;
--                         runs exactly once (op_begin)
--     set_role_rights     runs exactly once (op_begin)
--     remove_member       always one owner left, even when two owners remove each other at the same instant; the
--                         person's unused invitation and password links are cancelled
--     rights_table        for the team only;  access_of: the previewed person's short name, colour and real routes
--                         (« Routes partagées »);  my_access: the server's clock (« now »)
--  3. The day
--     shift_start         the team check comes first; two taps at the same instant no longer give a database error;
--                         a clean-up that fails never stops a mechanic from starting his day
--     report_position     the position no longer keeps a job that is finished
--     housekeeping        also empties what was promised to be short-lived (calls 1 day, texts 7 days, brakes 2 days,
--                         robot notes 90 days, alert addresses of people who are no longer owners) and the automatic
--                         change log after 24 months — never a named proof (signature online, price changed…)
--  4. « Réserver en ligne » (still switched OFF on live)
--     web_book            the same customer = the same phone AND the same first or last name; an existing file is never
--                         written (no e-mail, no car); what the visitor typed is kept on the job (jobs.web_contact and
--                         the notes); a date or a position that is not one is refused in words. Windows, car / truck and
--                         every brake are as they were
--     web_switch(op, on)  the owner's switch of the public page
--  5. Who may call what
--     every function closed to the public and to the app, then opened by name (the list is kept exactly by
--     tests/db/refonte-droits.test.mjs); from now on a new function is closed until its migration opens it
--     (« grant execute … to authenticated »: a migration made after this one that forgets it is closed to the app)
--  6. Indexes the row rules, the clean-up and the look-ups by job, car and customer need
--
-- New refusal codes: customer_busy, customer_owes (deleting a customer), bad_role (member_update).
-- New column: jobs.web_contact (part of jobs: the nightly backup holds it with the table). No new table.
-- New functions: web_switch (owner, from the app), fold_name, right_flag, and the trigger functions
-- customers_delete_guard, customers_phone_links, push_subs_takeover, settings_web_guard (closed to the app).

-- =====================================================================================================================
-- 1. DIRECT WRITES
-- =====================================================================================================================

-- ---------- trucks: the owner or « Réglages », as the app shows « Les camions » (x-security-02, x-rights-10) ----------
-- Hours and starts are not touched: truck_week / truck_days keep truck_hours_editable, the start goes through
-- set_truck_start.
drop policy if exists trucks_write on public.trucks;
drop policy if exists trucks_update on public.trucks;
create policy trucks_write on public.trucks for insert to authenticated
  with check (public.is_owner() or public.can('settings'));
create policy trucks_update on public.trucks for update to authenticated
  using (public.is_owner() or public.can('settings')) with check (public.is_owner() or public.can('settings'));

-- ---------- jobs: the length goes through set_job_duration, a job ends by job_step (x-security-09, audit A2) ----------
revoke update (duration_min, deleted_at) on public.jobs from authenticated;

-- ---------- customers ----------
-- A person who creates a customer gets the row back (insert … returning): the read rule is then checked on the NEW row,
-- before it is in the table, so the look-up inside customer_visible found nothing and only « Clients » passed
-- (sql-foundation-04). The row's own author is now read from the row itself; nothing else changes.
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated
  using (public.customer_visible(id) or (created_by = auth.uid() and public.is_staff()));

-- Deleting a file: never while the customer has a coming appointment or a finished invoice not paid, whatever the
-- phone that asks can see (x-security-22, sql-foundation-10). The same rule as the screen (DeleteZone), kept by the
-- server. The server's own operations are not held by it.
create or replace function public.customers_delete_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null
     and coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
     and coalesce(current_setting('garage.rpc', true), '') <> 'on' then
    if exists (select 1 from public.jobs j where j.customer_id = new.id and j.deleted_at is null
               and (j.status in ('en_route', 'on_site') or (j.status = 'booked' and j.day >= public.local_today()))) then
      perform public.fail('customer_busy', 'Ce client a un rendez-vous à venir : déplace-le ou annule-le avant de supprimer la fiche.');
    end if;
    if exists (select 1 from public.invoices i where i.customer_id = new.id and i.deleted_at is null
               and i.status = 'issued' and i.total_cents > i.paid_cents) then
      perform public.fail('customer_owes', 'Ce client a une facture à payer : encaisse-la ou annule-la avant de supprimer la fiche.');
    end if;
  end if;
  return new;
end $$;
revoke all on function public.customers_delete_guard() from public, anon, authenticated;
grant execute on function public.customers_delete_guard() to service_role;
drop trigger if exists customers_delete_guard on public.customers;
create trigger customers_delete_guard before update of deleted_at on public.customers
  for each row execute function public.customers_delete_guard();

-- ---------- attachments: written once, and never a picture that can run code ----------
-- The app only ever inserts and reads them. A signature (or a receipt) could be replaced, or moved to another job,
-- by its author afterwards (sql-foundation-08); an SVG receipt opened by the owner ran its script in the owner's
-- session (x-security-01, the server's half: the app writes png / jpeg / webp / pdf only).
revoke update on public.attachments from authenticated;
drop policy if exists attachments_upd on public.attachments;
create policy attachments_upd on public.attachments for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
alter table public.attachments drop constraint if exists attachments_no_svg;
alter table public.attachments add constraint attachments_no_svg check (mime <> 'image/svg+xml') not valid;

-- ---------- push_subs: the alert address of a device follows the person who asks last (sql-misc-02) ----------
-- The address is unique for the whole table and a person only sees their own rows: a second owner on the same device
-- deleted nothing, then hit the unique rule (a raw database error, the switch stayed off for ever). The row another
-- account left for that address now goes away when its new holder registers it.
create or replace function public.push_subs_takeover() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.staff_id = auth.uid() and public.is_owner() then
    delete from public.push_subs where endpoint = new.endpoint and staff_id <> new.staff_id;
  end if;
  return new;
end $$;
revoke all on function public.push_subs_takeover() from public, anon, authenticated;
grant execute on function public.push_subs_takeover() to service_role;
drop trigger if exists push_subs_takeover on public.push_subs;
create trigger push_subs_takeover before insert on public.push_subs
  for each row execute function public.push_subs_takeover();

-- ---------- customers: a phone number corrected closes the links texted to the old one (x-security-03) ----------
-- Every text makes a new link (90 days) and nothing closed one but « Changer de client »: a booking text sent to a
-- wrong digit kept showing the appointment to a stranger, who could sign it, after the office fixed the number. When
-- the digits of a customer's phone change, the links of their appointments not finished yet (booked, en route, on
-- site) and of their estimates still open are closed, and a booked appointment may be confirmed again (the app then
-- offers to resend the text, to the new number, with a new link). A finished job's links stay (the customer's invoice
-- and the card payment's return use them). Only the digits count: « 514 555-1234 » → « (514) 555-1234 » closes nothing.
create or replace function public.customers_phone_links() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_links int := 0; n int;
begin
  if old.phone_digits is null or new.phone_digits is not distinct from old.phone_digits then return null; end if;
  update public.public_links l set revoked_at = now()
   where l.revoked_at is null
     and (l.job_id in (select j.id from public.jobs j where j.customer_id = new.id and j.status in ('booked', 'en_route', 'on_site'))
       or l.quote_id in (select q.id from public.quotes q where q.customer_id = new.id and q.status in ('open', 'sent')));
  get diagnostics v_links = row_count;
  update public.jobs set confirm_sent_at = null
   where customer_id = new.id and status = 'booked' and deleted_at is null and confirm_sent_at is not null;
  get diagnostics n = row_count;
  if v_links > 0 or n > 0 then
    insert into public.activity (actor, entity, entity_id, action, data)
    values (auth.uid(), 'customer', new.id, 'phone_changed', jsonb_build_object('links_closed', v_links, 'to_confirm', n));
  end if;
  return null;
end $$;
revoke all on function public.customers_phone_links() from public, anon, authenticated;
grant execute on function public.customers_phone_links() to service_role;
drop trigger if exists customers_phone_links on public.customers;
create trigger customers_phone_links after update of phone on public.customers
  for each row execute function public.customers_phone_links();

-- ---------- settings.booking.web.on: the public booking page opens and closes through web_switch only (sql-misc-04) ----------
-- The app saves « booking » as one whole object built from the phone's copy: a phone whose copy is older than the day
-- the page was closed (or a change queued offline) would put « on: true » back, with nobody seeing it. A person's
-- settings save now keeps the value the server has. The server's own writes (a restore, a test) are not held.
create or replace function public.settings_web_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('garage.web', true), '') <> 'on' and public.by_person()
     and (new.booking->'web'->'on') is distinct from (old.booking->'web'->'on') then
    new.booking := case
      when old.booking->'web' ? 'on'
        then jsonb_set(coalesce(new.booking, '{}'::jsonb), '{web}',
               (case when jsonb_typeof(new.booking->'web') = 'object' then new.booking->'web' else '{}'::jsonb end)
               || jsonb_build_object('on', old.booking->'web'->'on'))
      else new.booking #- '{web,on}' end;
  end if;
  return new;
end $$;
revoke all on function public.settings_web_guard() from public, anon, authenticated;
grant execute on function public.settings_web_guard() to service_role;
drop trigger if exists settings_web_guard on public.settings;
create trigger settings_web_guard before update on public.settings
  for each row execute function public.settings_web_guard();

-- web_switch(op, on): owner only. Answers the settings row, like set_role_rights.
create or replace function public.web_switch(p_op uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb;
begin
  v_done := public.op_begin(p_op, 'web_switch');
  if v_done is not null then return v_done; end if;
  if not public.is_owner() then perform public.fail('not_allowed', 'Seul le propriétaire ouvre ou ferme la réservation en ligne.'); end if;
  perform set_config('garage.rpc', 'on', true);
  perform set_config('garage.web', 'on', true);
  update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{web}',
      (case when jsonb_typeof(booking->'web') = 'object' then booking->'web' else '{}'::jsonb end)
      || jsonb_build_object('on', coalesce(p_on, false)))
   where id = 1;
  perform set_config('garage.web', '', true);
  return public.op_save(p_op, 'web_switch', jsonb_build_object('ok', true, 'on', coalesce(p_on, false),
    'rows', jsonb_build_object('settings', (select jsonb_agg(to_jsonb(s)) from public.settings s))));
end $$;
revoke all on function public.web_switch(uuid, boolean) from public, anon, authenticated;
grant execute on function public.web_switch(uuid, boolean) to authenticated, service_role;

-- =====================================================================================================================
-- 2. RIGHTS
-- =====================================================================================================================

-- ---------- a blocked person's truck (x-rights-19) ----------
-- my_truck_ids() answers the trucks a person drives without asking whether the person is still on the team, and
-- « Bloquer » keeps the truck's driver (so that unblocking gives everything back). Until the session died (up to an
-- hour) a blocked mechanic still read his truck's jobs and customers and could change its hours.
create or replace function public.job_visible(p_truck uuid, p_created_by uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can('agenda') or ((p_truck = any(public.my_truck_ids()) or p_created_by = auth.uid()) and public.is_staff())
$$;
create or replace function public.truck_hours_editable(p_truck uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.can('hours') or (p_truck = any(public.my_truck_ids()) and public.is_staff())
$$;

-- ---------- yes / no read from the rights, never an error (x-security-30, sql-foundation-30) ----------
-- A value that is not a yes / no in staff.rights or settings.role_rights made the cast fail inside every row rule of
-- that person: their whole app stopped until someone fixed the row by hand.
create or replace function public.right_flag(p jsonb) returns boolean language sql immutable as $$
  select case jsonb_typeof(p)
    when 'boolean' then p = 'true'::jsonb
    when 'string' then case when lower(p #>> '{}') in ('true', 't', 'yes', 'y', 'on', '1') then true
                            when lower(p #>> '{}') in ('false', 'f', 'no', 'n', 'off', '0') then false end
    when 'number' then case when p = '1'::jsonb then true when p = '0'::jsonb then false end
  end
$$;
revoke all on function public.right_flag(jsonb) from public, anon, authenticated;
grant execute on function public.right_flag(jsonb) to service_role;

create or replace function public.right_of(p_staff public.staff, p_right text) returns boolean
language plpgsql stable security definer set search_path = public as $$
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
      if coalesce(public.right_flag(rr -> r -> p_right), public.right_default(r, p_right)) then gives := true; end if;
    end if;
  end loop;
  if not allowed then return false; end if;
  if p_staff.rights ? p_right then return coalesce(public.right_flag(p_staff.rights -> p_right), false); end if;
  return gives;
end $$;

-- ---------- set_role_rights: exactly once ----------
create or replace function public.set_role_rights(p_op uuid, p_role text, p_right text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb;
begin
  v_done := public.op_begin(p_op, 'set_role_rights');
  if v_done is not null then return v_done; end if;
  if not public.is_owner() then perform public.fail('not_allowed', 'Seul le propriétaire change les droits.'); end if;
  if p_role not in ('office','mechanic','treasurer') or not (p_right = any(public.all_rights())) then perform public.fail('bad_right', 'Droit inconnu.'); end if;
  if public.right_rule(p_role, p_right) is distinct from 'can' then perform public.fail('fixed', 'Ce droit ne se change pas pour ce rôle.'); end if;
  perform set_config('garage.rpc', 'on', true);
  update public.settings set role_rights = jsonb_set(coalesce(role_rights, '{}'), array[p_role], coalesce(role_rights->p_role, '{}') || jsonb_build_object(p_right, p_on)) where id = 1;
  return public.op_save(p_op, 'set_role_rights', jsonb_build_object('ok', true, 'rows', jsonb_build_object('settings', (select jsonb_agg(to_jsonb(s)) from public.settings s))));
end $$;

-- ---------- member_update: exactly once; only known roles and yes / no rights are kept ----------
create or replace function public.member_update(p_op uuid, p_staff uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; s public.staff; v_roles text[]; v_active boolean; v_rights jsonb;
begin
  v_done := public.op_begin(p_op, 'member_update');
  if v_done is not null then return v_done; end if;
  if not public.is_owner() then perform public.fail('not_allowed', 'Seul le propriétaire gère l’équipe.'); end if;
  perform 1 from public.staff where 'owner' = any(roles) and deleted_at is null for update;
  select * into s from public.staff where id = p_staff and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Cette personne n’existe plus.'); end if;
  -- the roles sent (a list, even an empty one: refused below), else the person's own
  v_roles := case when jsonb_typeof(p_patch->'roles') = 'array'
                  then coalesce((select array_agg(x) from jsonb_array_elements_text(p_patch->'roles') x), '{}'::text[])
                  else s.roles end;
  v_active := coalesce(public.right_flag(p_patch->'active'), s.active);
  if cardinality(v_roles) = 0 then perform public.fail('no_role', 'Coche au moins un rôle.'); end if;
  if not (v_roles <@ array['owner', 'office', 'mechanic', 'treasurer']) then perform public.fail('bad_role', 'Ce rôle n’existe pas.'); end if;
  if ('owner' = any(s.roles) and s.active) and (not ('owner' = any(v_roles)) or not v_active)
     and not exists (select 1 from public.staff o where o.id <> s.id and o.active and o.deleted_at is null and 'owner' = any(o.roles)) then
    perform public.fail('last_owner', 'Il faut garder au moins un propriétaire.');
  end if;
  -- the person's own choices: a known right with yes or no; anything else is « Selon son rôle »
  v_rights := case
    when not (p_patch ? 'rights') then s.rights
    when jsonb_typeof(p_patch->'rights') = 'object' then
      coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(p_patch->'rights') e
                where e.key = any(public.all_rights()) and jsonb_typeof(e.value) = 'boolean'), '{}'::jsonb)
    else '{}'::jsonb end;
  update public.staff set
    full_name = coalesce(nullif(trim(p_patch->>'full_name'), ''), full_name),
    short_name = case when p_patch ? 'short_name' then nullif(trim(p_patch->>'short_name'), '') else short_name end,
    phone = case when p_patch ? 'phone' then nullif(trim(p_patch->>'phone'), '') else phone end,
    color = case when p_patch ? 'color' then nullif(p_patch->>'color', '') else color end,
    roles = v_roles,
    rights = v_rights,
    active = v_active
  where id = s.id;
  -- a blocked person can no longer sign in; their day is closed
  update auth.users set banned_until = case when v_active then null else 'infinity'::timestamptz end where id = s.id;
  if not v_active then perform public.close_day(s.id); end if;
  return public.op_save(p_op, 'member_update', jsonb_build_object('ok', true, 'rows', jsonb_build_object('staff', (select jsonb_agg(to_jsonb(x)) from public.staff x where x.id = s.id))));
end $$;

-- ---------- remove_member: always one owner left; the person's unused links are cancelled ----------
-- (x-security-37) The function « team » counted the owners, then called this: two owners leaving, or removing each
-- other, at the same instant both passed and the garage had no owner left. The rule now lives here, under the same
-- lock as member_update. (x-security-25) An invitation or a new-password link made before stayed usable for 7 days.
create or replace function public.remove_member(p_staff uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare s public.staff;
begin
  perform 1 from public.staff where 'owner' = any(roles) and deleted_at is null for update;
  select * into s from public.staff where id = p_staff for update;
  if not found then return false; end if;
  if 'owner' = any(s.roles) and s.active and s.deleted_at is null
     and not exists (select 1 from public.staff o where o.id <> s.id and o.active and o.deleted_at is null and 'owner' = any(o.roles)) then
    perform public.fail('last_owner', 'Il faut garder au moins un propriétaire.');
  end if;
  perform set_config('garage.rpc', 'on', true);
  -- the day closes, the truck is free, the account can no longer act; jobs and invoices stay
  perform public.close_day(p_staff);
  update public.trucks set driver_id = null where driver_id = p_staff;
  update public.staff set active = false, deleted_at = now() where id = p_staff;
  update public.invitations set used_at = now()
   where used_at is null and (user_id = p_staff or (s.email is not null and lower(email) = lower(s.email)));
  return true;
end $$;

-- ---------- rights_table: for the team only ----------
create or replace function public.rights_table() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_staff() then jsonb_build_object(
    'rights', to_jsonb(public.all_rights()),
    'rules', (select jsonb_object_agg(ro, (select jsonb_object_agg(r, coalesce(public.right_rule(ro, r), 'never')) from unnest(public.all_rights()) r))
              from unnest(array['office','mechanic','treasurer']) ro),
    'defaults', (select jsonb_object_agg(ro, (select jsonb_object_agg(r, coalesce(public.right_flag(st.role_rights->ro->r), public.right_default(ro, r))) from unnest(public.all_rights()) r))
              from unnest(array['office','mechanic','treasurer']) ro, public.settings st where st.id = 1)) end
$$;

-- ---------- access_of (« Voir l'app comme… »): the person's short name and colour, and the routes they really have ----------
-- (x-rights-18, sql-foundation-25) The preview kept the OWNER's short name on the banner, and listed only the truck
-- the person drives although « Routes partagées » gives every vehicle to every mechanic (my_truck_ids).
create or replace function public.access_of(p_staff uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_owner() then null else (
    select jsonb_build_object('id', s.id, 'full_name', s.full_name, 'short_name', s.short_name, 'color', s.color, 'roles', to_jsonb(s.roles),
      'rights', (select jsonb_object_agg(r, public.right_of(s, r)) from unnest(public.all_rights()) r),
      'trucks', (select coalesce(jsonb_agg(t.id), '[]'::jsonb) from public.trucks t
                 where t.deleted_at is null
                   and (t.driver_id = s.id
                     or ('mechanic' = any(s.roles) and s.active and s.deleted_at is null
                         and coalesce((select (st.booking->>'shared_routes')::boolean from public.settings st where st.id = 1), false)))))
    from public.staff s where s.id = p_staff) end
$$;

-- ---------- my_access: + « now », the server's clock (a phone whose clock is off can keep the difference) ----------
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'full_name', s.full_name, 'short_name', s.short_name, 'email', s.email, 'phone', s.phone, 'roles', to_jsonb(s.roles),
    'owner', 'owner' = any(s.roles), 'lang', s.lang, 'prefs', s.prefs, 'color', s.color,
    'rights', (select jsonb_object_agg(r, public.right_of(s, r)) from unnest(public.all_rights()) r),
    'trucks', to_jsonb(public.my_truck_ids()),
    'card_online', exists (select 1 from public.secrets where key = 'stripe_key'),
    'texts_online', exists (select 1 from public.secrets where key = 'ghl_token') and exists (select 1 from public.secrets where key = 'ghl_location'),
    'calls', 'owner' = any(s.roles) and coalesce(s.prefs->>'calls', '') = 'true',
    'now', now())
  from public.staff s where s.id = auth.uid() and s.active and s.deleted_at is null
$$;

-- =====================================================================================================================
-- 3. THE DAY
-- =====================================================================================================================

-- ---------- housekeeping: what was promised to be short-lived really goes (sql-misc-11, audit A4) ----------
-- Calls and texts were only emptied when the NEXT call or text arrived; the brakes' counters by a 1 % chance; the
-- alert addresses only when the push service said « gone ». The history (activity): only the automatic change log
-- (insert / update / delete, written by log_activity) goes after 24 months. A named line is a proof and stays for
-- ever: signed_online (the customer's electronic signature), price_changed, customer_changed, invoice_reopened,
-- window_fixed, web_booked, windows_switch and any name added later. The robot notes of the public page (web_robot,
-- one per request, no limit) go after 90 days.
create or replace function public.housekeeping() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select staff_id from public.shifts where ended_at is null and deleted_at is null and started_at < now() - interval '16 hours' loop
    perform public.close_day(r.staff_id);
  end loop;
  update public.trips set status = 'cancelled', ended_at = now() where status = 'active' and expires_at < now();
  delete from public.position_log where at < now() - interval '30 days';
  delete from public.op_log where at < now() - interval '60 days';
  delete from public.incoming_calls where at < now() - interval '1 day';
  delete from public.incoming_texts where at < now() - interval '7 days';
  delete from public.rate_limits where at < now() - interval '2 days';
  delete from public.push_subs p
   where not exists (select 1 from public.staff s where s.id = p.staff_id and s.active and s.deleted_at is null and 'owner' = any(s.roles));
  delete from public.activity where at < now() - interval '90 days' and action = 'web_robot';
  delete from public.activity where at < now() - interval '24 months' and action in ('insert', 'update', 'delete');
end $$;

-- ---------- shift_start (sql-foundation-29) ----------
-- The clean-up ran before the team check (any signed-in account could run it), a second tap before the first answer
-- hit the « one open day » rule as a raw database error, and a clean-up that failed stopped the day from starting.
create or replace function public.shift_start() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi.'); end if;
  begin
    perform public.housekeeping();
  exception when others then
    raise warning 'housekeeping: %', sqlerrm;
  end;
  insert into public.shifts (staff_id, created_by) values (auth.uid(), auth.uid())
  on conflict (staff_id) where ended_at is null and deleted_at is null do nothing;
  return jsonb_build_object('ok', true, 'rows', jsonb_build_object('shifts', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.shifts s where s.staff_id = auth.uid() and s.ended_at is null)));
end $$;

-- ---------- report_position: the job of a position is one still under way (sql-foundation-26) ----------
-- The phone sends no job once the work is finished; the row kept the last job for ever, so the map tied the person to
-- a finished job's truck. A job sent stays the position's job only while it is en route or on site.
create or replace function public.report_position(p_lat double precision, p_lng double precision, p_accuracy integer default null, p_heading integer default null, p_speed integer default null, p_job uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare last record; v_job uuid := p_job;
begin
  if not public.is_staff() then return jsonb_build_object('ok', false, 'reason', 'not_staff'); end if;
  if not exists (select 1 from public.shifts where staff_id = auth.uid() and ended_at is null and deleted_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'no_shift');
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then return jsonb_build_object('ok', false, 'reason', 'bad_position'); end if;
  if v_job is null then
    select po.job_id into v_job from public.positions po join public.jobs j on j.id = po.job_id
     where po.id = auth.uid() and j.status in ('en_route', 'on_site') and j.deleted_at is null;
  end if;
  insert into public.positions (id, lat, lng, accuracy_m, heading, speed_kmh, job_id, at, deleted_at)
  values (auth.uid(), p_lat, p_lng, p_accuracy, p_heading, p_speed, v_job, now(), null)
  on conflict (id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, heading = excluded.heading,
    speed_kmh = excluded.speed_kmh, job_id = excluded.job_id, at = now(), deleted_at = null;
  select l.lat, l.lng, l.at into last from public.position_log l where l.staff_id = auth.uid() order by l.at desc limit 1;
  if last is null or last.at < now() - interval '60 seconds' or public.km_between(last.lat, last.lng, p_lat, p_lng) >= 0.025 then
    insert into public.position_log (staff_id, lat, lng) values (auth.uid(), p_lat, p_lng);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================================================================
-- 4. « RÉSERVER EN LIGNE » (switched off on live since 2026-11-09; these are the rules it must have before it reopens)
-- =====================================================================================================================

-- what the visitor typed, kept on the job whatever file the job goes to: { first_name, last_name, email, city, lang,
-- vehicle { year, make, model }, match: 'new' | 'same' | 'shared' }
alter table public.jobs add column if not exists web_contact jsonb;

-- a name without accents, capitals or punctuation, to compare two names
create or replace function public.fold_name(s text) returns text language sql immutable as $$
  select nullif(trim(regexp_replace(translate(lower(coalesce(s, '')), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœ', 'aaaaaaceeeeiiiinooooouuuuyyo'), '[^a-z0-9]+', ' ', 'g')), '')
$$;
revoke all on function public.fold_name(text) from public, anon, authenticated;
grant execute on function public.fold_name(text) to service_role;

/* web_book(p): p = { first_name, last_name, phone, email?, lang, address, unit?, city?, postal_code?, lat, lng,
     vehicle: { year?, make?, model? }, services: [uuid], day, block, problem?, ip?, token_hash?, win_start?, win_flex? }
   The text of Part 25 (windows, car / truck, the brakes, « the same booking again ») with these rules changed:
   - the customer (sql-misc-01, -05, -06, audit A3): the same phone number AND the same first (or last) name is the
     same customer. The same number with another name is a NEW file, marked for the office (« même numéro qu'un autre
     client »): a phone number alone never puts a job on somebody's file. An existing file is never written: no e-mail,
     no car. A car is linked when the file already has it; a car is created only on a file made here.
   - what was typed is kept on the job (web_contact) and said in its notes when it differs from the file (who asked,
     the car announced, the e-mail given): the office sees it in the app as it is.
   - a day, a position or a year that is not one (sql-misc-13): refused in words (bad_block, far), never a raw error.
   Answer: as before, plus shared_phone. */
create or replace function public.web_book(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_first text := left(nullif(trim(p->>'first_name'), ''), 80);
  v_last text := left(nullif(trim(p->>'last_name'), ''), 80);
  v_digits text := right(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), 10);
  v_email text := lower(left(nullif(trim(p->>'email'), ''), 160));
  v_lang text := case when p->>'lang' = 'en' then 'en' else 'fr' end;
  v_addr text := left(nullif(trim(p->>'address'), ''), 200);
  v_lat double precision := case when trim(p->>'lat') ~ '^-?\d{1,3}(\.\d{1,20})?$' then trim(p->>'lat')::double precision end;
  v_lng double precision := case when trim(p->>'lng') ~ '^-?\d{1,3}(\.\d{1,20})?$' then trim(p->>'lng')::double precision end;
  v_day date;
  v_block text := p->>'block';
  v_hash text := left(nullif(trim(p->>'token_hash'), ''), 128);
  v_services uuid[];
  v_year_txt text := regexp_replace(coalesce(p->'vehicle'->>'year', ''), '\D', '', 'g');
  v_year int := case when v_year_txt ~ '^\d{1,4}$' then v_year_txt::int end;
  v_make text := left(nullif(trim(p->'vehicle'->>'make'), ''), 60);
  v_model text := left(nullif(trim(p->'vehicle'->>'model'), ''), 60);
  v_cust uuid; v_veh uuid; v_id uuid := gen_random_uuid(); v_dur int; b record; v_plan0 jsonb; v_plan1 jsonb; k int := 0; s record;
  v_new boolean := false; v_again uuid; v_again_cust uuid;
  -- the windows (Part 25)
  v_wm boolean := public.windows_on();
  v_ws int := case when p->>'win_start' ~ '^\d{1,4}$' then (p->>'win_start')::int end; v_we int;
  v_flex boolean := coalesce(p->>'win_flex', '') = 'true'; v_eta int; sp record; v_res jsonb;
  -- the customer's file and what was typed (Part 26)
  v_shared boolean := false; f record; v_note text; v_car text;
begin
  if not public.web_on() then perform public.fail('web_off', 'La réservation en ligne est fermée pour le moment. Appelez le garage.'); end if;
  if trim(p->>'day') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_day := trim(p->>'day')::date;
    exception when others then
      v_day := null;                                            -- « 2026-02-30 »: refused below as bad_block
    end;
  end if;
  if v_first is null then perform public.fail('name', 'Écrivez votre prénom.'); end if;
  if v_digits !~ '^[2-9]\d{2}[2-9]\d{6}$' then perform public.fail('phone', 'Écrivez un numéro de téléphone à 10 chiffres.'); end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public.fail('email', 'Ce courriel ne semble pas bon.'); end if;
  if v_addr is null or not public.web_in_area(v_lat, v_lng) then perform public.fail('far', 'Choisissez votre adresse dans la liste (dans notre secteur).'); end if;
  if v_year is not null and (v_year < 1950 or v_year > extract(year from public.local_today())::int + 2) then v_year := null; end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_services
    from jsonb_array_elements_text(case when jsonb_typeof(p->'services') = 'array' then p->'services' else '[]'::jsonb end) x
   where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  if cardinality(v_services) = 0 or cardinality(v_services) > 10
     or exists (select 1 from unnest(v_services) u where not exists (select 1 from jsonb_array_elements(public.web_services()) w where (w->>'id')::uuid = u)) then
    perform public.fail('no_service', 'Choisissez au moins un service de la liste.');
  end if;
  if v_wm then
    if v_block is not null and v_block <> 'day' then perform public.fail('bad_block', 'Choisissez une plage dans la liste.'); end if;
    v_block := 'day';
    if v_flex then v_ws := null; end if;
  else
    v_ws := null; v_flex := false;
  end if;
  select * into b from public.blocks() x where x.key = v_block;
  if not found or v_day is null then perform public.fail('bad_block', 'Choisissez une date dans la liste.'); end if;
  if not public.block_open(v_day, v_block) then
    perform public.fail('block_full', 'Ce moment n’est plus libre. Choisissez-en un autre.');
  end if;
  if v_day > public.local_today() + public.bset('horizon_days', 120)::int then perform public.fail('bad_block', 'Cette date est trop loin.'); end if;
  if v_ws is not null then
    select * into sp from public.day_span();
    v_we := v_ws + public.win_len();
    if v_ws < sp.start_min or v_we > greatest(sp.end_min, sp.start_min + public.win_len()) then perform public.fail('bad_block', 'Choisissez une plage dans la liste.'); end if;
    if v_day = public.local_today() and public.now_min() > v_we then perform public.fail('window_full', 'Cette plage n’est plus libre. Choisissez-en une autre.'); end if;
  end if;

  -- one customer at a time per phone number (the brakes and the « again » check are counted under this lock)
  perform pg_advisory_xact_lock(hashtext('web:' || v_digits));

  -- the same booking sent again (the page retried after a hiccup): the job already made, never a second one
  select j.id, j.customer_id into v_again, v_again_cust from public.jobs j join public.customers c on c.id = j.customer_id
  where c.phone_digits = v_digits and j.source = 'web' and j.status = 'booked' and j.deleted_at is null
    and j.day = v_day and j.block = v_block and lower(coalesce(j.address, '')) = lower(v_addr) and j.created_at > now() - interval '10 minutes'
    and (select coalesce(array_agg(ji.service_id order by ji.service_id), '{}'::uuid[]) from public.job_items ji
         where ji.job_id = j.id and ji.deleted_at is null and ji.service_id is not null)
        = (select array_agg(u order by u) from unnest(v_services) u)
  order by j.created_at desc limit 1;
  if v_again is not null then
    if v_hash is not null then
      insert into public.public_links (token_hash, job_id, quote_id, expires_at, created_by) values (v_hash, v_again, null, now() + interval '90 days', null)
      on conflict (token_hash) do nothing;
    end if;
    v_res := jsonb_build_object('ok', true, 'job_id', v_again, 'customer_id', v_again_cust, 'new_customer', false, 'day', v_day, 'block', v_block, 'again', true);
    if v_wm then
      v_res := v_res || (select jsonb_build_object('win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex) from public.jobs j where j.id = v_again);
    end if;
    return v_res;
  end if;

  -- a brake on mistakes and pranks: 2 coming appointments booked online per phone number, 30 an hour in all
  if (select count(*) from public.jobs j join public.customers c on c.id = j.customer_id
      where c.phone_digits = v_digits and j.source = 'web' and j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today()) >= 2 then
    perform public.fail('too_many', 'Vous avez déjà des rendez-vous à venir. Pour en ajouter, appelez le garage.');
  end if;
  perform pg_advisory_xact_lock(hashtext('web:all'));
  if (select count(*) from public.jobs j where j.source = 'web' and j.created_at > now() - interval '1 hour') >= 30 then
    perform public.fail('busy', 'Trop de réservations en même temps. Réessayez dans quelques minutes ou appelez le garage.');
  end if;

  v_dur := public.web_duration(v_services);
  perform public.lock_block(v_day, v_block);
  v_plan0 := public.plan_block(v_day, v_block);
  v_plan1 := public.plan_block(v_day, v_block, jsonb_build_object('id', v_id, 'lat', v_lat, 'lng', v_lng, 'dur', v_dur,
    'need', exists (select 1 from public.services sv where sv.id = any(v_services) and sv.needs_machine), 'kind', null)
    || case when v_wm then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end);
  if jsonb_array_length(v_plan1->'trucks') = 0
     or not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o))
     or public.plan_late_new(v_plan0, v_plan1)
     or exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_plan1->'extra'->>'truck' and (x->>'left')::int < 0) then
    if v_ws is not null then perform public.fail('window_full', 'Cette plage vient d’être prise. Choisissez-en une autre.'); end if;
    perform public.fail('block_full', 'Ce moment vient d’être pris. Choisissez-en un autre.');
  end if;

  perform set_config('garage.rpc', 'on', true);
  -- the customer: the same phone number AND the same first (or last) name; that file is never changed from here
  select c.id, c.first_name, c.last_name, c.company, c.email into f from public.customers c
  where c.phone_digits = v_digits and c.deleted_at is null
    and (public.fold_name(c.first_name) = public.fold_name(v_first)
      or (v_last is not null and public.fold_name(c.last_name) = public.fold_name(v_last)))
  order by c.updated_at desc limit 1;
  if found then
    v_cust := f.id;
  else
    v_new := true;
    -- the same number on another person's file: a new file, for the office to check (never a job on that other file)
    v_shared := exists (select 1 from public.customers c where c.phone_digits = v_digits and c.deleted_at is null);
    insert into public.customers (first_name, last_name, phone, email, lang, address, unit, city, postal_code, lat, lng, notes, created_by)
    values (v_first, v_last, substr(v_digits, 1, 3) || ' ' || substr(v_digits, 4, 3) || '-' || substr(v_digits, 7), v_email, v_lang, v_addr,
      left(nullif(trim(p->>'unit'), ''), 20), left(nullif(trim(p->>'city'), ''), 80), left(nullif(trim(p->>'postal_code'), ''), 10), v_lat, v_lng,
      case when v_shared then 'Client créé par la réservation en ligne. Même numéro de téléphone qu’un autre client : à vérifier (fusionner au besoin).'
           else 'Client créé par la réservation en ligne.' end, null)
    returning id into v_cust;
  end if;
  -- the car: the one the file already has; a car is created only on a file made here
  if v_make is not null or v_model is not null then
    select v.id into v_veh from public.vehicles v where v.customer_id = v_cust and v.deleted_at is null
      and lower(coalesce(v.make, '')) = lower(coalesce(v_make, '')) and lower(coalesce(v.model, '')) = lower(coalesce(v_model, ''))
      and (v_year is null or v.year is null or v.year = v_year)
      order by v.updated_at desc limit 1;
    if v_veh is null and v_new then
      insert into public.vehicles (customer_id, year, make, model, created_by) values (v_cust, v_year, v_make, v_model, null) returning id into v_veh;
    end if;
  end if;
  -- what the office reads on the job: who asked when it is not the name of the file, the car and the e-mail the file
  -- does not have
  v_car := nullif(concat_ws(' ', v_year::text, v_make, v_model), '');
  v_note := case
      when v_shared then 'Réservé en ligne par le client (même numéro qu’un autre client : vérifier le dossier).'
      when not v_new and public.fold_name(f.first_name) is distinct from public.fold_name(v_first)
        then format('Réservé en ligne par %s (le dossier est au nom de %s).', concat_ws(' ', v_first, v_last),
                    coalesce(nullif(concat_ws(' ', nullif(trim(f.first_name), ''), nullif(trim(f.last_name), '')), ''), nullif(trim(f.company), ''), '—'))
      else 'Réservé en ligne par le client.' end
    || case when v_veh is null and v_car is not null then format(' Auto annoncée : %s (pas au dossier).', v_car) else '' end
    || case when not v_new and v_email is not null and lower(coalesce(f.email, '')) <> v_email then format(' Courriel donné : %s.', v_email) else '' end;

  insert into public.jobs (id, customer_id, vehicle_id, day, block, truck_id, truck_pinned, forced, duration_min, status, problem, notes,
    address, unit, postal_code, lat, lng, source, created_by, win_start, win_end, win_flex, web_contact)
  values (v_id, v_cust, v_veh, v_day, v_block, (v_plan1->'extra'->>'truck')::uuid, false, false, v_dur, 'booked',
    left(nullif(trim(p->>'problem'), ''), 1000), v_note, v_addr, left(nullif(trim(p->>'unit'), ''), 20),
    left(nullif(trim(p->>'postal_code'), ''), 10), v_lat, v_lng, 'web', null, v_ws, v_we, v_flex,
    jsonb_strip_nulls(jsonb_build_object('first_name', v_first, 'last_name', v_last, 'email', v_email, 'lang', v_lang,
      'city', left(nullif(trim(p->>'city'), ''), 80),
      'vehicle', case when v_car is not null then jsonb_build_object('year', v_year, 'make', v_make, 'model', v_model) end,
      'match', case when v_shared then 'shared' when v_new then 'new' else 'same' end)));
  for s in select sv.* from public.services sv where sv.id = any(v_services) order by sv.is_promo desc, sv.sort, sv.name_fr loop
    k := k + 1;
    insert into public.job_items (job_id, kind, service_id, description, qty, unit_cents, taxable, duration_min, status, sort, created_by)
    values (v_id, 'service', s.id, case when v_lang = 'en' then coalesce(nullif(s.name_en, ''), s.name_fr) else s.name_fr end, 1,
      coalesce(s.price_cents, 0), s.taxable, s.duration_min, 'planned', k, null);
  end loop;
  -- the customer's link, in the same transaction as the booking
  if v_hash is not null then
    insert into public.public_links (token_hash, job_id, quote_id, expires_at, created_by) values (v_hash, v_id, null, now() + interval '90 days', null);
  end if;
  perform public.apply_plan(v_plan1);
  if v_wm and v_ws is null and (not v_flex or public.win_lock_due(v_day)) then
    perform set_config('garage.rpc', 'on', true);
    select j.eta_min into v_eta from public.jobs j where j.id = v_id;
    update public.jobs set win_start = w.win_start, win_end = w.win_end from public.win_for(v_eta) w where id = v_id;
  end if;
  insert into public.activity (entity, entity_id, action, data)
  values ('job', v_id, 'web_booked', jsonb_build_object('customer_new', v_new, 'shared_phone', v_shared, 'ip', left(p->>'ip', 64)));
  v_res := jsonb_build_object('ok', true, 'job_id', v_id, 'customer_id', v_cust, 'new_customer', v_new, 'shared_phone', v_shared,
    'day', v_day, 'block', v_block, 'again', false);
  if v_wm then
    v_res := v_res || (select jsonb_build_object('win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex) from public.jobs j where j.id = v_id);
  end if;
  return v_res;
end $$;

-- =====================================================================================================================
-- 6. INDEXES (before the grants: nothing below depends on them)
-- =====================================================================================================================
create index if not exists jobs_vehicle on public.jobs(vehicle_id) where vehicle_id is not null;   -- vin_history, the car's visits
create index if not exists quotes_customer on public.quotes(customer_id);                         -- customer_visible (row rule of customers, notes, cars)
create index if not exists trips_job on public.trips(job_id);                                     -- public_track by the appointment link, trips_read
create index if not exists trips_staff on public.trips(staff_id);                                 -- close_day, shift_end, trips_read
create index if not exists public_links_job on public.public_links(job_id);                       -- the links of a job (revoked when its customer changes)
create index if not exists payments_job on public.payments(job_id) where job_id is not null;      -- payments waiting on a job, payment_visible
create index if not exists op_log_at on public.op_log(at);                                        -- housekeeping (60 days)
create index if not exists invoices_job on public.invoices(job_id);                               -- invoice_visible / payment_visible (the row rules of invoices, payments)
create index if not exists inventory_moves_job on public.inventory_moves(job_id) where job_id is not null;  -- use_parts, the parts of a job
create index if not exists job_items_service on public.job_items(service_id) where service_id is not null; -- a service's lines (web_book « again », reports)
create index if not exists job_items_item on public.job_items(item_id) where item_id is not null; -- an item's lines (inventory_delete)
create index if not exists messages_customer on public.messages(customer_id);                     -- the texts of a customer
create index if not exists rate_limits_at on public.rate_limits(at);                              -- housekeeping (2 days)

-- =====================================================================================================================
-- 5. WHO MAY CALL WHAT (audit D1, x-security-20, sql-foundation-18)
-- =====================================================================================================================
-- Postgres lets everyone (PUBLIC, so the public key too) run a new function unless its migration says otherwise, and a
-- revoke « in schema public » cannot take that away: only discipline kept the functions closed (four lists of names
-- copied from file to file, two trigger functions forgotten).
--   a) nobody runs a function through PUBLIC any more;
--   b) every function that existed before tonight is closed to the public key and to the app, then opened by name:
--      the list below is exactly what the app calls and what the row rules, the guards and the non-definer functions
--      need to run as the signed-in person (tests/db/refonte-droits.test.mjs keeps the same list and fails on any
--      difference). A function made tonight by another migration keeps the grants its own migration gave it;
--   c) from now on a function, a table or a sequence made by a migration is closed to the public key and to the app
--      until that migration opens it (grant … to authenticated).
do $grants$
declare
  f record;
  -- every function of the database as it was before tonight, and the ones this migration makes
  v_known text[] := array[
    'access_of','all_rights','apply_hours','apply_plan','block_open','block_pos','block_rows','blocks','blocks_overview','blocks_set',
    'book_job','bset','by_person','can','close_day','coffre_add','coffre_may_add','coffre_remove','coffre_report','customer_visible',
    'customers_replan_on_position','dashboard','day_drive','day_path','day_span','drive_min','durs_of','extra_answer','fail','has_role',
    'home_point','housekeeping','inventory_apply_move','inventory_buy','inventory_delete','inventory_guard','inventory_pool_fixed',
    'invoice_editable','invoice_finish','invoice_for_job','invoice_reopen','invoice_totals','invoice_visible','invoice_void',
    'invoices_guard','invoices_no_coffre','is_field','is_owner','is_staff','items_need_machine','job_actor','job_customer',
    'job_id_visible','job_invoice','job_item_price','job_items_editable','job_items_invoice_follow','job_items_machine','job_lines',
    'job_paid','job_payload','job_step','job_visible','jobs_kind_follow','jobs_km_follow','jobs_manual_order_reset',
    'jobs_replan_on_position','jobs_waiver_via','km_between','local_now','local_today','lock_block','lock_two','lock_windows',
    'lock_windows_core','lock_windows_due','log_activity','me','member_update','move_job','my_access','my_truck_ids','now_min',
    'op_begin','op_done','op_save','payment_add','payment_remove','payment_visible','plan_block','plan_fits','plan_inputs',
    'plan_late_new','public_track','qty_text','ranges_first','ranges_from','ranges_norm','ranges_norm_trg','ranges_overlap','rate_hit',
    'remove_member','replan_after_hours','replan_block','replan_days','report_position','right_default','right_of','right_rule',
    'rights_table','route_improve','route_min','route_min_to','route_walk','sees_calls','set_job_duration','set_role_rights',
    'set_stop_order','set_truck_start','settings_guard','settings_replan','settings_windows_guard','shift_end','shift_start',
    'staff_calls_guard','suggest_blocks','suggest_core','suggest_windows','suggest_windows_core','team_map','touch','treasury_report',
    'truck_home','truck_hours_editable','truck_ranges','trucks_kind_keep','update_me','use_parts','vin_history','walk_in','web_book',
    'web_duration','web_in_area','web_on','web_services','web_suggest','web_windows','win_for','win_len','win_lock_due','windows_on',
    'windows_switch','words_need_machine',
    'customers_delete_guard','push_subs_takeover','settings_web_guard','web_switch','right_flag','fold_name',
    'customers_phone_links'];
  -- the signed-in app: its operations and reads…
  v_app text[] := array[
    'access_of','apply_hours','blocks_overview','book_job','coffre_add','coffre_remove','coffre_report','dashboard','day_path',
    'extra_answer','inventory_buy','inventory_delete','invoice_finish','invoice_for_job','invoice_reopen','invoice_void',
    'job_customer','job_item_price','job_step','lock_windows','member_update','move_job','my_access','payment_add','payment_remove',
    'public_track','report_position','rights_table','set_job_duration','set_role_rights','set_stop_order','set_truck_start',
    'shift_end','shift_start','suggest_blocks','suggest_windows','team_map','treasury_report','update_me','vin_history','walk_in',
    'web_switch','windows_switch',
    -- … and what the row rules, the guards and the functions that run as the person call
    'all_rights','block_pos','blocks','bset','by_person','can','coffre_may_add','customer_visible','fail','has_role','home_point',
    'invoice_editable','invoice_visible','is_field','is_owner','is_staff','items_need_machine','job_actor','job_id_visible',
    'job_items_editable','job_visible','km_between','local_now','local_today','me','my_truck_ids','now_min','payment_visible',
    'ranges_first','ranges_from','ranges_norm','ranges_overlap','right_default','right_of','right_rule','sees_calls',
    'truck_hours_editable','truck_ranges','words_need_machine'];
  -- the public key (the customer's tracking page): one function
  v_anon text[] := array['public_track'];
begin
  revoke execute on all functions in schema public from public;
  grant execute on all functions in schema public to service_role;
  for f in select p.oid::regprocedure as sig, p.proname as name from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.proname = any(v_known)
  loop
    execute format('revoke all on function %s from anon, authenticated', f.sig);
    if f.name = any(v_app) then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if f.name = any(v_anon) then execute format('grant execute on function %s to anon', f.sig); end if;
  end loop;
end $grants$;

-- closed by default from now on (the role that runs the migrations). Functions only: the tables keep Supabase's own
-- defaults tonight (every table has row level security on and its grants written; closing them by default too is a
-- decision for after the merge, when no other migration of tonight still counts on them).
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
