-- READ ONLY. The fingerprint of the 21 planner functions Part 27 makes again (every form), by the body text Postgres keeps
-- (md5 of prosrc: the same on every Postgres version). Run on live BEFORE Part 27, and on a local database built at
-- origin/main d7b6c0d2 (or this branch without 20261119000200): the two answers must be equal, else live does not run
-- the text the migration was generated from (stop and read the difference).
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn, md5(p.prosrc) as md5, p.provolatile as vol
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname = any (array['drive_min', 'route_walk_in', 'route_cost', 'route_retime', 'plan_route', 'day_drive', 'suggest_core',
     'suggest_windows_core', 'web_suggest', 'web_windows', 'plan_inputs', 'apply_plan', 'replan_block_safe', 'customers_replan_on_position',
     'book_job', 'move_job', 'lock_windows_core', 'log_activity', 'stop_order_one', 'windows_switch', 'plan_late_new'])
 order by 1;
