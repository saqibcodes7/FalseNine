/**
 * A LOCAL STAND-IN for the three parts of Supabase the Tic-Tac-Toe screens
 * talk to, so their E2E tests can run with no Supabase project at all:
 *
 *   Auth      anonymous sign-in, token refresh, the current user
 *   REST      table reads (eq, in, is, order, limit) and RPCs by argument
 *             name, each run as the caller's role (anon or authenticated)
 *             with request.jwt.claims set, so auth.uid() and every row level
 *             security policy in the migrations apply exactly as written
 *   Realtime  postgres_changes over the Phoenix protocol (vsn 2.0.0). A
 *             change is sent to a subscriber only if the subscriber could
 *             SELECT that row, deletes carry the primary key only, and a
 *             channel that asks for a table its role may not read is refused,
 *             which is what hosted Realtime does
 *
 * It sits on a throwaway local database with the real migrations applied
 * (scripts/e2e-ttt/run.mjs makes one and drops it afterwards), so the game
 * rules, the seat checks and the privacy rules the browser meets are the real
 * ones. It is NOT Supabase and proves nothing about Supabase: the Stage 5A
 * integration gate is what checks the hosted project.
 *
 *   MOCK_DB_URL=postgresql://postgres@127.0.0.1:5433/fn_e2e_... node scripts/mock-supabase.mjs
 *
 * It refuses any database that is not on this machine, any host with
 * "supabase" in it, any database whose name does not start with fn_, and any
 * server carrying Supabase's own roles.
 *
 * GET /__mock/log returns what it has seen (sign-ins, refreshes, RPCs with
 * the caller's user id, Realtime joins with their role), so a test can check
 * which user made a move and that no protected subscription was ever opened
 * signed out. POST /__mock/log/clear empties it.
 *
 *   MOCK_SUPABASE_PORT    default 54329
 *   MOCK_PUBLISHABLE_KEY  default sb_publishable_mock_local_only
 *   MOCK_TOKEN_TTL        access token lifetime in seconds, default 3600
 */
import http from 'node:http'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.MOCK_SUPABASE_PORT || 54329)
const PUBLISHABLE = process.env.MOCK_PUBLISHABLE_KEY || 'sb_publishable_mock_local_only'
const TOKEN_TTL = Number(process.env.MOCK_TOKEN_TTL || 3600)
const SECRET = randomBytes(32).toString('hex')

// ---- Where it may point ---------------------------------------------------------
function refuse(message) {
  console.error(`mock-supabase refused: ${message}`)
  process.exit(2)
}

function dbConfig() {
  const raw = process.env.MOCK_DB_URL
  if (!raw) refuse('set MOCK_DB_URL to a throwaway local database.')
  let url
  try {
    url = new URL(raw)
  } catch {
    refuse('MOCK_DB_URL is not a postgresql:// URL.')
  }
  const socket = url.searchParams.get('host')
  const host = socket || decodeURIComponent(url.hostname) || 'localhost'
  if (/supabase/i.test(host)) refuse(`${host} is a Supabase host.`)
  if (!(host.startsWith('/') || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host))) refuse(`${host} is not a local server.`)
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!/^fn_[a-z0-9_]+$/.test(database)) refuse(`database "${database}" does not look like a throwaway test database (fn_...).`)
  return {
    host,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username || 'postgres'),
    password: decodeURIComponent(url.password || '') || undefined,
    database,
  }
}

const DB = dbConfig()
const pool = new pg.Pool({ ...DB, max: 30 })
{
  const probe = await pool.query(
    "select exists (select 1 from pg_roles where rolname in ('supabase_admin', 'supabase_auth_admin', 'authenticator')) as supabase",
  )
  if (probe.rows[0].supabase) refuse('this server has Supabase roles on it.')
}

// ---- What happened, for the tests ---------------------------------------------------
const log = []
const note = (entry) => log.push({ at: Date.now(), ...entry })

