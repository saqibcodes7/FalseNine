/**
 * The toolkit the API gate is written in: signed-in and signed-out clients,
 * RPC and table calls, checks on their results, reading a board and working
 * out right and wrong answers from the fictional fixture, and Realtime
 * subscriptions that record everything they receive.
 *
 * Everything goes through @supabase/supabase-js and the project's public API
 * with the publishable key, exactly as the browser will. Nothing here opens a
 * database connection.
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT } from '../config.mjs'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Raised to stop the whole gate when carrying on would only produce noise. */
export class Stop extends Error {}

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

/** The browser's localStorage, for one simulated device. Survives a "reload". */
export function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

export function decodeJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

export function describeError(error) {
  if (!error) return 'no error'
  return [error.code, error.message, error.hint ? `hint ${error.hint}` : null].filter(Boolean).join(' / ')
}

// 42501 permission denied; PGRST202 no such function and PGRST205 no such
// table, as PostgREST reports something it does not offer to the caller.
export const DENIED_CODES = ['42501', 'PGRST202', 'PGRST205']

const REQUEST_TIMEOUT_MS = 20000
const timedFetch = (input, init = {}) => fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

export class Gate {
  constructor(config, report) {
    this.config = config
    this.r = report
    this.signIns = 0
    this.clients = []
    this.channels = []
    this.users = {}
    this.lobbies = []
    this.keptSeats = []
    this.closedLobbies = []
    this.footballerIds = new Map()
    const oracle = JSON.parse(readFileSync(path.join(ROOT, 'scripts/integration/fixture-oracle.json'), 'utf8'))
    this.allFootballers = oracle.players
    this.members = new Map(oracle.categories.map((c) => [c.key, new Set(c.members)]))
  }

  // ---- Clients -------------------------------------------------------------

