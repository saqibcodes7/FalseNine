import { passTurn, submitMove } from './tttApi'
import { tttErrorMessage, isStaleStateError } from './tttErrors'

/**
 * A move and a pass, as both modes make them, turned into what the board
 * screen needs to know. The client is the one belonging to the player whose
 * turn it is; the server checks that for itself either way.
 *
 * { ok: true, outcome }           the turn was used: 'claimed', 'wrong' or 'pass'
 * { ok: false, message, stale }   refused, turn not used; `stale` when the
 *                                 board had moved on and should be fetched again
 */
export async function playMove(client, sessionId, cell, footballerId) {
  const { result, error } = await submitMove(client, sessionId, cell, footballerId)
  if (error) return { ok: false, message: tttErrorMessage(error, 'move'), stale: isStaleStateError(error) }
  if (result?.outcome !== 'claimed' && result?.outcome !== 'wrong') {
    console.error('[tic-tac-toe] ttt_submit_move returned something unexpected', result)
    return { ok: false, message: 'Something went wrong. Try again.', stale: true }
  }
  return { ok: true, outcome: result.outcome }
}

export async function playPass(client, sessionId) {
  const { error } = await passTurn(client, sessionId)
  if (error) return { ok: false, message: tttErrorMessage(error, 'pass'), stale: isStaleStateError(error) }
  return { ok: true, outcome: 'pass' }
}