// ---- Tokens ----------------------------------------------------------------------------
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
function sign(claims) {
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64(claims)
  return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`
}
function verify(token) {
  const parts = String(token).split('.')
  if (parts.length !== 3) return { invalid: 'JWSError JWSInvalid' }
  const expected = createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url')
  if (expected !== parts[2]) return { invalid: 'JWSError JWSInvalidSignature' }
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  if (claims.exp && claims.exp < Date.now() / 1000) return { invalid: 'JWT expired' }
  return { claims }
}
function claimsFrom(bearer) {
  if (!bearer || bearer === PUBLISHABLE) return { claims: { role: 'anon' } }
  return verify(bearer)
}

const users = new Map()
const refreshTokens = new Map()
function issue(user) {
  const now = Math.floor(Date.now() / 1000)
  const claims = { aud: 'authenticated', exp: now + TOKEN_TTL, iat: now, iss: 'mock-supabase', sub: user.id, role: 'authenticated', is_anonymous: true, session_id: user.session_id }
  const refresh = randomBytes(16).toString('hex')
  refreshTokens.set(refresh, user.id)
  return { access_token: sign(claims), token_type: 'bearer', expires_in: TOKEN_TTL, expires_at: now + TOKEN_TTL, refresh_token: refresh, user }
}

// ---- HTTP plumbing -----------------------------------------------------------------------
function cors(req) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': req.headers['access-control-request-headers'] || 'authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-expose-headers': 'content-range, x-supabase-api-version',
    'access-control-max-age': '600',
  }
}
function send(req, res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', ...cors(req) })
  res.end(body === undefined ? '' : JSON.stringify(body))
}
async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const text = Buffer.concat(chunks).toString()
  return text ? JSON.parse(text) : {}
}
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { code: 'PGRST100' })
  return `"${s}"`
}

async function asRole(claims, fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`set local role ${claims.role === 'authenticated' ? 'authenticated' : 'anon'}`)
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

function pgError(req, res, error, role) {
  const code = error.code || 'XX000'
  const status = code === '42501' ? (role === 'anon' ? 401 : 403) : code === '23505' || code === '23503' ? 409 : code === 'P0002' ? 404 : 400
  send(req, res, status, { code, message: error.message, details: error.detail ?? null, hint: error.hint ?? null })
}

// ---- REST: tables ------------------------------------------------------------------------------
async function tableGet(req, res, name, params, claims) {
  const exists = await pool.query("select 1 from pg_class where relnamespace = 'public'::regnamespace and relname = $1 and relkind in ('r','v','m','p')", [name])
  if (!exists.rowCount) return send(req, res, 404, { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache`, details: null, hint: null })
  const select = params.get('select') || '*'
  const cols = select === '*' ? '*' : select.split(',').map((c) => ident(c.trim())).join(', ')
  const where = []
  const values = []
  let order = ''
  let limit = ''
  for (const [key, raw] of params) {
    if (key === 'select') continue
    if (key === 'order') {
      order = ' order by ' + raw.split(',').map((o) => {
        const [c, dir, nulls] = o.split('.')
        return `${ident(c)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullslast' ? ' nulls last' : nulls === 'nullsfirst' ? ' nulls first' : ''}`
      }).join(', ')
      continue
    }
    if (key === 'limit') { limit = ` limit ${Number(raw)}`; continue }
    if (key === 'offset') { limit += ` offset ${Number(raw)}`; continue }
    const dot = raw.indexOf('.')
    const op = raw.slice(0, dot)
    const val = raw.slice(dot + 1)
    if (op === 'eq') { values.push(val); where.push(`${ident(key)}::text = $${values.length}`) }
    else if (op === 'neq') { values.push(val); where.push(`${ident(key)}::text <> $${values.length}`) }
    else if (op === 'in') {
      values.push(val.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')))
      where.push(`${ident(key)}::text = any($${values.length}::text[])`)
    } else if (op === 'is') where.push(`${ident(key)} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`)
    else throw Object.assign(new Error(`unsupported operator ${op}`), { code: 'PGRST100' })
  }
  const sql = `select coalesce(json_agg(t), '[]'::json) as j from (select ${cols} from public.${ident(name)}${where.length ? ' where ' + where.join(' and ') : ''}${order}${limit}) t`
  note({ kind: 'table', table: name, role: claims.role, sub: claims.sub ?? null })
  try {
    const rows = await asRole(claims, (c) => c.query(sql, values))
    send(req, res, 200, rows.rows[0].j)
  } catch (error) {
    pgError(req, res, error, claims.role)
  }
}

