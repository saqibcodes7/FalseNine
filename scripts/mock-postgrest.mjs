/**
 * A very small stand-in for Supabase's REST layer, backed by a local Postgres.
 * It exists only so the create/join/lobby screens can be exercised in CI or on
 * a plane, without a real project. It implements exactly the handful of
 * requests this app makes and nothing else.
 *
 * Needs a local Postgres with the migration applied, and the `pg` driver, which
 * is deliberately not a dependency of the app:
 *
 *   npm i -D pg
 *   createdb false_nine && psql false_nine -f supabase/migrations/0001_init.sql
 *   npm run mock:api
 *
 * Then point VITE_SUPABASE_URL at http://localhost:54321. Realtime will not
 * connect, which is fine — useLobby falls back to polling, and that path could
 * do with the exercise anyway.
 *
 * Not part of the app. Delete it whenever it stops being useful.
 */
import http from 'node:http'
import pg from 'pg'

const pool = new pg.Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'false_nine',
})

const PORT = Number(process.env.MOCK_PORT || 54321)

function send(res, code, body) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-expose-headers': 'content-range',
  })
  res.end(payload)
}

/** `code=eq.ABC12` -> { column: 'code', op: 'eq', value: 'ABC12' } */
function parseFilter(key, raw) {
  const [op, ...rest] = raw.split('.')
  return { column: key, op, value: rest.join('.') }
}

async function handleRpc(name, body, res) {
  const keys = Object.keys(body)
  const args = keys.map((k) => body[k])
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')

  try {
    const { rows } = await pool.query(`select * from public.${name}(${named})`, args)
    // Supabase returns a table-returning function as an array of rows, and a
    // void function as null. Mirror that so the client code sees what it will
    // see in production.
    if (rows.length === 1 && Object.keys(rows[0]).length === 1) {
      const only = Object.values(rows[0])[0]
      if (only === null) return send(res, 200, null)
    }
    return send(res, 200, rows)
  } catch (err) {
    return send(res, 400, {
      message: err.message,
      code: err.code,
      details: null,
      hint: null,
    })
  }
}

async function handleSelect(table, url, req, res) {
  const select = url.searchParams.get('select') || '*'
  const wheres = []
  const values = []
  let order = ''

  for (const [key, raw] of url.searchParams.entries()) {
    if (key === 'select') continue
    if (key === 'order') {
      const [col, dir] = raw.split('.')
      order = ` order by ${col} ${dir === 'desc' ? 'desc' : 'asc'}`
      continue
    }
    const f = parseFilter(key, raw)
    if (f.op !== 'eq') continue
    values.push(f.value)
    wheres.push(`${f.column} = $${values.length}`)
  }

  const sql =
    `select ${select} from public.${table}` +
    (wheres.length ? ` where ${wheres.join(' and ')}` : '') +
    order

  try {
    const { rows } = await pool.query(sql, values)
    const wantsObject = String(req.headers.accept || '').includes('pgrst.object')
    if (wantsObject) {
      if (rows.length === 0) return send(res, 200, null)
      return send(res, 200, rows[0])
    }
    return send(res, 200, rows)
  } catch (err) {
    return send(res, 400, { message: err.message, code: err.code })
  }
}

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204)

    const url = new URL(req.url, `http://localhost:${PORT}`)
    const path = url.pathname.replace(/^\/rest\/v1/, '')

    if (req.method === 'POST' && path.startsWith('/rpc/')) {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        let body = {}
        try {
          body = raw ? JSON.parse(raw) : {}
        } catch {
          return send(res, 400, { message: 'bad json' })
        }
        handleRpc(path.slice('/rpc/'.length), body, res)
      })
      return undefined
    }

    if (req.method === 'GET' && path.length > 1) {
      return handleSelect(path.slice(1), url, req, res)
    }

    return send(res, 404, { message: 'not implemented by the mock' })
  })
  .listen(PORT, () => {
    console.log(`mock postgrest on http://localhost:${PORT}`)
  })
