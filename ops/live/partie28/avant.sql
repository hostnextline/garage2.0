-- READ ONLY. Part 28 (« Réorganiser la journée », « Envoyer les heures aux clients »): what live has BEFORE it
-- (REARRANGE.md §6.5, §7.3 b.0), in ONE answer (JSON) to read to Hassan with the numbers before anything is installed.
-- Never a value of a secret: only whether the two texting secrets are there.
select jsonb_build_object(
  -- the migrations: Part 27 (20261119000200) is there, Part 28 (20261122000100) is not; the columns of Part 28 neither
  'migrations', (select jsonb_agg(m.version order by m.version desc)
                   from (select version from supabase_migrations.schema_migrations order by version desc limit 4) m),
  'partie27', exists (select 1 from supabase_migrations.schema_migrations where version = '20261119000200'),
  'partie28', exists (select 1 from supabase_migrations.schema_migrations where version = '20261122000100'),
  'colonnes_told', (select count(*) from information_schema.columns
                     where table_schema = 'public' and table_name = 'jobs' and (column_name like 'told%' or column_name = 'hand_at')),
  -- the modes: windows (the rearranging re-cuts windows only there), « Vraies routes » (live: off), the switch « rewin »
  'windows_on', public.windows_on(),
  'roads_on', public.roads_on(),
  'rewin', (select s.booking->'rewin' from public.settings s where s.id = 1),
  -- the window's rule (code F17: an « avant » under half the rounding cuts windows that miss their arrival)
  'plages', (select jsonb_build_object('win_before_min', s.booking->'win_before_min', 'win_after_min', s.booking->'win_after_min',
                                       'win_round_min', s.booking->'win_round_min', 'win_lock_min', s.booking->'win_lock_min')
               from public.settings s where s.id = 1),
  -- the evening lock runs by itself (pg_cron)
  'cron_plages', exists (select 1 from cron.job where jobname = 'garage-lock-windows'),
  -- texting set up (automatic) or not (every text by hand): whether the two secrets are there, never their value
  'textos_branches', (select count(*) = 2 from public.secrets where key in ('ghl_token', 'ghl_location') and coalesce(value, '') <> ''),
  -- Réglages → Textos: the switches per kind (« moved » false: every changed client lands in « À avertir toi-même » and no
  -- question follows a move: ask Hassan BEFORE install) and the three templates the button sends
  'messages_on', (select s.messages->'on' from public.settings s where s.id = 1),
  'modeles', (select jsonb_build_object(
                'fr', jsonb_build_object('booking', s.messages->'fr'->'booking', 'moved', s.messages->'fr'->'moved', 'window', s.messages->'fr'->'window'),
                'en', jsonb_build_object('booking', s.messages->'en'->'booking', 'moved', s.messages->'en'->'moved', 'window', s.messages->'en'->'window'))
              from public.settings s where s.id = 1),
  -- the coming booked appointments, and those never confirmed (no booking text sent): the first press's N, day by day
  'a_venir', (select count(*) from public.jobs j where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today()),
  'jamais_confirmes', (select count(*) from public.jobs j
                        where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today() and j.confirm_sent_at is null),
  'jamais_confirmes_clients', (select count(distinct coalesce(j.customer_id::text, j.id::text)) from public.jobs j
                                where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today() and j.confirm_sent_at is null),
  'jamais_confirmes_par_jour', (select coalesce(jsonb_object_agg(q.day, q.n), '{}'::jsonb) from (
                                  select j.day, count(*) n from public.jobs j
                                   where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today() and j.confirm_sent_at is null
                                   group by j.day) q),
  -- the stops whose planned arrival is already outside their window (they will be due with the window of their arrival)
  'hors_plage', (select count(*) from public.jobs j
                  where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today() and j.block = 'day'
                    and j.win_start is not null and j.eta_min is not null and (j.eta_min < j.win_start or j.eta_min > j.win_end)),
  'flexibles', (select count(*) from public.jobs j
                 where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today() and j.block = 'day' and j.win_start is null)
) as avant;
