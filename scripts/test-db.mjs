/**
 * Runs every migration and every SQL smoke test against a brand-new throwaway
 * database, then drops it. Exits non-zero if anything fails.
 *
 *   npm run test:db
 *   npm run test:db -- --check    only run the safety checks, create nothing
 *   npm run test:db -- --keep     leave the throwaway database behind to poke at
 *
 * Needs `psql` on the PATH and a plain local Postgres 15 or newer to talk to,
 * for example:
 *
 *   docker run --rm -p 5433:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
 *   FN_TEST_PG_URL=postgresql://postgres@localhost:5433/postgres npm run test:db
 *
 * ---------------------------------------------------------------------------
 * SAFETY
 *
 * This script creates and drops databases, so it is built to be unable to
 * reach the real Supabase project by accident:
 *
 *   1. It reads its connection from FN_TEST_PG_URL and nothing else. It never
 *      reads DATABASE_URL, and it strips every PG* variable (PGHOST, PGSERVICE,
 *      PGPASSWORD...) from the environment psql runs in, so nothing can leak in
 *      from your shell.
 *   2. The server has to be local: localhost, 127.0.0.1, ::1 or a Unix socket.
 *      Any other host is refused unless FN_TEST_DB_ALLOW_REMOTE_HOST is set to
 *      that exact hostname, so an override cannot silently apply to a
 *      different server later.
 *   3. Any hostname containing "supabase" is refused, override or not.
 *   4. Only a short list of connection options is accepted. Anything that can
 *      redirect libpq to another server or database (hostaddr, service,
 *      dbname, multiple hosts) is refused.
 *   5. Before creating anything it asks the server what it is, and refuses if
 *      it finds Supabase's own roles.
 *   6. It only ever drops the one database it created in this run, whose name
 *      it generated itself.
 *
 * supabase/tests/_supabase_shim.sql also refuses to run on anything that looks
 * like Supabase, as a last line of defence.
 * ---------------------------------------------------------------------------
 *
 * A smoke file passes when psql finishes without an error, it prints at least
 * one PASS, and it prints no FAIL. The "Scan the output above for FAIL" banner
 * at the end of some files is not a result and is ignored.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = 'supabase/migrations'
const TESTS = 'supabase/tests'
const SHIM = `${TESTS}/_supabase_shim.sql`

const DEFAULT_URL = 'postgresql://postgres@localhost:5432/postgres'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
// Deliberately short. dbname is left out because it would override the
// throwaway database name, and hostaddr and service can point libpq anywhere.
const ALLOWED_OPTIONS = new Set(['host', 'port', 'user', 'password', 'sslmode', 'connect_timeout', 'application_name'])
const MIN_SERVER_VERSION = 150000
const DB_NAME = /^fn_test_\d+_[0-9a-f]{8}$/

const args = new Set(process.argv.slice(2))
const CHECK_ONLY = args.has('--check')
const KEEP = args.has('--keep')

// Exit codes: 0 passed, 1 a test failed, 2 refused or misconfigured.
function refuse(message) {
  console.error(`\ntest:db refused: ${message}\n`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// 1. Work out the target, and refuse anything that is not clearly local.
// ---------------------------------------------------------------------------

function parseTarget(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    refuse('FN_TEST_PG_URL is not a valid postgresql:// URL.')
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    refuse('FN_TEST_PG_URL has to start with postgresql:// or postgres://.')
  }

  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_OPTIONS.has(key)) {
      refuse(`the connection option "${key}" is not allowed here, because it can point psql at a different server or database.`)
    }
  }

  // A host can come from the authority or from ?host=, and a Unix socket is
  // written either as ?host=/path or as a percent-encoded path in the host.
  const fromQuery = url.searchParams.get('host')
  const fromAuthority = decodeURIComponent(url.hostname || '')
  const host = (fromQuery || fromAuthority || 'localhost').trim()

  if (host.includes(',')) refuse('more than one host was given. Point it at a single local server.')
  if (/supabase/i.test(host)) refuse(`"${host}" is a Supabase host. This script never runs against Supabase.`)

  const isSocket = host.startsWith('/')
  const isLocal = isSocket || LOCAL_HOSTS.has(host.toLowerCase())

  if (!isLocal) {
    const allowed = (process.env.FN_TEST_DB_ALLOW_REMOTE_HOST || '').trim().toLowerCase()
    if (allowed !== host.toLowerCase()) {
      refuse(
        `"${host}" is not a local server. If you really mean to create and drop throwaway databases there, ` +
          `set FN_TEST_DB_ALLOW_REMOTE_HOST=${host} as well.`,
      )
    }
    console.log(`Remote host "${host}" allowed by FN_TEST_DB_ALLOW_REMOTE_HOST.`)
  }

  return { url, host }
}

if (process.env.DATABASE_URL) {
  console.log('DATABASE_URL is set in this shell. It is ignored; this script only reads FN_TEST_PG_URL.')
}

const { url: adminUrl, host } = parseTarget(process.env.FN_TEST_PG_URL || DEFAULT_URL)

// psql would otherwise fill any gap in the URL from PGHOST, PGSERVICE and
// friends. Run it in an environment with none of them.
const psqlEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)),
)

function psql(connection, extra) {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', ...extra, connection], {
    cwd: ROOT,
    env: psqlEnv,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) {
    if (result.error.code === 'ENOENT') refuse('psql is not on the PATH. Install the Postgres client tools first.')
    throw result.error
  }
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

function withDatabase(name) {
  const next = new URL(adminUrl.href)
  next.pathname = `/${name}`
  return next.href
}

// ---------------------------------------------------------------------------
// 2. Ask the server what it is before creating anything on it.
// ---------------------------------------------------------------------------

const probe = psql(adminUrl.href, [
  '-At',
  '-c',
  `select current_setting('server_version_num')::int || '|' || exists (
     select 1 from pg_roles
     where rolname in ('supabase_admin', 'supabase_auth_admin', 'supabase_replication_admin', 'authenticator')
   )::text`,
])
if (probe.status !== 0) {
  refuse(`could not connect to ${host}:\n${probe.output.trim()}`)
}
const [versionText, looksLikeSupabase] = probe.output.trim().split('|')
if (looksLikeSupabase === 'true') {
  refuse(`the server at ${host} has Supabase's own roles on it. Use a plain Postgres for tests.`)
}
if (Number(versionText) < MIN_SERVER_VERSION) {
  refuse(`the server at ${host} is Postgres ${versionText}; Supabase runs 15 or newer, so these tests need that too.`)
}

console.log(`Target: plain Postgres ${versionText} at ${host}. Safety checks passed.`)
if (CHECK_ONLY) process.exit(0)

// ---------------------------------------------------------------------------
// 3. Build a throwaway database, run everything, and drop it again.
// ---------------------------------------------------------------------------

const sqlFiles = (dir, pattern) =>
  readdirSync(path.join(ROOT, dir))
    .filter((file) => pattern.test(file))
    .sort()
    .map((file) => `${dir}/${file}`)

const migrations = sqlFiles(MIGRATIONS, /^\d{4}_.+\.sql$/)
const smokeTests = sqlFiles(TESTS, /^\d{4}_smoke\.sql$/)

/**
 * PASS and FAIL verdicts, wherever a smoke file prints them: as a NOTICE, as a
 * one-column result, or as one cell of a wider result row, which is how
 * 0002_smoke.sql reports some of its checks ("create_session | 1 | PASS").
 */
