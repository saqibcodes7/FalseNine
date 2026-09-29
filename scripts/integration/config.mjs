/**
 * Where the Stage 5A integration gate is allowed to point, and nothing else.
 *
 * The gate talks to a real Supabase project, so this file decides, before any
 * network request is made, whether the configured target is acceptable. It is
 * separate from scripts/test-db.mjs on purpose: that harness only ever talks to
 * a plain local Postgres and refuses anything that looks like Supabase, and it
 * stays that way.
 *
 * Configuration comes from .env.integration.local (git-ignored) or from the
 * environment. Nothing here reads VITE_SUPABASE_URL or the app's own .env
 * files for its target; it reads them only to find out which project the app
 * itself uses, so it can refuse to touch that one.
 *
 * Accepted targets:
 *
 *   hosted  https://<ref>.supabase.co, where <ref> is FN_DEV_PROJECT_REF, typed
 *           out separately as a deliberate confirmation. Refused if <ref> is
 *           listed in FN_PROTECTED_PROJECT_REFS or is the project the app's own
 *           env files point at.
 *   local   http://127.0.0.1:<port> or http://localhost:<port>, a local
 *           Supabase CLI stack, with FN_DEV_PROJECT_REF=local.
 *
 * The browser-facing key must be a publishable key (or a legacy anon JWT). A
 * secret or service-role key is refused outright: the gate never needs one.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const ENV_FILE = '.env.integration.local'
export const OUTPUT_DIR = '.integration'

// The app's own env files, read only to learn which project it uses.
const APP_ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local']

const HOSTED_REF = /^[a-z0-9]{20}$/
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** Stop with exit code 2, the same convention test:db uses for "refused". */
export function refuse(message) {
  console.error(`\nintegration refused: ${message}\n`)
  process.exit(2)
}

