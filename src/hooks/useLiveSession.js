import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured, PLAYER_COLUMNS } from '../lib/supabase'

/**
 * Live view of one game session, keyed by join code: the session row, its
 * seats, and whichever per-session tables the game says it needs. Every game
 * shares this; each game wraps it with its own list of tables (useLobby for
 * Football Imposter).
 *
 *   useLiveSession(code, {
 *     sessionColumns: SESSION_COLUMNS,
 *     tables: [
 *       { key: 'rounds', table: 'rounds', columns: ROUND_COLUMNS,
 *         order: 'started_at', skipWhileWaiting: true },
 *     ],
 *   })
 *
 * Pass `sessionColumns` and `tables` as module-level constants. They are part
 * of what makes a refresh, so a new array on every render would refetch on
 * every render.
 *
 * Football Imposter reads through the shared, signed-out client. A game whose
 * lobbies are only readable from a seat passes its own signed-in `client`,
 * and `enabled: false` until that client has its session, so nothing is
 * fetched or subscribed to before then: a subscription opened signed out would
 * be refused. `playerColumns` and `measureClock` let such a game read only
 * the seat columns it uses and skip the clock check it has no use for. Left
 * out, all four behave exactly as they always have.
 *
 * Every table in `tables` must have a `session_id` column: that is how rows
 * are fetched and how realtime is filtered.
 *
 * Realtime tells us *that* something changed; we then refetch. For a lobby
 * that is a handful of tiny queries, and it sidesteps a whole category of bug
 * where you try to merge an event payload into local state and get the
 * ordering wrong. If the websocket never connects (corporate wifi, flaky
 * tethering), it falls back to polling every 3s so the game still moves.
 *
 * One move can touch several tables and so start several refreshes at once.
 * Each refresh is numbered, and a reply is thrown away if a newer one has
 * already been shown, so a slow early reply can never put old state back on
 * screen.
 *
 * `clockOffset` is server time minus this phone's time, measured once, so
 * countdowns can be run against the server's deadline rather than trusting
 * the phone's clock.
 */

const NONE = Object.freeze([])
const EMPTY = Object.freeze({
  code: null,
  session: null,
  players: NONE,
  tables: Object.freeze({}),
  status: 'loading',
  error: null,
})

export function useLiveSession(
  code,
  {
    sessionColumns,
    tables = NONE,
    playerColumns = PLAYER_COLUMNS,
    client = supabase,
    enabled = true,
    measureClock = true,
  },
) {
  const normalised = code ? String(code).toUpperCase() : null
  const active = isSupabaseConfigured && Boolean(client) && enabled

  // Everything the screen reads lands in one piece of state, set in one go, so
  // a screen never sees a new status alongside rows from the previous fetch.
  const [view, setView] = useState(EMPTY)
  const [live, setLive] = useState(false)
  const [clockOffset, setClockOffset] = useState(0)

  const requested = useRef(0)
  const shown = useRef(0)

  const refresh = useCallback(async () => {
    if (!active || !normalised) return

    const request = ++requested.current
    const isStale = () => request < shown.current
    const show = (next) => {
      if (isStale()) return
      shown.current = request
      setView(next)
    }

    const { data: sessionRow, error: sessionError } = await client
      .from('sessions')
      .select(sessionColumns)
      .eq('code', normalised)
      .maybeSingle()

    if (sessionError) {
      // Keep what is on screen for this code; the poll will try again.
      if (isStale()) return
      shown.current = request
      setView((prev) =>
        prev.code === normalised
          ? { ...prev, status: 'error', error: sessionError.message }
          : { ...EMPTY, code: normalised, status: 'error', error: sessionError.message },
      )
      return
    }

    if (!sessionRow) {
      // The host closed the lobby, or the code was mistyped.
      show({ ...EMPTY, code: normalised, status: 'missing' })
      return
    }

    const waiting = sessionRow.status === 'waiting'
    const fetchRows = (table, columns, order) =>
      client
        .from(table)
        .select(columns)
        .eq('session_id', sessionRow.id)
        .order(order, { ascending: true })

    const [playersRes, ...tableResults] = await Promise.all([
      fetchRows('players', playerColumns, 'joined_at'),
      ...tables.map((t) =>
        t.skipWhileWaiting && waiting
          ? Promise.resolve({ data: [], error: null })
          : fetchRows(t.table, t.columns, t.order),
      ),
    ])

    const failed = [playersRes, ...tableResults].find((res) => res.error)?.error
    if (failed) {
      if (isStale()) return
      shown.current = request
      setView((prev) =>
        prev.code === normalised
          ? { ...prev, status: 'error', error: failed.message }
          : { ...EMPTY, code: normalised, status: 'error', error: failed.message },
      )
      return
    }

    show({
      code: normalised,
      session: sessionRow,
      players: playersRes.data ?? NONE,
      tables: Object.fromEntries(tables.map((t, i) => [t.key, tableResults[i].data ?? NONE])),
      status: 'ready',
      error: null,
    })
  }, [active, client, normalised, sessionColumns, playerColumns, tables])

  // Initial load, and again whenever the code changes.
  useEffect(() => {
    refresh()
  }, [refresh])

  // One clock check per page load. If it fails we assume the phone is right.
  useEffect(() => {
    if (!active || !measureClock) return
    const sent = Date.now()
    client.rpc('server_now').then(({ data }) => {
      if (!data) return
      const received = Date.now()
      const serverMs = new Date(data).getTime()
      // Assume the reply took as long to come back as the request took to go.
      setClockOffset(serverMs - (sent + received) / 2)
    })
  }, [active, client, measureClock])

  // Until this code's first answer arrives, whatever is in `view` belongs to
  // the previous code (or to nothing), so show loading rather than stale rows.
  const current = view.code === normalised ? view : EMPTY
  const sessionId = current.session?.id ?? null

  // Realtime subscription, re-established whenever the session id changes.
  useEffect(() => {
    if (!active || !sessionId) return undefined

    const on = (table, filter) => ({ event: '*', schema: 'public', table, filter })
    const bySession = `session_id=eq.${sessionId}`

    let channel = client
      .channel(`lobby:${sessionId}`)
      .on('postgres_changes', on('players', bySession), () => refresh())
      .on('postgres_changes', on('sessions', `id=eq.${sessionId}`), () => refresh())
    for (const t of tables) {
      channel = channel.on('postgres_changes', on(t.table, bySession), () => refresh())
    }
    channel.subscribe((channelStatus) => {
      setLive(channelStatus === 'SUBSCRIBED')
    })

    return () => {
      setLive(false)
      client.removeChannel(channel)
    }
  }, [active, client, sessionId, tables, refresh])

  // Polling fallback, only while the websocket is down.
  const pollable = current.status !== 'missing'
  useEffect(() => {
    if (!active || live || !pollable) return undefined
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [active, live, pollable, refresh])

  return {
    session: current.session,
    players: current.players,
    tables: current.tables,
    status: current.status,
    error: current.error,
    live,
    refresh,
    clockOffset,
  }
}
