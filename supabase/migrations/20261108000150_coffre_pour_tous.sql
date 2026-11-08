-- Part 24 bis: « Payé par le Coffre » for every member of the team.
-- Part 20 let only the owner put jobs in the Coffre, Part 22 added the mechanic of the job's truck; the office and the
-- accountant take those payments too. coffre_may_add now says yes to anyone signed in on the team (with at least one
-- job to put). Taking an entry back out (coffre_remove) and reading the Coffre (coffre_report) stay as they were.
create or replace function public.coffre_may_add(p_jobs uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() and cardinality(coalesce(p_jobs, '{}')) > 0
$$;
revoke all on function public.coffre_may_add(uuid[]) from public, anon;
grant execute on function public.coffre_may_add(uuid[]) to authenticated, service_role;

-- the refusal of coffre_add now only meets an account that is not on the team: its words follow (same patch as Part 22)
do $do$
declare v_src text;
begin
  select pg_get_functiondef('public.coffre_add(uuid, uuid[], int, text, date)'::regprocedure) into v_src;
  if position('Seuls le propriétaire et le mécano du camion mettent ces jobs au Coffre.' in v_src) > 0 then
    v_src := replace(v_src, 'Seuls le propriétaire et le mécano du camion mettent ces jobs au Coffre.', 'Connecte-toi avec ton compte de l’équipe pour mettre des jobs au Coffre.');
    execute v_src;
  end if;
end $do$;
