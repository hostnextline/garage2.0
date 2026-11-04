-- Part 12: changing a truck's hours sends back the hours it changed, so the screen updates at once
-- (the jobs of those days are re-planned by the database and arrive with the next refresh).
create or replace function public.apply_hours(p_op uuid, p_truck uuid, p_mode text, p_week jsonb, p_from date, p_weeks int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); d date; k text; v jsonb; n int := 0; v_end date; v_start timestamptz := now();
begin
  if v_done is not null then return v_done; end if;
  if not public.truck_hours_editable(p_truck) then perform public.fail('not_allowed', 'Tu ne peux pas changer l’horaire de ce camion.'); end if;
  if p_mode not in ('day','weeks','always') then perform public.fail('bad_mode', 'Choisis : aujourd’hui seulement, pendant quelques semaines ou en permanence.'); end if;
  p_from := greatest(coalesce(p_from, public.local_today()), public.local_today());
  if p_mode = 'always' then
    for k, v in select * from jsonb_each(p_week) loop
      insert into public.truck_week (truck_id, dow, ranges) values (p_truck, k::int, v)
      on conflict (truck_id, dow) do update set ranges = excluded.ranges, deleted_at = null;
      -- days changed earlier for the coming weeks give way to the new usual week
      update public.truck_days set deleted_at = now() where truck_id = p_truck and day >= p_from and extract(dow from day)::int = k::int and deleted_at is null;
      n := n + 1;
    end loop;
  else
    v_end := case when p_mode = 'day' then p_from else p_from + (greatest(1, least(p_weeks, 52)) * 7) - 1 end;
    for d in select generate_series(p_from, v_end, interval '1 day')::date loop
      v := p_week -> (extract(dow from d)::int)::text;
      if v is null then continue; end if;
      insert into public.truck_days (truck_id, day, ranges) values (p_truck, d, v)
      on conflict (truck_id, day) do update set ranges = excluded.ranges, deleted_at = null;
      n := n + 1;
    end loop;
  end if;
  return public.op_save(p_op, 'apply_hours', jsonb_build_object('ok', true, 'changed', n, 'rows', jsonb_build_object(
    'truck_week', (select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) from public.truck_week w where w.truck_id = p_truck),
    'truck_days', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.truck_days x where x.truck_id = p_truck and x.updated_at >= v_start))));
end $$;