// ---- REST: RPCs -----------------------------------------------------------------------------------
async function rpc(req, res, fn, args, claims) {
  const found = await pool.query(`
    select p.pronargs, p.pronargdefaults, p.proretset, p.prorettype = 'void'::regtype as is_void,
           p.prorettype::regtype::text as rettype, p.proargnames::text[] as proargnames, p.proargmodes::text[] as proargmodes,
           array(select format_type(t, null) from unnest(p.proargtypes) t) as argtypes
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [fn])
  const keys = Object.keys(args)
  let pick = null
  for (const f of found.rows) {
    const names = (f.proargnames ?? []).filter((_, i) => !f.proargmodes || ['i', 'b', 'v'].includes(f.proargmodes[i])).slice(0, f.pronargs)
    const required = names.slice(0, f.pronargs - f.pronargdefaults)
    if (keys.every((k) => names.includes(k)) && required.every((k) => keys.includes(k))) pick = { ...f, names }
  }
  note({ kind: 'rpc', fn, role: claims.role, sub: claims.sub ?? null, args })
  if (!pick) return send(req, res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn}(${keys.join(', ')}) in the schema cache`, details: null, hint: null })
  const values = []
  const argSql = keys.map((k) => {
    values.push(args[k])
    return `${ident(k)} => $${values.length}::${pick.argtypes[pick.names.indexOf(k)]}`
  }).join(', ')
  const call = `public.${ident(fn)}(${argSql})`
  const table = pick.proretset || pick.rettype === 'record'
  const sql = pick.is_void ? `select ${call}` : table ? `select coalesce(json_agg(t), '[]'::json) as j from ${call} t` : `select to_json(${call}) as j`
  try {
    const out = await asRole(claims, (c) => c.query(sql, values))
    if (pick.is_void) return send(req, res, 204)
    send(req, res, 200, out.rows[0].j)
  } catch (error) {
    pgError(req, res, error, claims.role)
  }
}

