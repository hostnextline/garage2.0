-- Part 30 on today's live database: THE TRY (everything is undone; the expected answer is the error « ESSAI OK … »).
-- Replace <C> (the pushed commit of branch reorganiser = C30) and <SHA256> (shasum -a 256 of the file at <C>).
-- Before: Part 29 is there (20261122000200), Part 30 is not. Then, in ONE transaction always undone: the file downloaded
-- and checked, lock_timeout 5 s, the planner's answers of the next 14 days computed, the migration applied, the same answers
-- computed again: they must ALL be the SAME (Part 30 changes book_job's booking at a minute only, and no function of the
-- planner); the counts of customers, appointments, invoices and payments the same and job_number_seq where it was (it writes
-- no row); book_job says « Part 30 », book_preview open to the app, its three helpers the server's own; then ONE preview of a
-- booking at 17 h on the day of the first coming appointment, as the first owner (book_preview: its answer, or the refusal's
-- code), which must leave every count and the job number where they were (a preview never spends a number).
-- « ARRÊT : … » or any other error: stop, nothing changed.
do $do$
declare r record; body text; sha text; v_before jsonb; v_after jsonb; v_diff jsonb; v_n int; v_c0 jsonb; v_c1 jsonb;
  v_s0 bigint; v_s1 bigint; v_owner uuid; v_cust uuid; v_day date; v_pv jsonb; v_said text; v_hint text; v_msg text;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261122000200') then
    raise exception 'ARRÊT : la Partie 29 (20261122000200) n''est pas en ligne : elle passe avant';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261122000300') then
    raise exception 'ARRÊT : la Partie 30 (20261122000300) est déjà en ligne';
  end if;
  select * into r from extensions.http_get('https://raw.githubusercontent.com/hostnextline/garage2.0/<C>/supabase/migrations/20261122000300_reserver_heure.sql');
  if r.status <> 200 then raise exception 'téléchargement : %', r.status; end if;
  body := r.content;
  sha := encode(extensions.digest(convert_to(body, 'UTF8'), 'sha256'), 'hex');
  if sha <> '<SHA256>' then raise exception 'sha différent : %', sha; end if;
  perform set_config('lock_timeout', '5s', true);
  v_c0 := jsonb_build_object('clients', (select count(*) from public.customers), 'rendez_vous', (select count(*) from public.jobs),
    'factures', (select count(*) from public.invoices), 'paiements', (select count(*) from public.payments));
  select last_value into v_s0 from public.job_number_seq;
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
  if v_c1 is distinct from v_c0 then raise exception 'ARRÊT : les nombres ont changé : % → %', v_c0, v_c1; end if;
  -- every block of the 14 days: the same answer as before (Part 30 changes no function of the planner)
  select count(*)::int, coalesce(jsonb_agg(k order by k) filter (where v_before->k is distinct from v_after->k), '[]'::jsonb)
    into v_n, v_diff from jsonb_object_keys(coalesce(v_before, '{}'::jsonb) || coalesce(v_after, '{}'::jsonb)) k;
  if jsonb_array_length(v_diff) > 0 then
    raise exception 'ARRÊT : la migration change % réponses du planificateur sur % : %', jsonb_array_length(v_diff), v_n, v_diff;
  end if;
  -- the five functions: book_job says Part 30; book_preview and book_job open to the app; the three helpers the server's own
  if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'book_job' and p.prosrc like '%Part 30%') then
    raise exception 'ARRÊT : book_job ne dit pas « Part 30 »';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('book_job', 'book_preview', 'book_at', 'book_at_row', 'book_at_try')) <> 5 then
    raise exception 'ARRÊT : les cinq fonctions de la Partie 30 ne sont pas toutes là (une chacune)';
  end if;
  if not has_function_privilege('authenticated', 'public.book_preview(jsonb, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.book_preview(jsonb, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.book_job(uuid, jsonb, jsonb)', 'execute') then
    raise exception 'ARRÊT : book_preview / book_job ne sont pas ouvertes à l''app seule';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('book_at', 'book_at_row', 'book_at_try')
               and (p.proacl is null or p.proacl::text ~ '(authenticated|anon)=|(^|[{,])=X/')) then
    raise exception 'ARRÊT : une des trois aides est ouverte à l''app (elles sont au serveur seul)';
  end if;
  if public.roads_on() then raise exception 'ARRÊT : roads_on vrai après la migration'; end if;
  -- ONE preview, as the first owner: 17 h on the day of the first coming appointment, for its customer (nothing written)
  select s.id into v_owner from public.staff s where 'owner' = any(s.roles) and s.active and s.deleted_at is null order by s.created_at limit 1;
  select j.customer_id, j.day into v_cust, v_day from public.jobs j join public.customers c on c.id = j.customer_id
  where j.status = 'booked' and j.deleted_at is null and j.day > public.local_today() and j.day <= public.local_today() + 13
    and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
  order by j.day, j.eta_min nulls last limit 1;
  if v_owner is null or v_cust is null then
    v_said := 'pas essayé (aucun propriétaire ou aucun rendez-vous à venir avec une position)';
  else
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    begin
      v_pv := public.book_preview(jsonb_build_object('id', gen_random_uuid(), 'customer_id', v_cust, 'day', v_day, 'block', 'day',
        'duration_min', 60, 'arrive_at', 1020), '[]'::jsonb);
      v_said := format('%s : %s', v_day, jsonb_build_object('exact', v_pv->'exact', 'vehicule', v_pv->'truck_id', 'force', v_pv->'forced',
        'en_retard', jsonb_array_length(coalesce(v_pv->'late', '[]'::jsonb)), 'apres_heures', v_pv->'over_hours'));
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
      if coalesce(v_hint, '') !~ '^[a-z][a-z_]*$' then raise; end if;
      v_said := format('%s : refusé %s (%s)', v_day, v_hint, v_msg);
    end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
  end if;
  v_c1 := jsonb_build_object('clients', (select count(*) from public.customers), 'rendez_vous', (select count(*) from public.jobs),
    'factures', (select count(*) from public.invoices), 'paiements', (select count(*) from public.payments));
  if v_c1 is distinct from v_c0 then raise exception 'ARRÊT : l''aperçu a changé les nombres : % → %', v_c0, v_c1; end if;
  select last_value into v_s1 from public.job_number_seq;
  if v_s1 is distinct from v_s0 then raise exception 'ARRÊT : un numéro de rendez-vous a été pris (% → %)', v_s0, v_s1; end if;
  raise exception 'ESSAI OK : reserver_heure (rien n''est gardé) ; % réponses du planificateur comparées, toutes les mêmes ; numéro de rendez-vous inchangé (%) ; aperçu d''une réservation à 17 h : %',
    v_n, v_s0, v_said;
end $do$;
