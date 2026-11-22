-- Part 28 on today's live database: THE TRY (everything is undone; the expected answer is the error « ESSAI OK … »).
-- Replace <C> (the pushed commit of branch reorganiser = C28) and <SHA256> (shasum -a 256 of the file at <C>).
-- Before: Part 27 is there (20261119000200), Part 28 is not. Then, in ONE transaction always undone: the file downloaded
-- and checked, lock_timeout 5 s, the planner's answers of the next 14 days computed, the migration applied (it ends with
-- told_install()), the same answers computed again (Part 28 adds; the planner must answer exactly the same), the counts of
-- customers, appointments, invoices and payments the same (it writes no row of them: it only fills the new columns), then
-- what told_install marked and who is still to tell, day by day. « ARRÊT : … » or any other error: stop, nothing changed.
do $do$
declare r record; body text; sha text; v_before jsonb; v_after jsonb; v_diff jsonb; v_n int; v_c0 jsonb; v_c1 jsonb;
  v_marked int; v_never int; v_due int; v_days int; v_per jsonb;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261119000200') then
    raise exception 'ARRÊT : la Partie 27 (20261119000200) n''est pas en ligne : elle passe avant';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261122000100') then
    raise exception 'ARRÊT : la Partie 28 (20261122000100) est déjà en ligne';
  end if;
  select * into r from extensions.http_get('https://raw.githubusercontent.com/hostnextline/garage2.0/<C>/supabase/migrations/20261122000100_reorganiser.sql');
  if r.status <> 200 then raise exception 'téléchargement : %', r.status; end if;
  body := r.content;
  sha := encode(extensions.digest(convert_to(body, 'UTF8'), 'sha256'), 'hex');
  if sha <> '<SHA256>' then raise exception 'sha différent : %', sha; end if;
  perform set_config('lock_timeout', '5s', true);
  v_c0 := jsonb_build_object('clients', (select count(*) from public.customers), 'rendez_vous', (select count(*) from public.jobs),
    'factures', (select count(*) from public.invoices), 'paiements', (select count(*) from public.payments));
  v_before := (select jsonb_object_agg(k, v) from (
      select 'plan ' || dd.d || ' ' || b.key as k, public.plan_block(dd.d, b.key) as v
        from generate_series(public.local_today(), public.local_today() + 13, interval '1 day') g(t)
        cross join lateral (select g.t::date as d) dd cross join public.blocks() b) q);
  execute body;
  v_after := (select jsonb_object_agg(k, v) from (
      select 'plan ' || dd.d || ' ' || b.key as k, public.plan_block(dd.d, b.key) as v
        from generate_series(public.local_today(), public.local_today() + 13, interval '1 day') g(t)
        cross join lateral (select g.t::date as d) dd cross join public.blocks() b) q);
  v_c1 := jsonb_build_object('clients', (select count(*) from public.customers), 'rendez_vous', (select count(*) from public.jobs),
    'factures', (select count(*) from public.invoices), 'paiements', (select count(*) from public.payments));
  select count(*)::int, coalesce(jsonb_agg(k order by k) filter (where v_before->k is distinct from v_after->k), '[]'::jsonb)
    into v_n, v_diff from jsonb_object_keys(coalesce(v_before, '{}'::jsonb)) k;
  if v_c1 is distinct from v_c0 then raise exception 'ARRÊT : les nombres ont changé : % → %', v_c0, v_c1; end if;
  if jsonb_array_length(v_diff) > 0 then
    raise exception 'ARRÊT : la migration change % réponses du planificateur sur % : %', jsonb_array_length(v_diff), v_n, v_diff;
  end if;
  if public.roads_on() then raise exception 'ARRÊT : roads_on vrai après la migration'; end if;
  -- what told_install marked (told_how 'install'), who stays never told, and who is to tell (new / changed), day by day
  select count(*)::int into v_marked from public.jobs where told_how = 'install';
  select count(*)::int into v_never from public.jobs j
   where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today() and j.told_at is null;
  with q as (select x.d, coalesce(j.customer_id::text, j.id::text) who
               from public.jobs j cross join lateral (values (j.day), (j.told_day)) x(d)
              where j.status = 'booked' and j.deleted_at is null and x.d >= public.local_today()
                and public.tell_state(j) in ('new', 'changed'))
  select (select count(distinct q.who)::int from q), (select count(distinct q.d)::int from q),
         (select coalesce(jsonb_object_agg(z.d, z.n), '{}'::jsonb) from (select q.d, count(distinct q.who) n from q group by q.d) z)
    into v_due, v_days, v_per;
  raise exception 'ESSAI OK : reorganiser (rien n''est gardé) ; % rendez-vous marqués avertis, % clients à avertir sur % jours (% rendez-vous jamais avertis ; par jour : % ; % réponses du planificateur comparées, toutes les mêmes)',
    v_marked, v_due, v_days, v_never, v_per, v_n;
end $do$;