  newClient(storage = memoryStorage()) {
    const client = createClient(this.config.url, this.config.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage,
        storageKey: 'fn-integration-auth',
      },
      global: { fetch: timedFetch },
      realtime: { params: { eventsPerSecond: 50 } },
    })
    this.clients.push(client)
    return client
  }

  /** A browser with only the publishable key: no session, the anon role. */
  signedOut(label = 'signed out') {
    return { label, client: this.newClient(), id: null }
  }

  async signIn(label) {
    if (this.signIns >= this.config.maxSignIns) {
      throw new Stop(`the gate would need more than FN_DEV_MAX_SIGNINS=${this.config.maxSignIns} anonymous sign-ins`)
    }
    this.signIns += 1
    const storage = memoryStorage()
    const client = this.newClient(storage)
    const { data, error } = await client.auth.signInAnonymously()
    if (error || !data?.session) {
      const limited = error?.status === 429
        ? ". That is Supabase Auth's rate limit on anonymous sign-ins: raise it under Authentication > Rate Limits for the development project, or wait an hour"
        : ''
      throw new Stop(`anonymous sign-in for ${label} failed: ${error?.message ?? 'no session returned'}${error?.status ? ` (HTTP ${error.status})` : ''}${limited}`)
    }
    const user = { label, client, storage, id: data.user.id, user: data.user, session: data.session }
    this.users[label] = user
    return user
  }

  /** The same saved session opened by a brand-new client: a page reload. */
  reloaded(user) {
    return { label: `${user.label} (reloaded)`, client: this.newClient(user.storage), id: user.id }
  }

  // ---- Calls -----------------------------------------------------------------

  async call(who, fn, args = {}) {
    const { data, error } = await who.client.rpc(fn, args)
    return { data, error }
  }

  async table(who, table, build = (q) => q) {
    const { data, error } = await build(who.client.from(table).select('*'))
    return { data, error }
  }

  /**
   * Row count a caller can see, or 'denied' when the table itself is off
   * limits: permission denied (42501), or not offered by the API at all
   * (PGRST205), which is how PostgREST may present a table no browser role
   * holds any privilege on.
   */
  async count(who, table, build = (q) => q) {
    const { data, error } = await this.table(who, table, build)
    if (error) return DENIED_CODES.includes(error.code) ? 'denied' : `error ${describeError(error)}`
    return data.length
  }

  // ---- Checks ----------------------------------------------------------------

  ok(label, res, detail) {
    if (res.error) {
      this.r.fail(label, describeError(res.error))
      return null
    }
    this.r.pass(label, typeof detail === 'function' ? detail(res.data) : detail)
    return res.data ?? true
  }

  refused(label, res, hint) {
    if (res.error && res.error.hint === hint) return this.r.pass(label, res.error.message)
    return this.r.fail(label, `expected refusal with hint ${hint}, got: ${describeError(res.error)}`)
  }

  refusedWith(label, res, message) {
    if (res.error && res.error.message === message) return this.r.pass(label, message)
    return this.r.fail(label, `expected "${message}", got: ${describeError(res.error)}`)
  }

  /** Refused because the caller's role may not use it at all, whichever way PostgREST says so. */
  denied(label, res) {
    if (res.error && DENIED_CODES.includes(res.error.code)) return this.r.pass(label, `${res.error.code}: ${res.error.message}`)
    return this.r.fail(label, `expected permission denied (42501, or PGRST202/PGRST205 for something not offered to this role), got: ${describeError(res.error)}`)
  }

  notCallable(label, res) {
    if (res.error && ['42501', 'PGRST202'].includes(res.error.code)) {
      return this.r.pass(label, res.error.code === '42501' ? 'exists, but the browser roles may not execute it' : 'not in the API at all')
    }
    return this.r.fail(label, `expected it to be uncallable, got: ${describeError(res.error)}`)
  }

  missingFunction(label, res) {
    if (res.error && res.error.code === 'PGRST202') return this.r.pass(label, res.error.message)
    return this.r.fail(label, `expected PGRST202 (no such function), got: ${describeError(res.error)}`)
  }

  // ---- Lobbies ---------------------------------------------------------------

  async createLobby(host, name, difficulty = 'medium', label = name) {
    const res = await this.call(host, 'ttt_create_session', { p_display_name: name, p_difficulty: difficulty })
    const row = Array.isArray(res.data) ? res.data[0] : null
    if (res.error || !row) throw new Stop(`${host.label} could not create lobby ${label}: ${describeError(res.error)}`)
    const lobby = { label, sid: row.session_id, code: row.code, host, seats: { [host.label]: row.player_id }, users: { [row.player_id]: host } }
    this.lobbies.push(lobby)
    return lobby
  }

  async join(user, lobby, name) {
    const res = await this.call(user, 'join_session', { p_code: lobby.code, p_display_name: name, p_game_mode: 'tic_tac_toe' })
    const row = Array.isArray(res.data) ? res.data[0] : null
    if (row) {
      lobby.seats[user.label] = row.player_id
      lobby.users[row.player_id] = user
    }
    return { ...res, seat: row?.player_id ?? null }
  }

  /** Leave until the lobby is gone: the host leaving twice closes any lobby. */
  async close(lobby) {
    for (let i = 0; i < 2; i++) {
      await this.call(lobby.host, 'leave_session', { p_session_id: lobby.sid, p_player_id: null })
    }
    lobby.closed = true
    this.closedLobbies.push(lobby.sid)
  }

  keep(lobby, seats) {
    lobby.kept = true
    for (const s of seats) this.keptSeats.push({ ...s, sessionId: lobby.sid })
  }

  // ---- Boards ----------------------------------------------------------------

  async footballerId(name) {
    if (this.footballerIds.has(name)) return this.footballerIds.get(name)
    const anyone = this.users.A ?? this.signedOut()
    const { data, error } = await anyone.client.rpc('football_search_players', { p_query: name, p_limit: 20 })
    if (error) throw new Stop(`football_search_players failed for ${name}: ${describeError(error)}`)
    const hit = (data ?? []).find((row) => row.full_name === name)
    if (!hit) throw new Stop(`the fixture footballer ${name} was not found through football_search_players`)
    this.footballerIds.set(name, hit.id)
    return hit.id
  }

  async resolveAllFootballers() {
    for (let i = 0; i < this.allFootballers.length; i += 8) {
      await Promise.all(this.allFootballers.slice(i, i + 8).map((name) => this.footballerId(name)))
    }
    this.namesById = new Map([...this.footballerIds].map(([name, id]) => [id, name]))
  }

  /** Everything a seated player can read about the lobby's latest board, plus who fits each square. */
  async board(who, lobby) {
    const games = await this.table(who, 'ttt_games', (q) => q.eq('session_id', lobby.sid).order('board_number', { ascending: false }).limit(1))
    const game = games.data?.[0]
    if (!game) throw new Stop(`${who.label} cannot read a game in lobby ${lobby.label}: ${describeError(games.error)}`)
    const axes = await this.table(who, 'ttt_board_axes', (q) => q.eq('board_id', game.board_id))
    const moves = await this.table(who, 'ttt_moves', (q) => q.eq('game_id', game.id).order('move_number', { ascending: true }))
    if (axes.error || moves.error || axes.data.length !== 6) {
      throw new Stop(`${who.label} cannot read board ${game.board_number} of ${lobby.label}: ${describeError(axes.error ?? moves.error)}`)
    }
    const axis = (kind, pos) => axes.data.find((a) => a.axis === kind && a.position === pos)
    const candidates = []
    for (let cell = 0; cell < 9; cell++) {
      const row = axis('row', Math.floor(cell / 3))
      const col = axis('col', cell % 3)
      const a = this.members.get(`${row.category_type}:${row.label}`) ?? new Set()
      const b = this.members.get(`${col.category_type}:${col.label}`) ?? new Set()
      candidates.push([...a].filter((name) => b.has(name)))
    }
    const claims = moves.data.filter((m) => m.kind === 'claim')
    const claimedBy = new Map(claims.map((m) => [m.cell, m.mark]))
    const used = new Set(claims.map((m) => this.namesById.get(m.football_player_id)))
    const markOf = (userLabel) => (lobby.seats[userLabel] === game.x_player_id ? 'X' : lobby.seats[userLabel] === game.o_player_id ? 'O' : null)
    const userOf = (mark) => lobby.users[mark === 'X' ? game.x_player_id : game.o_player_id]
    return { game, axes: axes.data, moves: moves.data, candidates, claimedBy, used, markOf, userOf }
  }

  /** A line `mark` can still complete, with a different unused footballer for each empty square. */
  planLine(board, mark) {
    let best = null
    LINES.forEach((cells, line) => {
      if (cells.some((c) => board.claimedBy.has(c) && board.claimedBy.get(c) !== mark)) return
      const empty = cells.filter((c) => !board.claimedBy.has(c))
      const picks = []
      const taken = new Set(board.used)
      const assign = (i) => {
        if (i === empty.length) return true
        for (const name of board.candidates[empty[i]]) {
          if (taken.has(name)) continue
          taken.add(name)
          picks.push({ cell: empty[i], name })
          if (assign(i + 1)) return true
          picks.pop()
          taken.delete(name)
        }
        return false
      }
      if (assign(0) && (!best || empty.length < best.picks.length)) best = { line, picks: [...picks] }
    })
    return best
  }

  /** Someone who does NOT fit this square and has not claimed one on this board. */
  wrongAnswer(board, cell) {
    return this.allFootballers.find((name) => !board.candidates[cell].includes(name) && !board.used.has(name))
  }

  async move(who, lobby, cell, name) {
    const id = typeof name === 'string' && this.footballerIds.has(name) ? this.footballerIds.get(name) : name
    return this.call(who, 'ttt_submit_move', { p_session_id: lobby.sid, p_cell: cell, p_football_player_id: id })
  }

  pass(who, lobby) {
    return this.call(who, 'ttt_pass', { p_session_id: lobby.sid })
  }

  // ---- Realtime --------------------------------------------------------------

  /**
   * Subscribe `who` to a lobby's changes the way the app does (one filter per
   * table), or with no filters at all when `lobby` is null, to see whether
   * anything leaks to someone listening to everything.
   */
  async subscribe(who, lobby, label = who.label) {
    const events = []
    const statuses = []
    const system = []
    const channel = who.client.channel(`fn-int-${label.replace(/\W+/g, '-')}-${randomUUID().slice(0, 8)}`)
    const tables = [
      ['sessions', lobby ? `id=eq.${lobby.sid}` : undefined],
      ['players', lobby ? `session_id=eq.${lobby.sid}` : undefined],
      ['ttt_settings', lobby ? `session_id=eq.${lobby.sid}` : undefined],
      ['ttt_games', lobby ? `session_id=eq.${lobby.sid}` : undefined],
      ['ttt_moves', lobby ? `session_id=eq.${lobby.sid}` : undefined],
    ]
    for (const [table, filter] of tables) {
      const spec = { event: '*', schema: 'public', table }
      if (filter) spec.filter = filter
      channel.on('postgres_changes', spec, (p) => {
        events.push({ table: p.table, type: p.eventType, new: p.new ?? {}, old: p.old ?? {}, at: Date.now(), errors: p.errors ?? null })
      })
    }
    channel.on('system', {}, (m) => system.push(m))
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 20000)
      channel.subscribe((status, err) => {
        statuses.push(err ? `${status}: ${err.message}` : status)
        if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          clearTimeout(timer)
          resolve()
        }
      })
    })
    // Realtime confirms separately, with a system message, once the database
    // side of the subscription is in place. Changes made before that are not
    // delivered, so wait for it (or for an error) before relying on silence.
    const pgStatus = () => system.find((m) => m?.extension === 'postgres_changes')
    const until = Date.now() + 10000
    while (statuses.includes('SUBSCRIBED') && !pgStatus() && Date.now() < until) await sleep(100)
    const confirmation = pgStatus()
    const pgReady = confirmation?.status === 'ok'
    const sub = { label, who, channel, events, statuses, system, pgReady, pgMessage: confirmation?.message ?? 'no confirmation within 10 s' }
    this.channels.push(sub)
    return sub
  }

  async cleanup() {
    for (const sub of this.channels) await sub.who.client.removeChannel(sub.channel).catch(() => {})
    for (const lobby of this.lobbies) {
      if (!lobby.closed && !lobby.kept) await this.close(lobby).catch(() => {})
    }
    for (const client of this.clients) client.realtime.disconnect()
  }
}

/** Does this change belong to `sid`? DELETEs carry only a primary key, so they cannot be placed. */
export function aboutLobby(event, sid) {
  const rec = { ...event.old, ...event.new }
  return event.table === 'sessions' ? rec.id === sid : rec.session_id === sid
}