function verdicts(output) {
  const pass = []
  const fail = []
  for (const raw of output.split(/\r?\n/)) {
    const line = raw
      .replace(/^psql:[^:]*:\d+:\s*/, '')
      .replace(/^(NOTICE|INFO|WARNING):\s*/, '')
      .trim()
    for (const cell of line.split('|').map((c) => c.trim())) {
      if (/^PASS\b/.test(cell)) pass.push(line)
      else if (/^FAIL\b/.test(cell)) fail.push(line)
    }
  }
  return { pass, fail }
}

const name = `fn_test_${Date.now()}_${randomBytes(4).toString('hex')}`
const testUrl = withDatabase(name)
let failed = false
let created = false

try {
  const create = psql(adminUrl.href, ['-q', '-c', `create database "${name}"`])
  if (create.status !== 0) refuse(`could not create a throwaway database:\n${create.output.trim()}`)
  created = true
  console.log(`Created throwaway database ${name}.\n`)

  for (const file of [SHIM, ...migrations]) {
    const run = psql(testUrl, ['-q', '-f', file])
    if (run.status !== 0) {
      console.log(`  ✗ ${file}\n${run.output.trim()}\n`)
      failed = true
      break
    }
    console.log(`  ✓ ${file}`)
  }

  if (!failed) {
    console.log('')
    let totalPass = 0
    let totalFail = 0
    for (const file of smokeTests) {
      const run = psql(testUrl, ['-f', file])
      const { pass, fail } = verdicts(run.output)
      totalPass += pass.length
      totalFail += fail.length

      const errored = run.status !== 0
      const empty = pass.length === 0
      const ok = !errored && !empty && fail.length === 0
      if (!ok) failed = true

      console.log(`  ${ok ? '✓' : '✗'} ${file}  ${pass.length} passed, ${fail.length} failed`)
      for (const line of fail) console.log(`      ${line}`)
      if (errored) console.log(`      psql stopped with an error:\n${run.output.trim().split('\n').slice(-8).join('\n')}`)
      if (empty && !errored) console.log('      printed no PASS lines at all')
    }
    console.log(`\n${totalPass} passed, ${totalFail} failed across ${smokeTests.length} smoke files.`)
  }
} finally {
  if (created && KEEP) {
    console.log(`\nKept ${name}. Drop it yourself when done.`)
  } else if (created && DB_NAME.test(name)) {
    const drop = psql(adminUrl.href, ['-q', '-c', `drop database if exists "${name}" with (force)`])
    if (drop.status !== 0) console.log(`\nCould not drop ${name}:\n${drop.output.trim()}`)
  }
}

console.log(failed ? '\ntest:db FAILED' : '\ntest:db passed')
process.exit(failed ? 1 : 0)
