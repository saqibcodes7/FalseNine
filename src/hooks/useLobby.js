import {
  SESSION_COLUMNS,
  ROUND_COLUMNS,
  VOTE_COLUMNS,
} from '../lib/supabase'
import { useLiveSession } from './useLiveSession'

/**
 * Live view of one game of Football Imposter, keyed by join code: the
 * session, its players, its rounds and its votes.
 *
 * The session, the seats, realtime, the polling fallback and the clock offset
 * are shared by every game and live in useLiveSession. What is Imposter's own
 * is the list below: rounds and votes, neither of which exists until the host
 * starts the game.
 *
 * Returns the same shape it always has, so the lobby and game screens do not
 * need to know it changed.
 */
const IMPOSTER_TABLES = [
  { key: 'rounds', table: 'rounds', columns: ROUND_COLUMNS, order: 'started_at', skipWhileWaiting: true },
  { key: 'votes', table: 'votes', columns: VOTE_COLUMNS, order: 'created_at', skipWhileWaiting: true },
]

const NONE = Object.freeze([])

export function useLobby(code) {
  const { session, players, tables, status, error, live, refresh, clockOffset } = useLiveSession(code, {
    sessionColumns: SESSION_COLUMNS,
    tables: IMPOSTER_TABLES,
  })

  return {
    session,
    players,
    rounds: tables.rounds ?? NONE,
    votes: tables.votes ?? NONE,
    status,
    error,
    live,
    refresh,
    clockOffset,
  }
}
