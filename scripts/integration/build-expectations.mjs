/**
 * Builds the two reference files the development-project checks compare
 * against, from a throwaway LOCAL Postgres:
 *
 *   scripts/integration/expectations.json   what anon and authenticated may do
 *                                           with every object in public, the
 *                                           read policies, row level security
 *                                           and the Realtime publication, as
 *                                           the migrations define them
 *   scripts/integration/fixture-oracle.json who fits each criterion in the
 *                                           fictional fixture, which the API
 *                                           gate uses to pick right and wrong
 *                                           answers without reading the
 *                                           database directly
 *
 *   npm run integration:build-expectations
 *
 * Same target and safety rules as `npm run test:db` (it runs
 * `node scripts/test-db.mjs --check` first and stops unless that passes), so it
 * can only ever reach a plain local Postgres. It never talks to Supabase.
 * Re-run it whenever a migration or the fixture changes.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { ROOT } from './config.mjs'
import { ORACLE_SQL, POLICIES_SQL, PRIVILEGES_SQL, PUBLICATION_SQL, RLS_SQL, SCHEMA_USAGE_SQL } from './sql.mjs'

const guard = spawnSync(process.execPath, [path.join(ROOT, 'scripts/test-db.mjs'), '--check'], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
})
if (guard.status !== 0) {
  console.error('\nintegration:build-expectations refused: the test:db safety check did not pass.\n')
  process.exit(2)
}

const adminUrl = new URL(process.env.FN_TEST_PG_URL || 'postgresql://postgres@localhost:5432/postgres')
const psqlEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)))
const name = `fn_test_${Date.now()}_${randomBytes(4).toString('hex')}`
const db = new URL(adminUrl.href)
db.pathname = `/${name}`

function psql(connection, extra) {
  const result = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...extra, connection], {
    cwd: ROOT,
    env: psqlEnv,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`.trim())
  return result.stdout.trim()
}

let created = false
let exitCode = 0
try {
  psql(adminUrl.href, ['-c', `create database "${name}"`])
  created = true
  const migrations = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()
  for (const file of ['supabase/tests/_supabase_shim.sql', ...migrations.map((f) => `supabase/migrations/${f}`)]) {
    psql(db.href, ['-f', file])
  }
  psql(db.href, ['-c', "set fn.load_football_fixture = 'yes'", '-f', 'supabase/fixtures/football_fixture.sql'])

  const query = (sql) => JSON.parse(psql(db.href, ['-c', sql]))
  const expectations = {
    generated_from: `supabase/migrations 0001 to ${migrations.at(-1).slice(0, 4)}, applied to a plain Postgres with no default grants`,
    privileges: query(PRIVILEGES_SQL),
    policies: query(POLICIES_SQL),
    rls: query(RLS_SQL),
    publication: query(PUBLICATION_SQL),
    schema_usage: query(SCHEMA_USAGE_SQL),
  }
  const oracle = {
    generated_from: 'supabase/fixtures/football_fixture.sql (fictional)',
    ...query(ORACLE_SQL),
  }

  writeFileSync(path.join(ROOT, 'scripts/integration/expectations.json'), JSON.stringify(expectations, null, 2) + '\n')
  writeFileSync(path.join(ROOT, 'scripts/integration/fixture-oracle.json'), JSON.stringify(oracle, null, 2) + '\n')
  const granted = expectations.privileges.filter((p) => p.privs).length
  console.log(`\nWrote scripts/integration/expectations.json (${expectations.privileges.length} privilege rows, ${granted} granted; ${expectations.policies.length} policies)`)
  console.log(`Wrote scripts/integration/fixture-oracle.json (${oracle.players.length} footballers, ${oracle.categories.length} criteria)`)
} catch (error) {
  exitCode = 1
  console.error(`\nintegration:build-expectations failed: ${error.message}`)
} finally {
  if (created) {
    try {
      psql(adminUrl.href, ['-c', `drop database if exists "${name}" with (force)`])
    } catch (error) {
      console.error(`Could not drop ${name}: ${error.message}`)
    }
  }
}
process.exit(exitCode)
