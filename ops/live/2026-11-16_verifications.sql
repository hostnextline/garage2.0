-- Before the cutover of 2026-11-16 (« Refonte »): READ-ONLY questions to live (Supabase project garage2), asked with
-- the owner's go, BEFORE anything is applied. NOT a migration: nothing here writes, creates or changes anything.
-- Each answer is one row. Run them one at a time (SQL editor, or the Claude Code MCP `supabase-garage` execute_sql),
-- and keep every answer in ops/live/ (live.avant.json) — they are the « before » of the runbook (ops/live/CUTOVER.md).
--
-- Q1 to Q7 answer the unknowns of the rebuild plan (scan/design/risk-first.md, section 0); two of them cannot be
-- answered by SQL and are said so (Q5, Q6). Q8 is the restore's question. F is the schema fingerprint: the SAME query
-- runs on live and on the local database built from the migrations at the same commit; the two answers must be equal
-- (compare the « md5 » part first, then the section that differs).

-- Q1. Which migrations live has recorded, the last ones first. Is 20261115000100 (fenetres) there? (CLAUDE.md says
--     both « applied 2026-11-15 » and « NOT applied »: this is the answer.)
select case when to_regclass('supabase_migrations.schema_migrations') is null then json_build_object('schema_migrations', 'absent (not a Supabase project)') else (xpath('/row/j/text()', query_to_xml($q$
  select json_build_object(
    'fenetres_20261115000100', exists (select 1 from supabase_migrations.schema_migrations where version = '20261115000100'),
    'count', (select count(*) from supabase_migrations.schema_migrations),
    'last', (select json_agg(json_build_object('version', version, 'name', name) order by version desc)
               from (select version, name from supabase_migrations.schema_migrations order by version desc limit 12) m)) as j
$q$, false, true, '')))[1]::text::json end as q1_migrations;

-- Q2. The booking mode the team really uses tomorrow (arrival windows or blocks), and online booking on/off.
select json_build_object(
  'windows_on', (select booking -> 'windows_on' from public.settings where id = 1),
  'web_on', (select booking -> 'web' -> 'on' from public.settings where id = 1),
  'booking_keys', (select json_agg(k order by k) from public.settings s, jsonb_object_keys(s.booking) k where s.id = 1)
) as q2_booking_mode;

-- Q3. Postgres major version (the local stack is 16: deparsed text compares byte for byte only on the same major).
select json_build_object('version', version(), 'server_version_num', current_setting('server_version_num')) as q3_postgres;

-- Q4. pg_cron: installed? and its jobs (the migrations schedule garage-housekeeping and garage-lock-windows only when
--     the extension exists). The job list is read only when the table exists (no error when it does not).
select json_build_object(
  'pg_cron', (select json_build_object('version', extversion, 'schema', extnamespace::regnamespace::text) from pg_extension where extname = 'pg_cron'),
  'jobs', case when to_regclass('cron.job') is null then null else (xpath('/row/j/text()',
            query_to_xml('select json_agg(json_build_object(''jobname'', jobname, ''schedule'', schedule, ''active'', active, ''command'', command) order by jobname) as j from cron.job', false, true, '')))[1]::text::json end
) as q4_cron;

-- Q5. The commit each of the 11 Edge Functions really runs: NOT answerable by SQL. Read-only listing of the functions
--     (version, updated_at, entrypoint) with the owner's go; the commit is in the entrypoint's raw GitHub address.
--     Keep it as ops/live/deployed.avant.json (the way back of the functions). After the cutover each function answers
--     GET …/functions/v1/<name>?version with { ok: true, commit } (CUTOVER.md 3.3).
-- Q6. Vercel: are preview deployments of another branch reachable without a Vercel login: NOT answerable by SQL
--     (Vercel dashboard → Settings → Deployment Protection).

-- Q7. The weight of the pictures (the backup used to write them all in one file; GitHub refuses a file over 100 MB),
--     the size of the database against the Free plan (500 MB), and the heaviest tables.
select json_build_object(
  'attachments', (select json_build_object('rows', count(*), 'chars', coalesce(sum(length(data)), 0), 'biggest', coalesce(max(length(data)), 0),
                                           'by_kind', (select json_object_agg(kind, n) from (select kind, count(*) n from public.attachments group by kind) k))
                    from public.attachments),
  'database_bytes', pg_database_size(current_database()),
  'database', pg_size_pretty(pg_database_size(current_database())),
  'heaviest', (select json_agg(json_build_object('table', relname, 'bytes', b, 'rows_est', reltuples::bigint) order by b desc)
                 from (select c.relname, c.reltuples, pg_total_relation_size(c.oid) b from pg_class c
                        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 3 desc limit 10) t)
) as q7_weight;
-- (Platform backups / point-in-time recovery: Supabase dashboard → Database → Backups. Not SQL.)