// ---- HTTP routes ----------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const p = url.pathname
    if (req.method === 'OPTIONS') return send(req, res, 204)

    if (p === '/__mock/log') return send(req, res, 200, log)
    if (p === '/__mock/log/clear' && req.method === 'POST') {
      log.length = 0
      return send(req, res, 200, { ok: true })
    }

    if (req.headers.apikey !== PUBLISHABLE) return send(req, res, 401, { message: 'Invalid API key' })
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null

    if (p === '/auth/v1/settings') return send(req, res, 200, { external: { anonymous_users: true }, disable_signup: false })
    if (p === '/auth/v1/signup' && req.method === 'POST') {
      const body = await readBody(req)
      if (body.email || body.phone) return send(req, res, 400, { msg: 'the mock only does anonymous sign-ins' })
      const now = new Date().toISOString()
      const user = { id: randomUUID(), aud: 'authenticated', role: 'authenticated', email: '', phone: '', app_metadata: { provider: 'anonymous', providers: [] }, user_metadata: {}, identities: [], created_at: now, updated_at: now, is_anonymous: true, session_id: randomUUID() }
      users.set(user.id, user)
      note({ kind: 'signup', sub: user.id })
      return send(req, res, 200, issue(user))
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const body = await readBody(req)
      const id = refreshTokens.get(body.refresh_token)
      if (!id) return send(req, res, 400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' })
      refreshTokens.delete(body.refresh_token)
      note({ kind: 'refresh', sub: id })
      return send(req, res, 200, issue(users.get(id)))
    }
    if (p === '/auth/v1/user') {
      const v = claimsFrom(bearer)
      if (v.invalid || v.claims.role !== 'authenticated') return send(req, res, 401, { message: 'invalid JWT' })
      return send(req, res, 200, users.get(v.claims.sub))
    }
    if (p === '/auth/v1/logout') return send(req, res, 204)

    if (p.startsWith('/rest/v1/')) {
      const v = claimsFrom(bearer)
      if (v.invalid) return send(req, res, 401, { code: 'PGRST301', message: v.invalid, details: null, hint: null })
      const rest = p.slice('/rest/v1/'.length)
      if (rest.startsWith('rpc/')) {
        const args = req.method === 'POST' ? await readBody(req) : Object.fromEntries(url.searchParams)
        return rpc(req, res, rest.slice(4), args, v.claims)
      }
      if (req.method === 'GET' || req.method === 'HEAD') return tableGet(req, res, rest, url.searchParams, v.claims)
      return send(req, res, 405, { code: 'PGRST', message: 'the mock only reads tables' })
    }
    send(req, res, 404, { message: `no route ${p}` })
  } catch (error) {
    send(req, res, 500, { code: error.code ?? 'MOCK', message: error.message })
  }
})

// ---- Realtime -----------------------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true })
const subs = new Set()
let bindingSeq = 1
const rlsTables = new Map()
const pkCols = new Map()

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname !== '/realtime/v1/websocket' || url.searchParams.get('apikey') !== PUBLISHABLE) return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
})

const out = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg))

// Changes are captured by a trigger per table, added the first time someone
// subscribes to it, one table at a time.
const triggers = new Map()
let triggerChain = Promise.resolve()
function ensureTrigger(table) {
  if (!triggers.has(table)) {
    const run = triggerChain.then(() => installTrigger(table))
    triggerChain = run.catch(() => {})
    triggers.set(table, run)
  }
  return triggers.get(table)
}
async function installTrigger(table) {
  const pk = await pool.query(`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = ('public.' || $1)::regclass and i.indisprimary`, [table])
  pkCols.set(table, pk.rows.map((r) => r.attname))
  const rls = await pool.query(`select relrowsecurity from pg_class where oid = ('public.' || $1)::regclass`, [table])
  rlsTables.set(table, rls.rows[0].relrowsecurity)
  await pool.query('create schema if not exists mock_realtime')
  await pool.query(`create or replace function mock_realtime.notify() returns trigger language plpgsql security definer as $f$
    begin
      perform pg_notify('mock_realtime', json_build_object('table', tg_table_name, 'type', tg_op,
        'record', case when tg_op <> 'DELETE' then row_to_json(new) end,
        'old', case when tg_op <> 'INSERT' then row_to_json(old) end, 'at', now())::text);
      return null;
    end $f$`)
  await pool.query(`drop trigger if exists mock_realtime_${table} on public.${ident(table)}`)
  await pool.query(`create trigger mock_realtime_${table} after insert or update or delete on public.${ident(table)} for each row execute function mock_realtime.notify()`)
}

function filterMatches(filter, row) {
  if (!filter) return true
  const m = filter.match(/^([a-z_]+)=eq\.(.+)$/)
  return Boolean(m && row && String(row[m[1]]) === m[2])
}

async function canSee(claims, table, row) {
  const cols = pkCols.get(table)
  const where = cols.map((c, i) => `${ident(c)}::text = $${i + 1}`).join(' and ')
  try {
    const r = await asRole(claims, (c) => c.query(`select 1 from public.${ident(table)} where ${where}`, cols.map((c) => String(row[c]))))
    return r.rowCount > 0
  } catch {
    return false
  }
}

