-- The parts of a Supabase database that the garage's migrations expect (local test copy only).
-- On the real project these already exist; here they are made once, before Auth creates its tables.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login password 'authpw' noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin login password 'authpw' superuser; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin login password 'authpw' superuser; end if;
  if not exists (select 1 from pg_roles where rolname = 'postgres_local_owner') then create role postgres_local_owner nologin; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
-- Like the real project: tables are NOT exposed automatically; each migration grants what it needs.
alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on functions from public;
-- realtime publication exists on Supabase; migrations add tables to it
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
alter database postgres set search_path to "$user", public, extensions;