-- Q8. Can the role used to run a restore switch the automatic steps off (restaurer.mjs: set local
--     session_replication_role = replica)? (has_parameter_privilege needs Postgres 15 or later: Q3 says.) And is extensions.http_get there (the runbook fetches each migration with it)?
select json_build_object(
  'role', current_user,
  'superuser', (select rolsuper from pg_roles where rolname = current_user),
  'may_set_session_replication_role', (select rolsuper from pg_roles where rolname = current_user)
        or has_parameter_privilege(current_user, 'session_replication_role', 'SET'),
  'http_get', to_regprocedure('extensions.http_get(character varying)') is not null,
  'digest', to_regprocedure('extensions.digest(bytea, text)') is not null,
  'extensions', (select json_agg(json_build_object('name', extname, 'version', extversion, 'schema', extnamespace::regnamespace::text) order by extname) from pg_extension)
) as q8_restore_and_tools;

-- Q9. Before the « Refonte » migrations: what they meet. Pictures in SVG (refonte_acces refuses new ones; a restore leaves
--     the old ones in the backup), the NAMES of the rows of « secrets » (never a value: is a Stripe webhook there, is the
--     backup repository pinned), the people of the team with no e-mail (their account could not be made again after the
--     loss of the project), and the starting numbers of the runbook's control (CUTOVER.md 2c).
select json_build_object(
  'svg_pictures', (select count(*) from public.attachments where mime = 'image/svg+xml'),
  'secret_names', (select json_agg(key order by key) from public.secrets),
  'staff_without_email', (select count(*) from public.staff where deleted_at is null and coalesce(email, '') = ''),
  'control', json_build_object('customers', (select count(*) from public.customers), 'jobs', (select count(*) from public.jobs),
    'invoices', (select count(*) from public.invoices), 'payments', (select count(*) from public.payments),
    'payments_cents', (select coalesce(sum(amount_cents), 0) from public.payments where deleted_at is null),
    'next_job_number', (select last_value from public.job_number_seq))
) as q9_before_refonte;

-- Q10. What F does not see (mise-a-niveau-04): who OWNS each function (on live « postgres » is not a superuser: a function
--      owned by another role keeps working only through its own grants), who runs each pg_cron job, the column-level
--      rights (the migrations revoke and grant per column on jobs), and the body alone (md5 of prosrc, which does not
--      depend on the Postgres version) of the three functions F may show different. The same query on the local base at
--      AVANT: the owners must be the same role on each side (else stop), the prosrc md5 of the three must be equal.
select json_build_object(
  'function_owners', (select json_object_agg(o, n) from (select proowner::regrole::text o, count(*) n from pg_proc
                        where pronamespace = 'public'::regnamespace group by 1) x),
  'cron_jobs', case when to_regclass('cron.job') is null then null else (xpath('/row/j/text()',
                 query_to_xml('select json_agg(json_build_object(''jobname'', jobname, ''username'', username) order by jobname) as j from cron.job', false, true, '')))[1]::text::json end,
  'column_rights', (select json_agg(json_build_object('table', c.relname, 'column', a.attname, 'acl', a.attacl::text) order by c.relname, a.attname)
                      from pg_attribute a join pg_class c on c.oid = a.attrelid
                     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attacl is not null and not a.attisdropped),
  'three_bodies', (select json_object_agg(p.oid::regprocedure::text, json_build_object('prosrc_md5', md5(p.prosrc), 'secdef', p.prosecdef,
                      'config', p.proconfig, 'owner', p.proowner::regrole::text))
                     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('job_step', 'walk_in', 'coffre_add'))
) as q10_owners_and_column_rights;

