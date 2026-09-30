import { useEffect, useMemo, useState } from 'react'
import { useLiveSession } from './useLiveSession'
import { TTT_PLAYER_COLUMNS, TTT_SESSION_COLUMNS, TTT_TABLES, fetchBoard, fetchLines, fetchMySeat } from '../lib/tttApi'
import { boardAxes, boardCells, latestGame, movesOf, turnInStep } from '../lib/tttBoard'

/**
 * Live view of one Football Tic-Tac-Toe lobby, keyed by join code, read
 * through one signed-in client: the lobby, its seats, its settings, its
 * boards and moves, the current board's rows and columns, and which seat is
 * the caller's own.
 *
 * The lobby, the seats, Realtime and the polling fallback come from
 * useLiveSession, which every game shares. Realtime says that something
 * changed and the hook fetches again; it never merges an event into state, so
 * a delete that arrives with only a primary key (all Realtime sends for a
 * deleted row under row level security) works the same as anything else.
 *
 * `ready` must stay false until the client has its session. Until then
 * nothing is fetched and nothing is subscribed to: a subscription opened
 * signed out would be refused, and rightly.
 *
 * A lobby is only readable from a seat in it, so a code that does not exist
 * and a lobby this user has no seat in look the same: status 'missing'.
 *
 * `mySeat` is undefined until the server has answered, then the caller's
 * seat id or null. It comes from ttt_my_seat, which only ever answers about
 * the caller, never from anything saved on the device.
 */
const NONE = Object.freeze([])
const RETRY_MS = 2000

export function useTicTacToeSession(client, code, { ready }) {
  const { session, players, tables, status, error, live, refresh } = useLiveSession(code, {
    sessionColumns: TTT_SESSION_COLUMNS,
    playerColumns: TTT_PLAYER_COLUMNS,
    tables: TTT_TABLES,
    client,
    enabled: ready,
    measureClock: false,
  })

  const games = tables.games ?? NONE
  const allMoves = tables.moves ?? NONE
  const settings = tables.settings?.[0] ?? null
  const game = useMemo(() => latestGame(games), [games])
  const moves = useMemo(() => movesOf(allMoves, game?.id), [allMoves, game?.id])
  const cells = useMemo(() => boardCells(moves), [moves])
  const inStep = turnInStep(game, moves)
  const sessionId = session?.id ?? null
  const boardId = game?.board_id ?? null

  // A failed fetch below is tried again a couple of seconds later, so one
  // dropped request can never leave a screen waiting for something that
  // nothing else is going to ask for again.
  const [retries, setRetries] = useState(0)
  const retrySoon = () => setTimeout(() => setRetries((n) => n + 1), RETRY_MS)

  // ---- whose seat is mine -------------------------------------------------
  // Asked again whenever the seats change.
  const [seatState, setSeatState] = useState({ sessionId: null, seat: undefined })
  const seatsKey = players.map((p) => p.id).join(',')
  useEffect(() => {
    if (!ready || !client || !sessionId) return undefined
    let cancelled = false
    let timer = null
    fetchMySeat(client, sessionId).then(({ seat, error: seatError }) => {
      if (cancelled) return
      if (seatError) timer = retrySoon()
      else setSeatState({ sessionId, seat })
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, ready, sessionId, seatsKey, retries])
  const mySeat = seatState.sessionId === sessionId ? seatState.seat : undefined

  // ---- the board's rows, columns and difficulty -----------------------------
  // A board never changes once made, so each is fetched once.
  const [boards, setBoards] = useState({})
  const haveBoard = Boolean(boardId && boards[boardId])
  useEffect(() => {
    if (!ready || !client || !boardId || haveBoard) return undefined
    let cancelled = false
    let timer = null
    fetchBoard(client, boardId).then(({ axes: rows, difficulty, error: boardError }) => {
      if (cancelled) return
      if (boardError || rows.length !== 6) timer = retrySoon()
      else setBoards((prev) => ({ ...prev, [boardId]: { axes: rows, difficulty } }))
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, ready, boardId, haveBoard, retries])
  const board = boardId ? boards[boardId] : null
  const axes = useMemo(() => boardAxes(board?.axes), [board])

  // ---- the eight lines, to light up the one the server says won -------------
  const [lines, setLines] = useState(NONE)
  const needLines = game?.status === 'won' && lines.length === 0
  useEffect(() => {
    if (!ready || !client || !needLines) return undefined
    let cancelled = false
    let timer = null
    fetchLines(client).then(({ lines: rows, error: linesError }) => {
      if (cancelled) return
      if (linesError || !rows.length) timer = retrySoon()
      else setLines(rows)
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, ready, needLines, retries])

  // Half a move on screen (see turnInStep): fetch again straight away.
  useEffect(() => {
    if (!ready || inStep) return undefined
    const timer = setTimeout(refresh, 300)
    return () => clearTimeout(timer)
  }, [ready, inStep, refresh])

  // A refresh that failed while Realtime still looks connected would
  // otherwise not be tried again until something else happened. Keep trying
  // until one succeeds.
  useEffect(() => {
    if (!ready || status !== 'error') return undefined
    const timer = setInterval(refresh, RETRY_MS)
    return () => clearInterval(timer)
  }, [ready, status, refresh])

  return {
    status,
    inStep,
    error,
    live,
    refresh,
    session,
    players,
    settings,
    games,
    game,
    moves,
    cells,
    axes,
    boardDifficulty: board?.difficulty ?? null,
    lines,
    mySeat,
  }
}
