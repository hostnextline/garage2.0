-- Part 29 on today's live database: THE TRY (everything is undone; the expected answer is the error « ESSAI OK … »).
-- Replace <C> (the pushed commit of branch reorganiser = C29) and <SHA256> (shasum -a 256 of the file at <C>).
-- Before: Part 28 is there (20261122000100), Part 29 is not. Then, in ONE transaction always undone: the file downloaded
-- and checked, lock_timeout 5 s, the planner's answers of the next 14 days computed, the migration applied, the same answers
-- computed again (Part 29 changes the SAVE and the guard of the automatic re-plans, never the planner: every answer must be
-- the same), the counts of customers, appointments, invoices and payments the same (it writes no row), the three functions
-- made again and still the server's own; then what it will do on live: the coming blocks where an automatic re-plan will now
-- keep the stored routes (« serrés »: the plan would make late someone the stored day serves on time) and the minutes
-- pointed already passed (an exact move « quand même »: pointed again at their arrival by the next « Enregistrer » that does
-- not make them later). « ARRÊT : … » or any other error: stop, nothing changed.
do $do$
declare r record; body text; sha text; v_before jsonb; v_after jsonb; v_diff jsonb; v_n int; v_c0 jsonb; v_c1 jsonb;
  v_tight jsonb; v_passed jsonb;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261122000100') then
    raise exception 'ARRÊT : la Partie 28 (20261122000100) n''est pas en ligne : elle passe avant';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261122000200') then
    raise exception 'ARRÊT : la Partie 29 (20261122000200) est déjà en ligne';
  end if;
  select * into r from extensions.http_get('https://raw.githubusercontent.com/hostnextline/garage2.0/<C>/supabase/migrations/20261122000200_garder_ordre.sql');
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
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('day_order_core', 'replan_block_safe', 'roads_replan') and p.prosrc like '%Part 29%') <> 3 then
    raise exception 'ARRÊT : les trois fonctions de la Partie 29 ne sont pas toutes là';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('day_order_core', 'replan_block_safe', 'roads_replan')
               and (p.proacl is null or p.proacl::text ~ '(authenticated|anon)=|(^|[{,])=X/')) then
    raise exception 'ARRÊT : une des trois fonctions est ouverte à l''app (elles sont au serveur seul)';
  end if;
  if public.roads_on() then raise exception 'ARRÊT : roads_on vrai après la migration'; end if;
  -- the coming blocks where the guard will keep the stored routes (the plan makes late someone served on time, or makes a
  -- minute already passed later still): the same test as replan_block_safe's and roads_replan's
  select coalesce(jsonb_agg(substr(e.k, 6) order by e.k), '[]'::jsonb) into v_tight
  from jsonb_each(coalesce(v_after, '{}'::jsonb)) e(k, p)
  where exists (select 1 from jsonb_array_elements_text(coalesce(e.p->'late', '[]'::jsonb)) o
                join public.jobs j on j.id::text = o
                where j.status = 'booked' and j.deleted_at is null and j.truck_id is not null and j.eta_min is not null
                  and (j.eta_min <= coalesce(j.arrive_at, j.win_end)
                       or (j.arrive_at is not null and coalesce((e.p->'jobs'->o->>'eta')::int, 0) > j.eta_min)));
  -- the minutes pointed already passed (« Déplacer quand même »): n°, day, the minute, the arrival
  select coalesce(jsonb_agg(jsonb_build_array(j.number, j.day, j.arrive_at, j.eta_min) order by j.day, j.eta_min), '[]'::jsonb) into v_passed
  from public.jobs j
  where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today() and j.arrive_at is not null and j.eta_min > j.arrive_at;
  raise exception 'ESSAI OK : garder_ordre (rien n''est gardé) ; % réponses du planificateur comparées, toutes les mêmes ; % blocs serrés que les re-plans garderont tels quels (%) ; % minutes pointées déjà dépassées (n°, jour, minute, arrivée : %)',
    v_n, jsonb_array_length(v_tight), v_tight, jsonb_array_length(v_passed), v_passed;
end $do$;
