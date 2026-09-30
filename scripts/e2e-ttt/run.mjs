/**
 * Football Tic-Tac-Toe, end to end, with no Supabase project at all.
 *
 *   FN_TEST_PG_URL=postgresql://postgres@127.0.0.1:5433/postgres npm run test:ttt
 *
 * 1. Checks the pure helpers the screens are built on (no browser).
 * 2. Makes a throwaway database on a LOCAL Postgres and applies the test shim,
 *    migrations 0001 to 0010, the fictional football fixture, and the 'dev'
 *    difficulty profile (so the small fixture can make a board at every
 *    difficulty, exactly as the Stage 5A development project does).
 * 3. Starts scripts/mock-supabase.mjs on it (Auth, REST and Realtime, with
 *    every row level security policy applying as written) and a Vite dev
 *    server pointed at the mock.
 * 4. Plays Online and Pass & Play in Chromium.
 * 5. Stops everything and drops the database, pass or fail.
 *
 * The same rules as test:db keep it away from anything real: the server must
 * be local, a host with "supabase" in it is refused, a server carrying
 * Supabase's own roles is refused, and the only database dropped is the one
 * this run created. It never reads VITE_SUPABASE_URL, .env.local or
 * .env.integration.local; the Vite it starts is given the mock's address for
 * that process only.
 *
 *   E2E_ONLY=online|pass|logic   run one part
 *   E2E_KEEP=1                   keep the database and servers up until Ctrl+C
 *   E2E_CHROMIUM=/path           a Chromium other than /opt/pw-browsers/chromium
 *
 * Screenshots land in e2e-shots/ttt/.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT || 54329)
const VITE_PORT = Number(process.env.E2E_VITE_PORT || 5191)
const KEY = 'sb_publishable_mock_local_only'
const ONLY = process.env.E2E_ONLY || ''
const KEEP = process.env.E2E_KEEP === '1'

function refuse(message) {
  console.error(`\ntest:ttt refused: ${message}\n`)
  process.exit(2)
}

// ---- 1. The logic checks need nothing else. -------------------------------------
if (!ONLY || ONLY === 'logic') {
  const logic = spawnSync(process.execPath, [path.join(ROOT, 'scripts/e2e-ttt/logic.mjs')], { cwd: ROOT, stdio: 'inherit' })
  if (logic.status !== 0) process.exit(1)
  if (ONLY === 'logic') process.exit(0)
}

// ---- 2. A throwaway database, on a local server only. ---------------------------
const raw = process.env.FN_TEST_PG_URL || 'postgresql://postgres@127.0.0.1:5432/postgres'
let admin
try {
  admin = new URL(raw)
} catch {
  refuse('FN_TEST_PG_URL is not a postgresql:// URL.')
}
for (const key of admin.searchParams.keys()) {
  if (!['sslmode', 'connect_timeout', 'application_name'].includes(key)) refuse(`the connection option "${key}" is not allowed here.`)
}
const host = decodeURIComponent(admin.hostname || 'localhost')
if (/supabase/i.test(host)) refuse(`${host} is a Supabase host.`)
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) refuse(`${host} is not a local server.`)

const psqlEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^PG/i.test(k)))
const psql = (url, args) => spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', ...args, url], { cwd: ROOT, env: psqlEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const withDb = (name) => Object.assign(new URL(admin.href), { pathname: `/${name}` }).href

const probe = psql(admin.href, ['-At', '-c', "select exists (select 1 from pg_roles where rolname in ('supabase_admin', 'supabase_auth_admin', 'authenticator'))"])
if (probe.error?.code === 'ENOENT') refuse('psql is not on the PATH.')
if (probe.status !== 0) refuse(`could not connect to ${host}:\n${probe.stdout}${probe.stderr}`)
if (probe.stdout.trim() === 't') refuse(`the server at ${host} has Supabase roles on it. Use a plain local Postgres.`)

const dbName = `fn_e2e_${Date.now()}_${randomBytes(4).toString('hex')}`
const dbUrl = withDb(dbName)
const children = []
let failed = false

function stopAll() {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
}

async function waitFor(url, ms = 20000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return true
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

function start(label, args, env) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...psqlEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${label}] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`[${label}] ${d}`))
  children.push(child)
  return child
}

let cleanedUp = false
function cleanUp() {
  if (cleanedUp) return
  cleanedUp = true
  stopAll()
  if (/^fn_e2e_\d+_[0-9a-f]{8}$/.test(dbName)) psql(admin.href, ['-q', '-c', `drop database if exists "${dbName}" with (force)`])
}

// Ctrl+C part-way through still stops the servers and drops the database.
if (!KEEP) {
  process.once('SIGINT', () => {
    console.log('\nInterrupted. Cleaning up.')
    cleanUp()
    process.exit(130)
  })
}

try {
  const create = psql(admin.href, ['-q', '-c', `create database "${dbName}"`])
  if (create.status !== 0) refuse(`could not create a throwaway database:\n${create.stderr}`)
  console.log(`\nThrowaway database ${dbName} on ${host}.`)

  const files = ['supabase/tests/_supabase_shim.sql']
  for (const f of readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
    files.push(`supabase/migrations/${f}`)
  }
  files.push('supabase/fixtures/football_fixture.sql')
  for (const file of files) {
    // The fixture refuses to load unless the session says it is meant to.
    const guard = file.endsWith('football_fixture.sql') ? ['-c', "set fn.load_football_fixture = 'yes'"] : []
    const run = psql(dbUrl, ['-q', ...guard, '-f', file])
    if (run.status !== 0) throw new Error(`${file} failed:\n${run.stderr.split('\n').filter((l) => !/wal_level|logical/.test(l)).join('\n')}`)
  }
  const dev = psql(dbUrl, ['-q', '-c', "update public.ttt_config set active_profile = 'dev'"])
  if (dev.status !== 0) throw new Error(`could not switch to the dev profile:\n${dev.stderr}`)
  console.log(`Applied ${files.length} files and the dev difficulty profile.`)

  // ---- 3. The mock and a dev server pointed at it. ------------------------------
  start('mock', ['scripts/mock-supabase.mjs'], { MOCK_DB_URL: dbUrl, MOCK_SUPABASE_PORT: String(MOCK_PORT), MOCK_PUBLISHABLE_KEY: KEY, MOCK_TOKEN_TTL: process.env.E2E_TOKEN_TTL || '100' })
  if (!(await waitFor(`http://127.0.0.1:${MOCK_PORT}/__mock/log`))) throw new Error('the mock did not start')
  const viteEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_') && !k.startsWith('FN_')))
  start('vite', ['node_modules/vite/bin/vite.js', '--port', String(VITE_PORT), '--strictPort', '--host', '127.0.0.1'], {
    ...viteEnv,
    VITE_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
    VITE_SUPABASE_ANON_KEY: KEY,
  })
  if (!(await waitFor(`http://127.0.0.1:${VITE_PORT}/`))) throw new Error('vite did not start')
  console.log(`Mock on :${MOCK_PORT}, app on :${VITE_PORT}.\n`)

  // ---- 4. The suites. -----------------------------------------------------------
  const suiteEnv = { ...psqlEnv, E2E_BASE: `http://127.0.0.1:${VITE_PORT}`, E2E_MOCK: `http://127.0.0.1:${MOCK_PORT}`, E2E_DB_URL: dbUrl, E2E_KEY: KEY }
  for (const suite of ['online', 'pass']) {
    if (ONLY && ONLY !== suite) continue
    const run = spawnSync(process.execPath, [`scripts/e2e-ttt/${suite}.mjs`], { cwd: ROOT, env: suiteEnv, stdio: 'inherit' })
    if (run.status !== 0) failed = true
  }
} catch (error) {
  console.error(`\n${error.message}`)
  failed = true
} finally {
  if (KEEP) {
    console.log(`\nKeeping ${dbName}, the mock on :${MOCK_PORT} and the app on :${VITE_PORT} until Ctrl+C.`)
    await new Promise((resolve) => process.once('SIGINT', resolve))
  }
  stopAll()
  await new Promise((r) => setTimeout(r, 500))
  cleanUp()
}

console.log(failed ? '\ntest:ttt FAILED' : '\ntest:ttt passed')
process.exit(failed ? 1 : 0)
