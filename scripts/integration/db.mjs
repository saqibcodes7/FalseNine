/**
 * The development project's database, for the two scripts that need it:
 * integration:dev:migrate (applies the repository's migrations and the
 * fictional fixture) and integration:dev:verify (read-only checks). The API
 * gate itself never connects here; it only talks to Supabase's public API.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { ROOT } from './config.mjs'

export const MIGRATIONS_DIR = 'supabase/migrations'
export const FIXTURE_FILE = 'supabase/fixtures/football_fixture.sql'

/**
 * How to tell each migration has already been applied. Each one matches the
 * object that migration creates first, and for 0006 to 0010 the same test the
 * migration's own run-once guard uses.
 */
export const MIGRATION_MARKERS = {
  '0001': "select to_regclass('public.sessions') is not null",
  '0002': "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'difficulty')",
  '0003': "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'votes_visible')",
  '0004': "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'peek_ends_at')",
  '0005': "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'reveal_ends_at')",
  '0006': "select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'host_advance')",
  '0007': "select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'tie_grace')",
  '0008': "select to_regclass('public.game_modes') is not null",
  '0009': "select to_regclass('public.football_players') is not null",
  '0010': "select to_regclass('public.ttt_games') is not null",
}

export function migrationFiles() {
  return readdirSync(path.join(ROOT, MIGRATIONS_DIR))
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((file) => ({ version: file.slice(0, 4), file: `${MIGRATIONS_DIR}/${file}` }))
}

export async function connect(config) {
  const { db } = config
  const ssl =
    config.mode === 'local'
      ? false
      : db.caFile
        ? { ca: readFileSync(db.caFile, 'utf8'), rejectUnauthorized: true }
        : { rejectUnauthorized: false }
  const client = new pg.Client({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
    ssl,
    application_name: 'false-nine-integration',
    connectionTimeoutMillis: 20000,
  })
  client.notices = []
  client.on('notice', (msg) => client.notices.push(msg.message))
  await client.connect()
  return client
}

export async function scalar(client, sql, params = []) {
  const result = await client.query(sql, params)
  const row = result.rows[0]
  return row ? Object.values(row)[0] : null
}

/**
 * Read a SQL file the way the Supabase SQL editor would receive it: psql
 * meta-commands (lines starting with a backslash, like \set ON_ERROR_STOP)
 * are dropped, since only psql understands them. Files that do not manage
 * their own transaction are wrapped in one, so a failure leaves nothing half
 * applied.
 */
export function readSqlFile(file) {
  const raw = readFileSync(path.join(ROOT, file), 'utf8')
  const sql = raw
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n')
  const ownTransaction = /^begin;\s*$/m.test(sql) && /^commit;\s*$/m.test(sql)
  return { sql: ownTransaction ? sql : `begin;\n${sql}\ncommit;\n`, ownTransaction }
}

/** Run a whole file in one round trip. On error, roll back and describe where it failed. */
export async function runSqlFile(client, file) {
  const { sql } = readSqlFile(file)
  try {
    await client.query(sql)
    return { ok: true }
  } catch (error) {
    await client.query('rollback').catch(() => {})
    let where = ''
    if (error.position) {
      const line = sql.slice(0, Number(error.position)).split('\n').length
      where = ` near line ${line}`
    }
    return {
      ok: false,
      message: `${error.message}${where}${error.hint ? ` (hint: ${error.hint})` : ''}${error.detail ? ` (detail: ${error.detail})` : ''}`,
    }
  }
}

/** Positive identification: this really is a Supabase database, with Auth and Realtime. */
export async function identifySupabase(client) {
  const checks = await client.query(`
    select
      current_user                                                                as current_user,
      current_database()                                                          as database,
      current_setting('server_version')                                           as server_version,
      (select count(*)::int from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) as api_roles,
      to_regnamespace('auth') is not null                                         as has_auth,
      to_regclass('auth.users') is not null                                       as has_auth_users,
      to_regprocedure('auth.uid()') is not null                                   as has_auth_uid,
      to_regnamespace('realtime') is not null                                     as has_realtime,
      to_regnamespace('extensions') is not null                                   as has_extensions,
      exists (select 1 from pg_publication where pubname = 'supabase_realtime')   as has_publication
  `)
  return checks.rows[0]
}

export async function migrationState(client) {
  const state = []
  for (const { version, file } of migrationFiles()) {
    const marker = MIGRATION_MARKERS[version]
    const applied = marker ? await scalar(client, marker) : null
    state.push({ version, file, applied })
  }
  return state
}

export async function publicTables(client) {
  const result = await client.query(
    "select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') order by 1",
  )
  return result.rows.map((r) => r.relname)
}
