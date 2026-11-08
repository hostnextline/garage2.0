-- Part 24 quater: the parts really used, and an inventory item removed for good.
--   use_parts(job, parts)   « Terminer la job » now brings the list the mechanic confirmed on the spot (p_data.parts =
--                           [{item_id, qty}]): those quantities leave the inventory, nothing else. Without a list (an
--                           older app), the parts planned for the job's services leave as before. Once per job.
--   job_step                hands p_data->'parts' to use_parts
--   inventory_delete        an item deleted with no trace (its moves and its links to services go with it; a job's
--                           line that pointed to it keeps its words, loses the link): the inventory right, or the owner
drop function if exists public.use_parts(uuid);
create or replace function public.use_parts(p_job uuid, p_parts jsonb default null) returns void language plpgsql security definer set search_path = public as $$
declare v_note text := 'Job ' || (select number from public.jobs where id = p_job);
begin
  if exists (select 1 from public.inventory_moves where job_id = p_job and reason = 'used' and deleted_at is null) then return; end if;
  if p_parts is not null and jsonb_typeof(p_parts) = 'array' then
    insert into public.inventory_moves (item_id, delta, reason, job_id, note, created_by)
    select it.id, -x.qty, 'used', p_job, v_note, auth.uid()
    from (
      select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::numeric) as qty
      from jsonb_array_elements(p_parts) e
      where (e->>'item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and (e->>'qty') ~ '^[0-9]+(\.[0-9]+)?$'
      group by 1
    ) x
    join public.inventory_items it on it.id = x.item_id and it.deleted_at is null
    where x.qty > 0;
    return;
  end if;
  insert into public.inventory_moves (item_id, delta, reason, job_id, note, created_by)
  select x.item_id, -sum(x.qty), 'used', p_job, v_note, auth.uid()
  from (
    select i.item_id, i.qty from public.job_items i
    where i.job_id = p_job and i.deleted_at is null and i.item_id is not null and i.status in ('planned','done','approved')
    union all
    select sp.item_id, sp.qty * i.qty from public.job_items i join public.service_parts sp on sp.service_id = i.service_id and sp.deleted_at is null
    where i.job_id = p_job and i.deleted_at is null and i.status in ('planned','done','approved')
  ) x
  join public.inventory_items it on it.id = x.item_id and it.deleted_at is null
  group by x.item_id;
end $$;
revoke execute on function public.use_parts(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.use_parts(uuid, jsonb) to service_role;

-- job_step: « finish » hands the confirmed list over (the function is long: its one line changes, the rest stays as it is)
do $do$
declare v_src text;
begin
  select pg_get_functiondef('public.job_step(uuid, uuid, text, jsonb)'::regprocedure) into v_src;
  if position('perform public.use_parts(j.id, p_data->''parts'');' in v_src) > 0 then return; end if;
  if position('perform public.use_parts(j.id);' in v_src) = 0 then raise exception 'job_step: use_parts call not found'; end if;
  v_src := replace(v_src, 'perform public.use_parts(j.id);', 'perform public.use_parts(j.id, p_data->''parts'');');
  execute v_src;
end $do$;

-- an item gone for good
create or replace function public.inventory_delete(p_op uuid, p_item uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); v_name text;
begin
  if v_done is not null then return v_done; end if;
  if not (public.is_owner() or public.can('inventory')) then perform public.fail('not_allowed', 'Tu n’as pas le droit de changer l’inventaire.'); end if;
  select name into v_name from public.inventory_items where id = p_item;
  if v_name is null then perform public.fail('not_found', 'Cet article n’existe plus.'); end if;
  perform set_config('garage.rpc', 'on', true);
  -- its moves and its links to services go with it (foreign keys); a job's line that pointed to it keeps its words
  delete from public.inventory_items where id = p_item;
  return public.op_save(p_op, 'inventory_delete', jsonb_build_object('ok', true, 'id', p_item, 'name', v_name));
end $$;
revoke all on function public.inventory_delete(uuid, uuid) from public, anon;
grant execute on function public.inventory_delete(uuid, uuid) to authenticated, service_role;
