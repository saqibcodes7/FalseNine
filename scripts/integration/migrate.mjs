/**
 * Applies the repository's migrations (0001 to 0010) and the fictional football
 * fixture to the DEVELOPMENT Supabase project, then runs the read-only checks.
 *
 *   npm run integration:dev:migrate -- --plan         connect, look, change nothing
 *   npm run integration:dev:migrate                   apply what is missing
 *   npm run integration:dev:migrate -- --continue     carry on after a run that
 *       stopped part-way (refused if the database holds any lobbies)
 *   npm run integration:dev:migrate -- --export-sql   no connection at all: write
 *       the same steps as files to paste into the Supabase SQL editor instead,
 *       under .integration/sql-editor/ (for anyone who would rather not put a
 *       database password in .env.integration.local)
 *
 * Safety, on top of the target checks in config.mjs:
 *
 *   - It only proceeds on a database that positively identifies as Supabase
 *     (the API roles, Auth, auth.uid(), Realtime and its publication).
 *   - It starts from a fresh project (nothing in public) or one it has already
 *     set up completely. A public schema holding tables that are not ours is
 *     refused. A part-migrated database, which is also what an older False
 *     Nine database looks like, is refused unless you pass --continue, and
 *     refused even then if it holds any lobbies. Migrations are only ever
 *     applied in order.
 *   - Each migration runs in one transaction (0008 to 0010 bring their own;
 *     0001 to 0007 are wrapped), so a failure leaves nothing half done.
 *   - It never drops anything and never touches the auth, storage or realtime
 *     schemas. Like the Supabase dashboard does when you enable an extension
 *     or switch Realtime on for a table, the migrations add extensions to the
 *     extensions schema (pgcrypto, unaccent, fuzzystrmatch, pg_trgm) and add
 *     their tables to the supabase_realtime publication.
 *
 * After the migrations it loads supabase/fixtures/football_fixture.sql (which
 * refuses to load where real footballers exist) and switches board generation
 * to the 'dev' difficulty profile, because the small fictional fixture cannot
 * make Easy, Medium or Hard boards under the standard profile. Both are test
 * settings for this development project only.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { OUTPUT_DIR, ROOT, describeTarget, loadConfig } from './config.mjs'
import { FIXTURE_FILE, connect, identifySupabase, migrationFiles, migrationState, publicTables, readSqlFile, runSqlFile, scalar } from './db.mjs'
import { runVerify } from './db-checks.mjs'
import { createReport } from './report.mjs'

const PLAN_ONLY = process.argv.includes('--plan')
const EXPORT_SQL = process.argv.includes('--export-sql')
const CONTINUE = process.argv.includes('--continue')

/** The same steps as SQL editor files. Reads the repository only; no network, no config. */
function exportSql() {
  const dir = path.join(ROOT, OUTPUT_DIR, 'sql-editor')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const written = []
  migrationFiles().forEach((m, i) => {
    const name = `${String(i + 1).padStart(2, '0')}-${path.basename(m.file)}`
    writeFileSync(path.join(dir, name), readSqlFile(m.file).sql)
    written.push(name)
  })
  const fixture = readSqlFile(FIXTURE_FILE).sql
  const last = `${String(written.length + 1).padStart(2, '0')}-fixture-and-dev-profile.sql`
  writeFileSync(path.join(dir, last), [
    '-- DEVELOPMENT PROJECT ONLY. Loads the fictional football fixture and switches',
    "-- board generation to the 'dev' difficulty profile the small fixture needs.",
    '-- Paste the whole file into the SQL editor and run it in one go: the first',
    '-- line has to be in the same session as the fixture.',
    "set fn.load_football_fixture = 'yes';",
    fixture,
    "update public.ttt_config set active_profile = 'dev';",
    "notify pgrst, 'reload schema';",
    '',
  ].join('\n'))
  written.push(last)
  console.log(`\nWrote ${written.length} files to ${path.relative(ROOT, dir)}/, to run in this order in the development project's SQL editor:\n`)
  for (const f of written) console.log(`  ${f}`)
  console.log('\nNothing was sent anywhere.\n')
}

