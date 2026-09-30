import { ensureSession, restoreSession, tttClient } from './tttClient'
import { createGame, fetchMySeat, joinGame, leaveGame, startGame } from './tttApi'
import { tttErrorMessage } from './tttErrors'

/**
 * Pass & Play Football Tic-Tac-Toe: two people, one device, and the same
 * server-refereed game as Online.
 *
 * The backend gives every seat to a signed-in user and never lets one user
 * hold both seats of a game, so the two people here are two anonymous users,
 * each with their own client and their own saved session (tttClient 'p1' and
 * 'p2'). Player 1 creates an ordinary lobby, Player 2 joins it, Player 1
 * starts it. From then on every move goes through the client of whoever's
 * turn it is, and the server checks it exactly as it checks an Online move.
 * There is no local rules engine and no shortcut on the server.
 *
 * What is saved on the device is only where to look: the lobby's id and code.
 * After a reload both sessions are restored, both seats are asked for again,
 * and the board is read from the server. If any of that fails, nothing is
 * made up: the screen says so and offers a new game.
 */

const RECORD_KEY = 'fn:passplay:tic_tac_toe'
const NAMES_KEY = 'fn:passplay:tic_tac_toe:setup'

export function loadPassRecord() {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECORD_KEY))
    return value && typeof value.sessionId === 'string' && typeof value.code === 'string' ? value : null
  } catch {
    return null
  }
}

function savePassRecord(record) {
  try {
    window.localStorage.setItem(RECORD_KEY, JSON.stringify({ ...record, savedAt: Date.now() }))
  } catch {
    // Without storage the game still plays; it just cannot survive a reload.
  }
}

export function clearPassRecord() {
  try {
    window.localStorage.removeItem(RECORD_KEY)
  } catch {
    // Nothing useful to do.
  }
}

/** The names and difficulty last used, to fill the setup screen in. Convenience only. */
export function loadPassSetup() {
  try {
    return JSON.parse(window.localStorage.getItem(NAMES_KEY)) ?? {}
  } catch {
    return {}
  }
}

function savePassSetup(setup) {
  try {
    window.localStorage.setItem(NAMES_KEY, JSON.stringify(setup))
  } catch {
    // Convenience only.
  }
}

/** A setup or restore step failed. `message` is fit to show. */
export class PassPlayError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PassPlayError'
  }
}

export const passClients = () => ({ p1: tttClient('p1'), p2: tttClient('p2') })

/**
 * Set up a new game: both players' sessions, Player 1's lobby, Player 2's
 * seat in it, both seats confirmed by the server, and the first board.
 * Always a brand-new lobby. If any step fails, the lobby made so far is
 * closed again and a PassPlayError says what went wrong.
 */
export async function setUpPassGame({ p1Name, p2Name, difficulty }) {
  const { p1, p2 } = passClients()
  const [s1, s2] = [await ensureSession(p1), await ensureSession(p2)]
  if (s1.user.id === s2.user.id) {
    throw new PassPlayError('The two players on this device could not be told apart. Try again.')
  }

  const created = await createGame(p1, { name: p1Name, difficulty })
  if (created.error || !created.row) throw new PassPlayError(tttErrorMessage(created.error, 'create'))
  const { session_id: sessionId, code, player_id: hostSeat } = created.row
  savePassRecord({ sessionId, code })
  savePassSetup({ p1: p1Name, p2: p2Name, difficulty })

  try {
    const joined = await joinGame(p2, { code, name: p2Name })
    if (joined.error || !joined.row) throw new PassPlayError(tttErrorMessage(joined.error, 'join'))

    const [one, two] = await Promise.all([fetchMySeat(p1, sessionId), fetchMySeat(p2, sessionId)])
    if (one.error || two.error || one.seat !== hostSeat || two.seat !== joined.row.player_id || one.seat === two.seat) {
      throw new PassPlayError('Could not seat both players. Try again.')
    }

    const started = await startGame(p1, sessionId)
    if (started.error) throw new PassPlayError(tttErrorMessage(started.error, 'start'))

    return { sessionId, code, seats: { p1: one.seat, p2: two.seat } }
  } catch (error) {
    await endPassGame(sessionId, hostSeat).catch(() => {})
    throw error instanceof PassPlayError ? error : new PassPlayError(tttErrorMessage(error, 'create'))
  }
}

/**
 * Pick a saved game back up after a reload: both sessions, then both seats,
 * from the server. Resolves { seats }, or { gone } saying why there is no
 * game to go back to ('players' when this device no longer has the two
 * players' sessions, 'finished' when the server has no such game for them).
 * Throws when the server cannot be reached.
 */
export async function restorePassGame(record) {
  const { p1, p2 } = passClients()
  const [s1, s2] = await Promise.all([restoreSession(p1), restoreSession(p2)])
  if (!s1 || !s2 || s1.user.id === s2.user.id) return { gone: 'players' }

  const [one, two] = await Promise.all([fetchMySeat(p1, record.sessionId), fetchMySeat(p2, record.sessionId)])
  if (one.error || two.error) throw new PassPlayError(tttErrorMessage(one.error ?? two.error, 'load'))
  if (!one.seat || !two.seat || one.seat === two.seat) return { gone: 'finished' }
  return { seats: { p1: one.seat, p2: two.seat } }
}

/**
 * End the game for good, through Player 1, the host. Between boards that
 * closes the lobby at once. In the middle of a board the server first records
 * it as forfeited and keeps the host's seat, so the host leaves a second time
 * to close it. Neither player is signed out: both are reused next game.
 */
export async function endPassGame(sessionId, hostSeat) {
  const { p1 } = passClients()
  const first = await leaveGame(p1, sessionId, hostSeat)
  if (first.error) return { error: first.error }
  const still = await fetchMySeat(p1, sessionId)
  if (still.error) return { error: still.error }
  if (still.seat) {
    const second = await leaveGame(p1, sessionId, still.seat)
    if (second.error) return { error: second.error }
  }
  clearPassRecord()
  return { error: null }
}