-- F. THE SCHEMA FINGERPRINT — one SELECT, one JSON. Every function of public (md5 of pg_get_functiondef, its grants,
--    security definer, settings), every table with its columns, row level security and grants, the constraints,
--    indexes, policies, triggers, views, the tables of the realtime publication, the recorded migration versions.
--    Objects that belong to an extension are left out. Everything is sorted: two equal schemas give equal text.
--    « md5 » holds one md5 per section: compare those first.
--    On the local database the migrations are recorded in public.local_migrations (names), on live in
--    supabase_migrations.schema_migrations (versions): both are read when they exist, and left out of « md5 ».
with
ext as (select classid, objid from pg_depend where deptype = 'e'),
extf as (select objid from ext where classid = 'pg_proc'::regclass),
extr as (select objid from ext where classid = 'pg_class'::regclass),
acl(oid, cls, acl) as (
  select p.oid, 'f', p.proacl from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all select c.oid, 'r', c.relacl from pg_class c where c.relnamespace = 'public'::regnamespace
),
grants as (
  select a.oid, a.cls, case when a.acl is null then '["(default)"]'::json else
         (select json_agg(g order by g) from (select distinct (case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end) || ':' || x.privilege_type as g
                                                from aclexplode(a.acl) x) gg) end as list
    from acl a
),
f as (
  select json_agg(json_build_object(
           'name', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'kind', p.prokind,
           'md5', md5(pg_get_functiondef(p.oid)), 'security_definer', p.prosecdef, 'config', p.proconfig,
           'grants', (select list from grants g where g.oid = p.oid and g.cls = 'f'))
         order by p.proname, pg_get_function_identity_arguments(p.oid)) as j
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.oid not in (select objid from extf)
),
t as (
  select json_agg(json_build_object(
           'table', c.relname, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
           'grants', (select list from grants g where g.oid = c.oid and g.cls = 'r'),
           'columns', (select json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
                                                         'default', pg_get_expr(d.adbin, d.adrelid), 'generated', a.attgenerated, 'identity', a.attidentity)
                                       order by a.attnum)
                         from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped))
         order by c.relname) as j
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.oid not in (select objid from extr)
),
k as (
  select json_agg(json_build_object('table', c.relname, 'name', o.conname, 'type', o.contype, 'def', pg_get_constraintdef(o.oid)) order by c.relname, o.conname) as j
    from pg_constraint o join pg_class c on c.oid = o.conrelid
   where c.relnamespace = 'public'::regnamespace and c.oid not in (select objid from extr)
),
i as (
  select json_agg(json_build_object('table', c.relname, 'name', x.relname, 'def', pg_get_indexdef(x.oid)) order by c.relname, x.relname) as j
    from pg_index ix join pg_class x on x.oid = ix.indexrelid join pg_class c on c.oid = ix.indrelid
   where c.relnamespace = 'public'::regnamespace and c.oid not in (select objid from extr)
),
p as (
  select json_agg(json_build_object('table', tablename, 'name', policyname, 'permissive', permissive, 'roles', roles, 'cmd', cmd, 'using', qual, 'check', with_check)
                  order by tablename, policyname) as j
    from pg_policies where schemaname = 'public'
),
g as (
  select json_agg(json_build_object('table', c.relname, 'name', tg.tgname, 'enabled', tg.tgenabled, 'def', pg_get_triggerdef(tg.oid)) order by c.relname, tg.tgname) as j
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
   where c.relnamespace = 'public'::regnamespace and not tg.tgisinternal
),
v as (
  select json_agg(json_build_object('view', c.relname, 'kind', c.relkind, 'md5', md5(pg_get_viewdef(c.oid)),
                                    'grants', (select list from grants g where g.oid = c.oid and g.cls = 'r')) order by c.relname) as j
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') and c.oid not in (select objid from extr)
),
rt as (
  select json_agg(schemaname || '.' || tablename order by schemaname, tablename) as j from pg_publication_tables where pubname = 'supabase_realtime'
),
mig as (
  select json_build_object(
    'schema_migrations', case when to_regclass('supabase_migrations.schema_migrations') is null then null else (xpath('/row/j/text()',
        query_to_xml('select json_agg(version order by version) as j from supabase_migrations.schema_migrations', false, true, '')))[1]::text::json end,
    'local_migrations', case when to_regclass('public.local_migrations') is null then null else (xpath('/row/j/text()',
        query_to_xml('select json_agg(name order by name) as j from public.local_migrations', false, true, '')))[1]::text::json end) as j
)
select json_build_object(
  'taken_at', now(),
  'database', current_database(),
  'server_version_num', current_setting('server_version_num'),
  'md5', json_build_object(
    'functions', md5(coalesce((select j from f)::text, '')),
    'tables', md5(coalesce((select j from t)::text, '')),
    'constraints', md5(coalesce((select j from k)::text, '')),
    'indexes', md5(coalesce((select j from i)::text, '')),
    'policies', md5(coalesce((select j from p)::text, '')),
    'triggers', md5(coalesce((select j from g)::text, '')),
    'views', md5(coalesce((select j from v)::text, '')),
    'realtime', md5(coalesce((select j from rt)::text, ''))),
  'counts', json_build_object(
    'functions', json_array_length(coalesce((select j from f), '[]')), 'tables', json_array_length(coalesce((select j from t), '[]')),
    'constraints', json_array_length(coalesce((select j from k), '[]')), 'indexes', json_array_length(coalesce((select j from i), '[]')),
    'policies', json_array_length(coalesce((select j from p), '[]')), 'triggers', json_array_length(coalesce((select j from g), '[]'))),
  'functions', (select j from f),
  'tables', (select j from t),
  'constraints', (select j from k),
  'indexes', (select j from i),
  'policies', (select j from p),
  'triggers', (select j from g),
  'views', (select j from v),
  'realtime', (select j from rt),
  'migrations', (select j from mig)
) as fingerprint;
