-- Part 13: the server's own building blocks are not callable from the app. Signed-in people could call any
-- function before; the internal ones (re-planning, the operations log, the parts taken off the inventory, the
-- end of someone's day, the full rows of a job) are now reachable only through the operations that check rights.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'close_day', 'housekeeping', 'apply_plan', 'replan_block', 'replan_days', 'plan_block', 'block_rows',
      'op_save', 'op_done', 'use_parts', 'job_payload', 'job_lines', 'job_invoice', 'job_paid', 'durs_of',
      'lock_block', 'lock_two', 'route_min', 'drive_min'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  -- small helpers: a fixed search path (they only use the garage's own tables and the built-in functions)
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and not p.prosecdef and p.proname = any (array[
      'all_rights', 'lock_block', 'local_today', 'now_min', 'by_person', 'local_now', 'touch', 'right_default', 'right_rule',
      'drive_min', 'ranges_norm', 'ranges_norm_trg', 'ranges_overlap', 'ranges_first', 'ranges_from', 'km_between', 'route_min',
      'durs_of', 'block_pos', 'lock_two', 'fail'])
  loop
    execute format('alter function %s set search_path = public, extensions', f.sig);
  end loop;
end $$;
