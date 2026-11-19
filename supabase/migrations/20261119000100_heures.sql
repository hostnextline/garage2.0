-- Part 26: « Heures » (#/timesheet): the hours worked by each person, from « Commencer / Terminer ma journée » (shifts).
--   A person sees their own days; the owners and the treasurer (« treasurer » role) see everyone's and correct them:
--   shift_save    changes the start and the end of a day (a forgotten « Terminer ma journée » that the night's housekeeping
--                 closed at 3 h 17), or adds a day that was never started; shift_remove takes out a day started by mistake.
--   Every correction is kept: who and when on the row (fixed_by, fixed_at), the before / after in `activity`.
--   Nothing else changes: the button, the night's housekeeping and the map work as before.

alter table public.shifts add column if not exists fixed_by uuid references public.staff(id) on delete set null;
alter table public.shifts add column if not exists fixed_at timestamptz;

-- the people who see and correct everyone's hours
create or replace function public.hours_all() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('owner') or public.has_role('treasurer')
$$;

-- reading: your own days; the map's people (who is on the road); the owners and the treasurer
drop policy if exists shifts_read on public.shifts;
create policy shifts_read on public.shifts for select to authenticated
  using (staff_id = auth.uid() or public.can('map') or public.hours_all());

/* shift_save(op, shift, staff, start, end)
   shift given: its start and end change (a day still open keeps no end: it ends with « Terminer ma journée »);
   shift null: a day is added for staff (start and end both needed). */
create or replace function public.shift_save(p_op uuid, p_shift uuid, p_staff uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb := public.op_done(p_op);
  s public.shifts;
  v_id uuid;
  v_staff uuid;
  v_open boolean := false;
begin
  if v_done is not null then return v_done; end if;
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi.'); end if;
  if not public.hours_all() then perform public.fail('not_allowed', 'Seuls les propriétaires et le trésorier corrigent les heures.'); end if;
  if p_shift is not null then
    select * into s from public.shifts where id = p_shift and deleted_at is null for update;
    if not found then perform public.fail('no_shift_row', 'Cette journée n’existe plus. Recharge la page.'); end if;
    v_staff := s.staff_id;
    v_open := s.ended_at is null;
  else
    v_staff := p_staff;
    if v_staff is null or not exists (select 1 from public.staff where id = v_staff and deleted_at is null) then
      perform public.fail('no_staff', 'Cette personne ne fait plus partie de l’équipe.');
    end if;
  end if;
  if p_start is null then perform public.fail('bad_hours', 'Écris l’heure du début.'); end if;
  if v_open and p_end is not null then
    perform public.fail('still_open', 'Cette journée est encore ouverte : elle finit quand la personne appuie sur « Terminer ma journée ».');
  end if;
  if not v_open and p_end is null then perform public.fail('bad_hours', 'Écris l’heure de la fin.'); end if;
  if p_end is not null and p_end <= p_start then perform public.fail('bad_hours', 'La fin doit être après le début.'); end if;
  if p_end is not null and p_end - p_start > interval '24 hours' then perform public.fail('too_long', 'Une journée ne peut pas dépasser 24 heures.'); end if;
  if p_start > now() or p_end > now() + interval '5 minutes' then perform public.fail('future', 'Cette heure n’est pas encore passée.'); end if;
  if exists (select 1 from public.shifts o where o.staff_id = v_staff and o.deleted_at is null and o.id is distinct from p_shift
             and tstzrange(o.started_at, coalesce(o.ended_at, 'infinity')) && tstzrange(p_start, coalesce(p_end, 'infinity'))) then
    perform public.fail('overlap', 'Ces heures chevauchent une autre journée de cette personne.');
  end if;

  if p_shift is not null then
    v_id := p_shift;
    if s.started_at is distinct from p_start or s.ended_at is distinct from p_end then
      update public.shifts set started_at = p_start, ended_at = p_end, fixed_by = auth.uid(), fixed_at = now() where id = v_id;
      insert into public.activity (actor, entity, entity_id, action, data)
      values (auth.uid(), 'shifts', v_id, 'hours_fix', jsonb_build_object('staff', v_staff,
        'before', jsonb_build_array(s.started_at, s.ended_at), 'after', jsonb_build_array(p_start, p_end)));
    end if;
  else
    v_id := gen_random_uuid();
    insert into public.shifts (id, staff_id, started_at, ended_at, created_by, fixed_by, fixed_at)
    values (v_id, v_staff, p_start, p_end, auth.uid(), auth.uid(), now());
    insert into public.activity (actor, entity, entity_id, action, data)
    values (auth.uid(), 'shifts', v_id, 'hours_add', jsonb_build_object('staff', v_staff, 'after', jsonb_build_array(p_start, p_end)));
  end if;
  return public.op_save(p_op, 'shift_save', jsonb_build_object('ok', true, 'id', v_id, 'rows', jsonb_build_object(
    'shifts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.shifts x where x.id = v_id))));
end $$;

-- shift_remove(op, shift): a day started by mistake goes out of the hours (kept in the database, marked deleted)
create or replace function public.shift_remove(p_op uuid, p_shift uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); s public.shifts;
begin
  if v_done is not null then return v_done; end if;
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi.'); end if;
  if not public.hours_all() then perform public.fail('not_allowed', 'Seuls les propriétaires et le trésorier corrigent les heures.'); end if;
  select * into s from public.shifts where id = p_shift and deleted_at is null for update;
  if not found then perform public.fail('no_shift_row', 'Cette journée n’existe plus. Recharge la page.'); end if;
  if s.ended_at is null then
    perform public.fail('still_open', 'Cette journée est encore ouverte : elle finit quand la personne appuie sur « Terminer ma journée ».');
  end if;
  update public.shifts set deleted_at = now(), fixed_by = auth.uid(), fixed_at = now() where id = p_shift;
  insert into public.activity (actor, entity, entity_id, action, data)
  values (auth.uid(), 'shifts', p_shift, 'hours_remove', jsonb_build_object('staff', s.staff_id, 'before', jsonb_build_array(s.started_at, s.ended_at)));
  return public.op_save(p_op, 'shift_remove', jsonb_build_object('ok', true, 'rows', jsonb_build_object(
    'shifts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.shifts x where x.id = p_shift))));
end $$;

-- ---------- rights ----------
revoke all on function public.hours_all() from public, anon;
grant execute on function public.hours_all() to authenticated, service_role;
revoke all on function public.shift_save(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.shift_save(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.shift_remove(uuid, uuid) from public, anon;
grant execute on function public.shift_remove(uuid, uuid) to authenticated, service_role;
