-- Part 29, BEFORE (read only; ONE answer, JSON): where live stands, and what Hassan must know before and after.
--   migrations     the three newest versions (expected: 20261122000100 first, 20261122000200 not there)
--   partie28_la / partie29_la
--   windows_on, roads_on (live: true / false)
--   jours_reorganises  the coming days saved with « Réorganiser la journée » since Part 28 went live (10 h 18, 15:18 UTC):
--                  their dragged stops have NO minute pointed; after Part 29, reopen each, drag again the stops whose place
--                  matters, « Enregistrer » (a drag then points them; nothing is changed for him automatically)
--   minutes_depassees  the coming stops pointed to a minute their arrival has passed (an exact move « quand même »):
--                  today's live save would LOSE them; Part 29's points them again at their arrival when the save does not
--                  make them later (n°, day, minute, arrival)
--   au_dela_heures the coming days where a truck's last booked stop ends after its hours (a tight day: the re-plans of
--                  Part 27 can break the minutes pointed there; Part 29's guard keeps the stored routes)
select jsonb_build_object(
  'migrations', (select coalesce(jsonb_agg(m.version order by m.version desc), '[]'::jsonb)
                   from (select version from supabase_migrations.schema_migrations order by version desc limit 3) m),
  'partie28_la', exists (select 1 from supabase_migrations.schema_migrations where version = '20261122000100'),
  'partie29_la', exists (select 1 from supabase_migrations.schema_migrations where version = '20261122000200'),
  'windows_on', public.windows_on(),
  'roads_on', public.roads_on(),
  'jours_reorganises', (select coalesce(jsonb_agg(jsonb_build_object('a', a.at, 'jour', a.data->>'day',
                                     'glisses', jsonb_array_length(coalesce(a.data->'moved', '[]'::jsonb))) order by a.at), '[]'::jsonb)
                          from public.activity a
                         where a.action = 'day_ordered' and a.at >= timestamptz '2026-11-22 15:18+00'
                           and (a.data->>'day')::date >= public.local_today()),
  'minutes_depassees', (select coalesce(jsonb_agg(jsonb_build_array(j.number, j.day, j.arrive_at, j.eta_min) order by j.day, j.eta_min), '[]'::jsonb)
                          from public.jobs j
                         where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today()
                           and j.arrive_at is not null and j.eta_min > j.arrive_at),
  'au_dela_heures', (select coalesce(jsonb_agg(distinct jsonb_build_array(j.day, tr.name)), '[]'::jsonb)
                       from public.jobs j join public.trucks tr on tr.id = j.truck_id
                      where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today() and j.eta_min is not null
                        and j.eta_min + ceil(public.bset('stop_min', 5))::int + j.duration_min >
                            coalesce((select max((x->>1)::int) from jsonb_array_elements(coalesce(public.truck_ranges(j.truck_id, j.day), '[]'::jsonb)) x), 1440))
) as avant;
