-- Part 22: « Coffre » by the mechanic too.
-- Part 20 let only the owner put jobs in the Coffre; the mechanic who collects at the door needs it too. coffre_add now
-- takes: the owner, or a person whose trucks do every one of the jobs (the driver of the job's truck). Taking an entry
-- back out (coffre_remove) and reading the Coffre (coffre_report) stay as they were (owner; owner and « Trésorerie »).
create or replace function public.coffre_may_add(p_jobs uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or (public.is_staff() and cardinality(coalesce(p_jobs, '{}')) > 0
          and not exists (select 1 from public.jobs j where j.id = any(p_jobs)
                          and (j.truck_id is null or not (j.truck_id = any(public.my_truck_ids())))))
$$;
revoke all on function public.coffre_may_add(uuid[]) from public, anon;
grant execute on function public.coffre_may_add(uuid[]) to authenticated;

do $do$
declare v_src text;
begin
  select pg_get_functiondef('public.coffre_add(uuid, uuid[], int, text, date)'::regprocedure) into v_src;
  if position('if not public.is_owner() then perform public.fail(''not_allowed'', ''Seul le propriétaire met des jobs au Coffre.''); end if;' in v_src) = 0 then
    raise exception 'coffre_add is not the Part 20 version';
  end if;
  v_src := replace(v_src,
    'if not public.is_owner() then perform public.fail(''not_allowed'', ''Seul le propriétaire met des jobs au Coffre.''); end if;',
    'if not public.coffre_may_add(p_jobs) then perform public.fail(''not_allowed'', ''Seuls le propriétaire et le mécano du camion mettent ces jobs au Coffre.''); end if;');
  execute v_src;
end $do$;
