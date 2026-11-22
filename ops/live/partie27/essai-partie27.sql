-- Part 27 on today's live database: THE TRY (everything is undone; the expected answer is the error « ESSAI OK … »).
-- Replace <C> (the pushed commit of branch tomtom) and <SHA256> (shasum -a 256 of the file at <C>).
-- Besides loading the file, it proves « inert » on live's own data: the planner's answers for the next 14 days (every
-- block's plan, each truck's day driving, the moments offered to 3 customers' addresses, and in window mode the windows
-- for any vehicle and for tire work, the truck only)
-- are computed before and after the migration INSIDE the same transaction; « différentes : [] » is the only way on.
do $do$
declare r record; body text; sha text; v_before jsonb; v_after jsonb; v_diff jsonb; v_n int;
begin
  select * into r from extensions.http_get('https://raw.githubusercontent.com/hostnextline/garage2.0/<C>/supabase/migrations/20261119000200_vraies_routes.sql');
  if r.status <> 200 then raise exception 'téléchargement : %', r.status; end if;
  body := r.content;
  sha := encode(extensions.digest(convert_to(body, 'UTF8'), 'sha256'), 'hex');
  if sha <> '<SHA256>' then raise exception 'sha différent : %', sha; end if;
  perform set_config('lock_timeout', '5s', true);
  -- @@ANSWERS@@ (the same query twice: before, then after the migration)
  v_before := (select jsonb_object_agg(k, v) from (
      select 'plan ' || dd.d || ' ' || b.key as k, public.plan_block(dd.d, b.key) as v
        from generate_series(public.local_today(), public.local_today() + 13, interval '1 day') g(t)
        cross join lateral (select g.t::date as d) dd cross join public.blocks() b
      union all
      select 'day ' || dd.d || ' ' || tr.id, (select jsonb_build_object('min', x->'min', 'km', x->'km', 'stops', x->'stops', 'hop', x->'hop')
                                             from (select public.day_drive(dd.d, tr.id) as x) y)
        from generate_series(public.local_today(), public.local_today() + 13, interval '1 day') g(t)
        cross join lateral (select g.t::date as d) dd cross join public.trucks tr where tr.active and tr.deleted_at is null
      union all
      select 'suggest ' || c.id, public.suggest_core(c.lat, c.lng, 60, public.local_today(), 14, null, 50, false, null)
        from (select id, lat, lng from public.customers where lat is not null and deleted_at is null order by created_at desc limit 3) c
      union all
      select 'windows ' || dd.d || ' ' || c.id || ' ' || nd.need, public.suggest_windows_core(c.lat, c.lng, 60, dd.d, null, nd.need, null)
        from generate_series(public.local_today(), public.local_today() + 6, interval '1 day') g(t)
        cross join lateral (select g.t::date as d) dd cross join (values (false), (true)) nd(need)
        cross join (select id, lat, lng from public.customers where lat is not null and deleted_at is null order by created_at desc limit 3) c
       where public.windows_on()) q);
  execute body;
  v_after := (select jsonb_object_agg(k, v) from (
      select 'plan ' || dd.d || ' ' || b.key as k, public.plan_block(dd.d, b.key) as v
        from generate_series(public.local_today(), public.local_today() + 13, interval '1 day') g(t)
        cross join lateral (select g.t::date as d) dd cross join public.blocks() b
      union all
      select 'day ' || dd.d || ' ' || tr.id, (select jsonb_build_object('min', x->'min', 'km', x->'km', 'stops', x->'stops', 'hop', x->'hop')
                                             from (select public.day_drive(dd.d, tr.id) as x) y)
        from generate_series(public.local_today(), public.local_today() + 13, interval '1 day') g(t)
        cross join lateral (select g.t::date as d) dd cross join public.trucks tr where tr.active and tr.deleted_at is null
      union all
      select 'suggest ' || c.id, public.suggest_core(c.lat, c.lng, 60, public.local_today(), 14, null, 50, false, null)
        from (select id, lat, lng from public.customers where lat is not null and deleted_at is null order by created_at desc limit 3) c
      union all
      select 'windows ' || dd.d || ' ' || c.id || ' ' || nd.need, public.suggest_windows_core(c.lat, c.lng, 60, dd.d, null, nd.need, null)
        from generate_series(public.local_today(), public.local_today() + 6, interval '1 day') g(t)
        cross join lateral (select g.t::date as d) dd cross join (values (false), (true)) nd(need)
        cross join (select id, lat, lng from public.customers where lat is not null and deleted_at is null order by created_at desc limit 3) c
       where public.windows_on()) q);
  select count(*)::int, coalesce(jsonb_agg(k order by k) filter (where v_before->k is distinct from v_after->k), '[]'::jsonb)
    into v_n, v_diff from jsonb_object_keys(coalesce(v_before, '{}'::jsonb)) k;
  if public.roads_on() then raise exception 'ARRÊT : roads_on vrai après la migration'; end if;
  if jsonb_array_length(v_diff) > 0 then
    raise exception 'ARRÊT : interrupteur éteint, la migration change % réponses du planificateur sur % : %', jsonb_array_length(v_diff), v_n, v_diff;
  end if;
  raise exception 'ESSAI OK : vraies_routes (rien n''est gardé) ; % réponses du planificateur comparées, toutes les mêmes', v_n;
end $do$;