/** KEY=VALUE lines, # comments, optional single or double quotes. No expansion. */
export function parseEnvText(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function readEnvFile(file) {
  const full = path.join(ROOT, file)
  return existsSync(full) ? parseEnvText(readFileSync(full, 'utf8')) : null
}

function refFromSupabaseUrl(value) {
  try {
    const host = new URL(value).hostname
    const m = host.match(/^([a-z0-9]{20})\.supabase\.(co|in)$/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

/** Which projects the app itself is configured for, and where that came from. */
export function appProjectRefs() {
  const found = []
  for (const file of APP_ENV_FILES) {
    const vars = readEnvFile(file)
    const ref = vars?.VITE_SUPABASE_URL ? refFromSupabaseUrl(vars.VITE_SUPABASE_URL) : null
    if (ref) found.push({ ref, source: file })
  }
  const fromShell = process.env.VITE_SUPABASE_URL ? refFromSupabaseUrl(process.env.VITE_SUPABASE_URL) : null
  if (fromShell) found.push({ ref: fromShell, source: 'VITE_SUPABASE_URL in the environment' })
  return found
}

function isGitIgnored(file) {
  const result = spawnSync('git', ['check-ignore', '-q', file], { cwd: ROOT })
  if (result.error) return null
  return result.status === 0
}

function checkKey(key, mode, ref) {
  if (!key) refuse(`FN_DEV_SUPABASE_PUBLISHABLE_KEY is not set. Put the development project's publishable key in ${ENV_FILE}.`)
  if (key.startsWith('sb_secret_')) {
    refuse('FN_DEV_SUPABASE_PUBLISHABLE_KEY holds a SECRET key. Remove it from the file now; the integration gate only ever uses the publishable key.')
  }
  if (key.startsWith('sb_publishable_')) return 'publishable'
  const claims = decodeJwtPayload(key)
  if (claims) {
    if (claims.role !== 'anon') {
      refuse(`FN_DEV_SUPABASE_PUBLISHABLE_KEY is a JWT for the "${claims.role}" role. Only a publishable (or legacy anon) key is accepted.`)
    }
    if (mode === 'hosted' && claims.ref && claims.ref !== ref) {
      refuse(`the anon key belongs to project "${claims.ref}", not "${ref}".`)
    }
    return 'legacy anon JWT'
  }
  refuse('FN_DEV_SUPABASE_PUBLISHABLE_KEY is not a publishable key (sb_publishable_...) or an anon JWT.')
}

function checkApiUrl(raw, mode, ref) {
  let url
  try {
    url = new URL(raw)
  } catch {
    refuse(`FN_DEV_SUPABASE_URL is not a URL: "${raw}".`)
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    refuse('FN_DEV_SUPABASE_URL must be just the project URL, with no path, query or credentials.')
  }
  if (mode === 'hosted') {
    if (url.protocol !== 'https:') refuse('FN_DEV_SUPABASE_URL must use https.')
    if (url.hostname !== `${ref}.supabase.co`) {
      refuse(`FN_DEV_SUPABASE_URL is ${url.hostname}, but FN_DEV_PROJECT_REF says ${ref}. They must name the same project: https://${ref}.supabase.co`)
    }
    if (url.port) refuse('FN_DEV_SUPABASE_URL must not carry a port.')
  } else {
    if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname) || !url.port) {
      refuse('with FN_DEV_PROJECT_REF=local, FN_DEV_SUPABASE_URL must be http://127.0.0.1:<port> or http://localhost:<port>.')
    }
  }
  return `${url.protocol}//${url.host}`
}

function checkDbUrl(raw, mode, ref) {
  if (!raw) refuse(`FN_DEV_DB_URL is not set. Add the development project's Session pooler connection string to ${ENV_FILE}.`)
  let url
  try {
    url = new URL(raw)
  } catch {
    refuse('FN_DEV_DB_URL is not a connection URL.')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) refuse('FN_DEV_DB_URL must start with postgresql://')
  if (url.hostname.includes(',')) refuse('FN_DEV_DB_URL must name exactly one host.')
  for (const key of url.searchParams.keys()) {
    if (!['sslmode', 'connect_timeout', 'application_name'].includes(key)) {
      refuse(`FN_DEV_DB_URL carries the option "${key}", which is not accepted here.`)
    }
  }
  const user = decodeURIComponent(url.username)
  const password = decodeURIComponent(url.password)
  const port = Number(url.port || 5432)
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres'
  if (database !== 'postgres') refuse(`FN_DEV_DB_URL points at database "${database}"; the Supabase database is "postgres".`)

  if (mode === 'hosted') {
    const direct = url.hostname === `db.${ref}.supabase.co`
    const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
    if (!direct && !pooler) {
      refuse(`FN_DEV_DB_URL host ${url.hostname} is neither db.${ref}.supabase.co nor a *.pooler.supabase.com Session pooler.`)
    }
    if (pooler && user !== `postgres.${ref}`) {
      refuse(`FN_DEV_DB_URL connects as "${user}". For the pooler the user must be postgres.${ref}, which is how the pooler knows the project.`)
    }
    if (direct && user !== 'postgres') refuse(`FN_DEV_DB_URL connects as "${user}"; the direct connection user is postgres.`)
    if (port === 6543) {
      refuse('FN_DEV_DB_URL uses port 6543, the Transaction pooler. Use the Session pooler (port 5432): loading the fixture needs a session setting to survive between statements.')
    }
    if (port !== 5432) refuse(`FN_DEV_DB_URL uses port ${port}; expected 5432.`)
    if (!password) refuse('FN_DEV_DB_URL has no password in it.')
  } else if (!LOCAL_HOSTS.has(url.hostname)) {
    refuse('with FN_DEV_PROJECT_REF=local, FN_DEV_DB_URL must point at 127.0.0.1 or localhost.')
  }
  return {
    host: url.hostname,
    port,
    user,
    password,
    database,
    describe: `${user}@${url.hostname}:${port}/${database}`,
  }
}

/**
 * Resolve and check the target. Makes no network request. Exits with code 2
 * if anything is not acceptable.
 */
export function loadConfig({ needApi = true, needDb = false } = {}) {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 22) refuse(`Node ${process.versions.node} is too old. The gate needs Node 22 or newer (for its built-in WebSocket, which Realtime uses).`)

  const fileVars = readEnvFile(ENV_FILE) ?? {}
  const get = (key) => String(process.env[key] ?? fileVars[key] ?? '').trim()

  const ignored = isGitIgnored(ENV_FILE)
  if (ignored === false) refuse(`${ENV_FILE} is not git-ignored. Add it to .gitignore before putting anything in it.`)

  const ref = get('FN_DEV_PROJECT_REF')
  if (!ref) refuse(`FN_DEV_PROJECT_REF is not set. Copy .env.integration.example to ${ENV_FILE} and fill it in.`)
  const mode = ref === 'local' ? 'local' : 'hosted'
  if (mode === 'hosted' && !HOSTED_REF.test(ref)) refuse(`FN_DEV_PROJECT_REF "${ref}" is not a Supabase project ref (20 lowercase letters or digits).`)

  // Projects this gate must never touch.
  const protectedRefs = []
  for (const r of get('FN_PROTECTED_PROJECT_REFS').split(',').map((s) => s.trim()).filter(Boolean)) {
    protectedRefs.push({ ref: r, source: 'FN_PROTECTED_PROJECT_REFS' })
  }
  const allowAppProject = get('FN_DEV_ALLOW_APP_PROJECT')
  for (const found of appProjectRefs()) {
    if (allowAppProject && allowAppProject === found.ref) continue
    protectedRefs.push(found)
  }
  if (mode === 'hosted') {
    const hit = protectedRefs.find((p) => p.ref === ref)
    if (hit) {
      refuse(`project ${ref} is protected (${hit.source}). The gate only runs against a disposable development project that nothing else uses.`)
    }
  }

  const config = { mode, ref, protectedRefs, envFile: ENV_FILE, envFileExists: existsSync(path.join(ROOT, ENV_FILE)), gitIgnored: ignored }

  if (needApi) {
    config.url = checkApiUrl(get('FN_DEV_SUPABASE_URL'), mode, ref)
    config.key = get('FN_DEV_SUPABASE_PUBLISHABLE_KEY')
    config.keyKind = checkKey(config.key, mode, ref)
  }
  if (needDb) {
    config.db = checkDbUrl(get('FN_DEV_DB_URL'), mode, ref)
    const ca = get('FN_DEV_DB_CA_FILE')
    config.db.caFile = ca ? path.resolve(ROOT, ca) : null
    if (config.db.caFile && !existsSync(config.db.caFile)) refuse(`FN_DEV_DB_CA_FILE ${ca} does not exist.`)
  }
  config.maxSignIns = Number(get('FN_DEV_MAX_SIGNINS') || 8)
  config.raceTrials = Math.max(1, Math.min(10, Number(get('FN_DEV_RACE_TRIALS') || 3)))
  return config
}

/** One paragraph a person can check before anything is sent anywhere. */
export function describeTarget(config) {
  const lines = []
  lines.push(`Target:     ${config.mode === 'hosted' ? `hosted Supabase project ${config.ref}` : 'a local Supabase stack'}`)
  if (config.url) lines.push(`API:        ${config.url}   (key: ${config.keyKind}, ${config.key.length} characters, never printed)`)
  if (config.db) {
    lines.push(`Database:   ${config.db.describe}   (password never printed; TLS ${config.db.caFile ? 'verified against ' + path.basename(config.db.caFile) : config.mode === 'hosted' ? 'on, certificate not verified' : 'off (local)'})`)
  }
  const protectedList = config.protectedRefs.map((p) => `${p.ref} (${p.source})`)
  lines.push(`Protected:  ${protectedList.length ? protectedList.join(', ') : 'none listed'}`)
  lines.push(`Config:     ${config.envFileExists ? config.envFile : 'environment only'}${config.gitIgnored ? ', git-ignored' : ''}`)
  return lines.join('\n')
}