async function migrate(client, report, config) {
  report.section('Target')
  const who = await identifySupabase(client)
  const supabase = who.api_roles === 3 && who.has_auth && who.has_auth_users && who.has_auth_uid && who.has_realtime && who.has_extensions && who.has_publication
  if (!report.check('this is a Supabase database (API roles, Auth, auth.uid(), Realtime and its publication are all there)', supabase,
    `Postgres ${who.server_version}, database ${who.database}, connected as ${who.current_user}`)) {
    return
  }

  const state = await migrationState(client)
  const firstMissing = state.findIndex((m) => !m.applied)
  const outOfOrder = firstMissing >= 0 && state.slice(firstMissing).some((m) => m.applied)
  const tables = await publicTables(client)
  report.info('migrations already applied', state.filter((m) => m.applied).map((m) => m.version).join(', ') || 'none')
  report.info('tables in public before starting', tables.length ? `${tables.length}: ${tables.join(', ')}` : 'none (a fresh project)')

  if (outOfOrder) {
    report.fail('the applied migrations are not a clean prefix of 0001 to 0010, so this is not a project this script set up', state)
    return
  }
  if (firstMissing === 0 && tables.length > 0) {
    report.fail('public already holds tables but none of ours: this is not the fresh development project, so nothing will be applied', tables.join(', '))
    return
  }
  // Only two starting points are expected: a fresh project, or one this script
  // has already set up completely. Part-way (say 0001 to 0007 applied) is also
  // what an older False Nine database looks like, so it is refused unless you
  // say --continue, and refused even then if the database holds any lobbies:
  // a development project that stopped part-way through its migrations has
  // none.
  if (firstMissing > 0) {
    const lobbies = await scalar(client, 'select count(*)::int from public.sessions')
    if (!CONTINUE) {
      report.fail(`only ${state.slice(0, firstMissing).map((m) => m.version).join(', ')} are applied. That is what an older False Nine database looks like, so nothing will be applied. If this really is the development project and an earlier run stopped part-way, run again with --continue`, `${lobbies} lobbies in it`)
      return
    }
    if (lobbies > 0) {
      report.fail('--continue was given, but this database holds lobbies. A development project that stopped part-way through its migrations has none, so nothing will be applied', `${lobbies} lobbies`)
      return
    }
    report.info('--continue: carrying on from the first missing migration', state[firstMissing].file)
  }
  const pending = firstMissing < 0 ? [] : state.slice(firstMissing)

  const fixturePlayers = pending.some((m) => m.version <= '0009')
    ? 0
    : await scalar(client, "select count(*)::int from public.football_players where source = 'fixture'")
  const realPlayers = pending.some((m) => m.version <= '0009')
    ? 0
    : await scalar(client, "select count(*)::int from public.football_players where source <> 'fixture'")
  if (realPlayers > 0) {
    report.fail('this database holds non-fixture footballers, so it is not the development project; nothing will be applied', `${realPlayers} found`)
    return
  }

  report.section('Plan')
  report.info('migrations to apply', pending.length ? pending.map((m) => m.file).join(', ') : 'none: all ten are applied')
  report.info('fictional fixture', fixturePlayers > 0 ? `already loaded (${fixturePlayers} footballers); it will be re-applied, which changes nothing` : `load ${FIXTURE_FILE}`)
  report.info('difficulty profile', "set ttt_config.active_profile to 'dev' for this project")
  if (PLAN_ONLY) {
    report.note('--plan: nothing was changed.')
    return
  }

  report.section('Applying migrations')
  for (const m of pending) {
    const started = Date.now()
    const result = await runSqlFile(client, m.file)
    if (!result.ok) {
      report.fail(`${m.file} failed and was rolled back`, result.message)
      return
    }
    const marker = await migrationState(client)
    const now = marker.find((x) => x.version === m.version)
    report.check(`${m.file} applied`, now.applied, `${Date.now() - started} ms`)
    if (!now.applied) return
  }

  report.section('Fictional fixture and test settings')
  await client.query("set fn.load_football_fixture = 'yes'")
  const fixture = await runSqlFile(client, FIXTURE_FILE)
  await client.query('reset fn.load_football_fixture').catch(() => {})
  if (!report.check(`${FIXTURE_FILE} loaded`, fixture.ok, fixture.ok ? '' : fixture.message)) return
  const before = await scalar(client, 'select active_profile from public.ttt_config')
  await client.query("update public.ttt_config set active_profile = 'dev'")
  const after = await scalar(client, 'select active_profile from public.ttt_config')
  report.check("board generation uses the 'dev' difficulty profile", after === 'dev', `was ${before}, now ${after}`)
  // Supabase reloads the Data API's schema cache on DDL by itself; asking
  // once more costs nothing and removes any doubt.
  await client.query("notify pgrst, 'reload schema'")
  if (client.notices.length) report.info('notices from the database', client.notices.slice(-10).join(' | '))

  // The same read-only checks as integration:dev:verify, apart from the
  // gate's evidence, which belongs to a gate run rather than to a migration.
  await runVerify(client, report, config, { withEvidence: false })
}

async function main() {
  if (EXPORT_SQL) {
    exportSql()
    return
  }
  const config = loadConfig({ needApi: false, needDb: true })
  console.log(`\nintegration:dev:migrate${PLAN_ONLY ? ' --plan (changes nothing)' : ''}\n\n${describeTarget(config)}\n`)
  const report = createReport(PLAN_ONLY ? 'migrate-plan' : 'migrate')
  let client
  try {
    client = await connect(config)
    await migrate(client, report, config)
  } catch (error) {
    report.fail('migrate could not finish', error.message)
  } finally {
    await client?.end().catch(() => {})
  }
  process.exit(report.finish())
}

main()
