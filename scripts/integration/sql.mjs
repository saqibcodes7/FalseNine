/**
 * Catalog queries shared by build-expectations.mjs (run against a throwaway
 * local Postgres) and verify.mjs (run against the development project), so
 * the two sides are measured in exactly the same way. Each returns one JSON
 * value.
 *
 * Every ORDER BY on text says COLLATE "C" (codepoint order). Without it the
 * order follows the database's own collation, and a Supabase database
 * (en_US.UTF-8) sorts "Joël Åsmark" before "Jonas Pellwick" where a C.UTF-8
 * one sorts it after. The comparisons in db-checks.mjs do not depend on order
 * either; this keeps the files and the live results in one canonical order.
 */

// What anon and authenticated may do with every table, view, sequence and
// function in public. Function names use identity arguments rather than
// regprocedure text, which would change with the search_path.
export const PRIVILEGES_SQL = `
select coalesce(json_agg(row_to_json(m) order by m.kind collate "C", m.name collate "C", m.role collate "C"), '[]'::json)
from (
  select 'table' as kind, c.relname::text as name, r.role,
         concat_ws(',',
           case when has_table_privilege(r.role, c.oid, 'select')     then 'select' end,
           case when has_table_privilege(r.role, c.oid, 'insert')     then 'insert' end,
           case when has_table_privilege(r.role, c.oid, 'update')     then 'update' end,
           case when has_table_privilege(r.role, c.oid, 'delete')     then 'delete' end,
           case when has_table_privilege(r.role, c.oid, 'truncate')   then 'truncate' end,
           case when has_table_privilege(r.role, c.oid, 'references') then 'references' end,
           case when has_table_privilege(r.role, c.oid, 'trigger')    then 'trigger' end) as privs,
         false as trigger_function
  from pg_class c cross join (values ('anon'), ('authenticated')) r(role)
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'sequence', c.relname::text, r.role,
         concat_ws(',', case when has_sequence_privilege(r.role, c.oid, 'usage')  then 'usage' end,
                        case when has_sequence_privilege(r.role, c.oid, 'select') then 'select' end),
         false
  from pg_class c cross join (values ('anon'), ('authenticated')) r(role)
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
  union all
  select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', r.role,
         case when has_function_privilege(r.role, p.oid, 'execute') then 'execute' else '' end,
         p.prorettype = 'trigger'::regtype
  from pg_proc p cross join (values ('anon'), ('authenticated')) r(role)
  where p.pronamespace = 'public'::regnamespace
) m`

export const POLICIES_SQL = `
select coalesce(json_agg(json_build_object(
         'table', tablename, 'policy', policyname, 'cmd', cmd,
         'roles', (select array_agg(x order by x::text collate "C") from unnest(roles) x), 'qual', qual)
       order by tablename::text collate "C", policyname::text collate "C"), '[]'::json)
from pg_policies where schemaname = 'public'`

export const RLS_SQL = `
select json_build_object(
  'without_rls', coalesce((select json_agg(c.relname order by c.relname) from pg_class c
                           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity), '[]'::json),
  'tables', (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')))`

export const PUBLICATION_SQL = `
select json_build_object(
  'tables', coalesce((select json_agg(t.tablename order by t.tablename) from pg_publication_tables t
                      where t.pubname = 'supabase_realtime' and t.schemaname = 'public'), '[]'::json),
  'replica_identity', coalesce((select json_object_agg(c.relname, c.relreplident order by c.relname) from pg_class c
                                join pg_publication_tables t on t.schemaname = 'public' and t.tablename = c.relname and t.pubname = 'supabase_realtime'
                                where c.relnamespace = 'public'::regnamespace), '{}'::json))`

export const SCHEMA_USAGE_SQL = `
select json_build_object(
  'anon_usage', has_schema_privilege('anon', 'public', 'usage'),
  'authenticated_usage', has_schema_privilege('authenticated', 'public', 'usage'),
  'anon_create', has_schema_privilege('anon', 'public', 'create'),
  'authenticated_create', has_schema_privilege('authenticated', 'public', 'create'))`

// Default privileges that would apply to new objects in public: this is where
// "Automatically expose new tables" shows up (or, when it is off, does not).
export const DEFAULT_ACL_SQL = `
select coalesce(json_agg(json_build_object(
         'owner', pg_get_userbyid(d.defaclrole),
         'schema', coalesce(n.nspname, '(all schemas)'),
         'objects', case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' when 'n' then 'schemas' end,
         'acl', d.defaclacl::text)
       order by 1), '[]'::json)
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname = 'public' or n.nspname is null`

// The fictional fixture as the board rules see it: who fits each criterion.
// Keyed by type and label, which the board's axes carry too.
export const ORACLE_SQL = `
select json_build_object(
  'players', (select json_agg(p.full_name order by p.full_name collate "C") from public.football_players p where p.source = 'fixture'),
  'categories', (select json_agg(json_build_object(
                    'key', c.type || ':' || c.label, 'type', c.type, 'label', c.label, 'active', c.active,
                    'members', coalesce((select json_agg(p.full_name order by p.full_name collate "C")
                                         from public.football_category_members m join public.football_players p on p.id = m.player_id
                                         where m.category_id = c.id), '[]'::json))
                  order by c.type collate "C", c.label collate "C")
                 from public.football_categories c where c.source = 'fixture'))`

// The live database's ids for the fixture's footballers and criteria, so a
// difference can be reported with the rows it concerns.
export const FIXTURE_IDS_SQL = `
select json_build_object(
  'players', coalesce((select json_object_agg(p.full_name, p.id) from public.football_players p where p.source = 'fixture'), '{}'::json),
  'categories', coalesce((select json_object_agg(c.type || ':' || c.label, c.id) from public.football_categories c where c.source = 'fixture'), '{}'::json))`

// How the database sorts text, which explains any ordering difference.
export const COLLATION_SQL = `
select json_build_object('collate', d.datcollate, 'ctype', d.datctype, 'provider', d.datlocprovider,
                         'server_version', current_setting('server_version'))
from pg_database d where d.datname = current_database()`
