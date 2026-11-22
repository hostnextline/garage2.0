-- Part 30, BEFORE (read only; ONE answer, JSON): where live stands before « Réserver à l'heure choisie ».
--   migrations       the three newest versions (expected: 20261122000200 first, 20261122000300 not there)
--   partie29_la / partie30_la
--   windows_on, roads_on (live: true / false)
--   book_job_partie30  book_job's text already says « Part 30 » (expected: false)
--   book_preview_la  the preview function exists (expected: false)
--   minutes_pointees the coming booked appointments pinned to a minute (arrive_at: exact moves, Part 29's drags), n°, day,
--                    minute, arrival; a booking at a minute holds them where they are, as the exact move does
--   en_retard        the coming booked appointments whose arrival is past their minute (else past their window's end):
--                    the days already tight (Part 29 freezes their vehicle; a booking at a minute still goes AT its minute)
--   nombres          customers, appointments, invoices, payments (the try and the control compare them)
--   numero_suivant   job_number_seq's last value: the try and the preview must not move it
select jsonb_build_object(
  'migrations', (select coalesce(jsonb_agg(m.version order by m.version desc), '[]'::jsonb)
                   from (select version from supabase_migrations.schema_migrations order by version desc limit 3) m),
  'partie29_la', exists (select 1 from supabase_migrations.schema_migrations where version = '20261122000200'),
  'partie30_la', exists (select 1 from supabase_migrations.schema_migrations where version = '20261122000300'),
  'windows_on', public.windows_on(),
  'roads_on', public.roads_on(),
  'book_job_partie30', exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'book_job' and p.prosrc like '%Part 30%'),
  'book_preview_la', exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'book_preview'),
  'minutes_pointees', (select coalesce(jsonb_agg(jsonb_build_array(j.number, j.day, j.arrive_at, j.eta_min) order by j.day, j.eta_min), '[]'::jsonb)
                         from public.jobs j
                        where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today() and j.arrive_at is not null),
  'en_retard', (select coalesce(jsonb_agg(jsonb_build_array(j.number, j.day, j.eta_min, coalesce(j.arrive_at, j.win_end)) order by j.day, j.eta_min), '[]'::jsonb)
                  from public.jobs j
                 where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today() and j.eta_min is not null
                   and coalesce(j.arrive_at, j.win_end) is not null and j.eta_min > coalesce(j.arrive_at, j.win_end)),
  'nombres', jsonb_build_object('clients', (select count(*) from public.customers), 'rendez_vous', (select count(*) from public.jobs),
               'factures', (select count(*) from public.invoices), 'paiements', (select count(*) from public.payments)),
  'numero_suivant', (select last_value from public.job_number_seq)
) as avant;
