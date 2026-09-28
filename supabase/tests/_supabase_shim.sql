-- ============================================================================
-- Throwaway-database shim. NEVER run this against the real Supabase project.
--
-- A Supabase project comes with a few things the migrations take for granted:
-- the anon and authenticated roles, an `extensions` schema, and the
-- supabase_realtime publication. A plain Postgres has none of them, so this
-- file creates stand-ins before the migrations run. scripts/test-db.mjs applies
-- it to a database it has just created, and drops that database afterwards.
--
-- It refuses to run on anything that looks like a Supabase database, as a last
-- line of defence behind the checks in scripts/test-db.mjs.
-- ============================================================================

-- Stop at the first error however this file is run, so the refusal below
-- really does stop everything after it.
\set ON_ERROR_STOP on

do $$
begin
  if exists (
    select 1 from pg_namespace
    where nspname in ('auth', 'storage', 'realtime', 'supabase_functions', 'graphql')
  ) or exists (
    select 1 from pg_roles
    where rolname in ('supabase_admin', 'supabase_auth_admin', 'authenticator')
  ) then
    raise exception 'This looks like a Supabase database. The test shim only runs on a throwaway local Postgres.';
  end if;
end $$;

-- Roles belong to the whole server, so a second run finds them already there.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Realtime reads this publication. Locally it only has to exist; Postgres warns
-- that wal_level is too low to use it, which does not matter for these tests.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
