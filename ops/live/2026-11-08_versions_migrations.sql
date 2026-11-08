-- Live only (Supabase project garage2), to run by hand in the SQL editor or through the connector. NOT a migration.
--
-- Two migrations were recorded in supabase_migrations.schema_migrations under the time they were applied instead of
-- their file version (applied through the connector's apply_migration with the file name as the name):
--   20261107194630  "20261107000300_stop_order"       should be  20261107000300  stop_order
--   20261107201940  "20261107000400_coffre_mechanic"  should be  20261107000400  coffre_mechanic
-- Standard tooling (supabase db push, migration list) believes 000300 and 000400 are missing and would replay them.
--
-- 1) Dry run: shows what would change, then rolls everything back.
do $do$
declare before jsonb; after_ jsonb;
begin
  select jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version) into before
    from supabase_migrations.schema_migrations where version in ('20261107194630', '20261107201940', '20261107000300', '20261107000400');
  update supabase_migrations.schema_migrations set version = '20261107000300', name = 'stop_order' where version = '20261107194630' and name = '20261107000300_stop_order';
  update supabase_migrations.schema_migrations set version = '20261107000400', name = 'coffre_mechanic' where version = '20261107201940' and name = '20261107000400_coffre_mechanic';
  select jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version) into after_
    from supabase_migrations.schema_migrations where version in ('20261107194630', '20261107201940', '20261107000300', '20261107000400');
  raise exception 'dry run — before: % — after: %', before, after_;
end $do$;

-- 2) For real (only after the dry run shows exactly the two rows moving):
-- update supabase_migrations.schema_migrations set version = '20261107000300', name = 'stop_order' where version = '20261107194630' and name = '20261107000300_stop_order';
-- update supabase_migrations.schema_migrations set version = '20261107000400', name = 'coffre_mechanic' where version = '20261107201940' and name = '20261107000400_coffre_mechanic';
-- select version, name from supabase_migrations.schema_migrations order by version desc limit 6;