async function onChange(change) {
  const { table, type, record, old } = change
  const pkOnly = (row) => Object.fromEntries(pkCols.get(table).map((c) => [c, row[c]]))
  for (const sub of subs) {
    const ids = sub.bindings
      .filter((b) => b.table === table && (b.event === '*' || b.event === type) && filterMatches(b.filter, type === 'DELETE' ? old : record))
      .map((b) => b.id)
    if (!ids.length) continue
    if (type !== 'DELETE' && !(await canSee(sub.claims, table, record))) continue
    const data = {
      schema: 'public', table, commit_timestamp: change.at, type, columns: [], errors: null,
      record: type === 'DELETE' ? {} : record,
      old_record: type === 'INSERT' ? {} : rlsTables.get(table) ? pkOnly(old) : old,
    }
    out(sub.ws, [sub.joinRef, null, sub.topic, 'postgres_changes', { ids, data }])
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => handle(raw).catch((e) => console.error('mock realtime:', e.message)))
  async function handle(raw) {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    const [joinRef, ref, topic, event, payload] = msg
    if (topic === 'phoenix' && event === 'heartbeat') return out(ws, [null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }])
    if (event === 'phx_join') {
      const v = claimsFrom(payload?.access_token || null)
      if (v.invalid) return out(ws, [joinRef, ref, topic, 'phx_reply', { status: 'error', response: { reason: v.invalid } }])
      const bindings = []
      for (const b of payload?.config?.postgres_changes ?? []) {
        await ensureTrigger(b.table)
        bindings.push({ id: bindingSeq++, event: b.event, schema: b.schema, table: b.table, filter: b.filter })
      }
      const role = v.claims.role === 'authenticated' ? 'authenticated' : 'anon'
      let denied = null
      for (const b of bindings) {
        const ok = (await pool.query("select has_table_privilege($1, 'public.' || $2, 'SELECT') as ok", [role, b.table])).rows[0].ok
        if (!ok) {
          denied = b
          break
        }
      }
      note({ kind: 'join', topic, role, sub: v.claims.sub ?? null, tables: bindings.map((b) => b.table), accepted: !denied })
      out(ws, [joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: bindings.map(({ id, event: e, schema, table, filter }) => ({ id, event: e, schema, table, ...(filter ? { filter } : {}) })) } }])
      const system = (status, message) => setTimeout(() => out(ws, [joinRef, null, topic, 'system', { channel: topic.replace(/^realtime:/, ''), extension: 'postgres_changes', message, status }]), 100)
      if (denied) {
        return system('error', `Unable to subscribe to changes with given parameters. [event: ${denied.event}, schema: ${denied.schema}, table: ${denied.table}, filters: [${denied.filter ?? ''}]]. Exception: permission denied`)
      }
      subs.add({ ws, topic, joinRef, claims: v.claims, bindings })
      return system('ok', 'Subscribed to PostgreSQL')
    }
    if (event === 'access_token') {
      const v = claimsFrom(payload?.access_token)
      if (!v.invalid) {
        for (const s of subs) if (s.ws === ws && s.topic === topic) s.claims = v.claims
        note({ kind: 'access_token', topic, sub: v.claims.sub ?? null })
      }
      return
    }
    if (event === 'phx_leave') {
      for (const s of [...subs]) if (s.ws === ws && s.topic === topic) subs.delete(s)
      return out(ws, [joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }])
    }
    if (ref) out(ws, [joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }])
  }
  ws.on('close', () => {
    for (const s of [...subs]) if (s.ws === ws) subs.delete(s)
  })
})

const listener = new pg.Client(DB)
await listener.connect()
await listener.query('listen mock_realtime')
listener.on('notification', (n) => onChange(JSON.parse(n.payload)).catch((e) => console.error('mock realtime:', e.message)))

server.listen(PORT, '127.0.0.1', () => console.log(`mock supabase on http://127.0.0.1:${PORT} (database ${DB.database})`))
