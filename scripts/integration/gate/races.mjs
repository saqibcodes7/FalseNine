/**
 * Gate section 8: the important races, through the real API, with separately
 * signed-in clients firing at the same moment.
 *
 * This does not replace `npm run test:concurrency`, which holds a transaction
 * open so the second request is guaranteed to arrive mid-flight, and which
 * shows what each lock and index is for. Here nothing can hold a request
 * open, so which one wins is down to the network. What is checked is that the
 * outcome is consistent whichever order they land in, several times over.
 */
import { describeError } from './kit.mjs'

const TURN_REFUSALS = ['ttt_not_your_turn', 'ttt_square_taken', 'ttt_footballer_used']
// A tap that lands after the board has somehow ended is refused this way too.
const TAP_REFUSALS = [...TURN_REFUSALS, 'ttt_no_board']

async function claimsOn(g, who, lobby, cell) {
  const board = await g.board(who, lobby)
  return { board, count: board.moves.filter((m) => m.kind === 'claim' && (cell === undefined || m.cell === cell)).length }
}

export async function races(g) {
  const { r } = g
  const { A, B, C, D, E } = g.users
  const trials = g.config.raceTrials
  r.section(`8. Races through the API (${trials} trials each)`)
  r.note('Requests are fired together from separate signed-in clients. Nothing holds them open, so the order is up to the network; the outcome must be consistent either way.')

  for (let t = 1; t <= trials; t++) {
    // Both players go for the same square.
    const K = await g.createLobby(A, 'Kai', 'medium', `K${t}`)
    await g.join(B, K, 'Ben')
    await g.call(A, 'ttt_start_game', { p_session_id: K.sid })
    let board = await g.board(A, K)
    const turn = board.game.turn_mark
    const T = board.userOf(turn)
    const N = board.userOf(turn === 'X' ? 'O' : 'X')
    const cell = board.candidates.findIndex((c) => c.length > 0)
    const f1 = board.candidates[cell][0]
    const f2 = board.candidates[cell][1] ?? g.allFootballers.find((n) => n !== f1)
    const [mine, theirs] = await Promise.all([g.move(T, K, cell, f1), g.move(N, K, cell, f2)])
    let after = await claimsOn(g, A, K, cell)
    r.check(`trial ${t}: both players go for square ${cell} at once: one claim, the other refused, and it is the other player's turn`,
      mine.data?.[0]?.outcome === 'claimed' && TURN_REFUSALS.includes(theirs.error?.hint) && after.count === 1 && after.board.game.turn_mark !== turn,
      `${T.label}: ${mine.data?.[0]?.outcome ?? describeError(mine.error)}; ${N.label}: ${describeError(theirs.error)}`)

    // Five taps at once from the player whose turn it is.
    await g.pass(N, K)
    board = await g.board(A, K)
    const cell2 = board.candidates.findIndex((c, i) => c.some((n) => !board.used.has(n)) && !board.claimedBy.has(i))
    const f3 = board.candidates[cell2].find((n) => !board.used.has(n))
    const taps = await Promise.all(Array.from({ length: 5 }, () => g.move(T, K, cell2, f3)))
    const landed = taps.filter((x) => x.data?.[0]?.outcome === 'claimed').length
    const refusedOk = taps.filter((x) => TAP_REFUSALS.includes(x.error?.hint)).length
    after = await claimsOn(g, A, K)
    r.check(`trial ${t}: five taps at once from one phone: exactly one lands`, landed === 1 && refusedOk === 4 && after.count === 2,
      `${landed} landed, ${refusedOk} refused, ${after.count} claims on the board`)
    await g.close(K)

    // The opponent leaves while the host is moving.
    const M = await g.createLobby(A, 'Mo', 'medium', `M${t}`)
    await g.join(B, M, 'Ben')
    await g.call(A, 'ttt_start_game', { p_session_id: M.sid })
    board = await g.board(A, M)
    if (board.markOf('A') !== board.game.turn_mark) {
      await g.pass(B, M)
      board = await g.board(A, M)
    }
    const hostCell = board.candidates.findIndex((c) => c.length > 0)
    const [hostMove, leave] = await Promise.all([
      g.move(A, M, hostCell, board.candidates[hostCell][0]),
      g.call(B, 'leave_session', { p_session_id: M.sid, p_player_id: null }),
    ])
    const final = await g.board(A, M)
    const session = (await g.table(A, 'sessions', (q) => q.eq('id', M.sid))).data?.[0]
    const seats = (await g.table(A, 'players', (q) => q.eq('session_id', M.sid))).data ?? []
    const moveFirst = hostMove.data?.[0]?.outcome === 'claimed'
    const leaveFirst = hostMove.error?.hint === 'ttt_no_board'
    r.check(`trial ${t}: the opponent leaves while the host moves: the host wins by forfeit and the lobby waits, whichever landed first`,
      !leave.error && (moveFirst || leaveFirst) && final.game.status === 'forfeited' && final.game.winner_mark === board.markOf('A') &&
      session?.status === 'waiting' && seats.length === 1 && final.moves.filter((x) => x.kind === 'claim').length === (moveFirst ? 1 : 0),
      `${moveFirst ? 'move landed first' : leaveFirst ? 'leave landed first' : describeError(hostMove.error)}; ${final.game.status}; lobby ${session?.status}`)
    await g.close(M)

    // One user double-taps Join.
    const J = await g.createLobby(A, 'Jo', 'medium', `J${t}`)
    const joins = await Promise.all([1, 2, 3].map((i) => g.call(D, 'join_session', { p_code: J.code, p_display_name: `Dee ${i}`, p_game_mode: 'tic_tac_toe' })))
    const won = joins.filter((x) => x.data?.[0])
    const already = joins.filter((x) => x.error?.hint === 'ttt_already_seated')
    const jSeats = (await g.table(A, 'players', (q) => q.eq('session_id', J.sid))).data ?? []
    const dSeat = await g.call(D, 'ttt_my_seat', { p_session_id: J.sid })
    r.check(`trial ${t}: one user taps Join three times at once: one seat, the others told they are already in`,
      won.length === 1 && already.length === 2 && jSeats.length === 2 && dSeat.data === won[0]?.data[0].player_id,
      `${won.length} joined, ${already.length} already in, ${jSeats.length} seats; others: ${joins.filter((x) => x.error && x.error.hint !== 'ttt_already_seated').map((x) => describeError(x.error)).join(', ') || 'none'}`)
    await g.close(J)

    // Two users race for the last seat.
    const S = await g.createLobby(A, 'Sol', 'medium', `S${t}`)
    const second = E ?? B
    const [c, e] = await Promise.all([
      g.call(C, 'join_session', { p_code: S.code, p_display_name: 'Cal', p_game_mode: 'tic_tac_toe' }),
      g.call(second, 'join_session', { p_code: S.code, p_display_name: 'Eve', p_game_mode: 'tic_tac_toe' }),
    ])
    const full = [c, e].filter((x) => x.error?.message === 'That game is full (2 players max)')
    const in_ = [c, e].filter((x) => x.data?.[0])
    const sSeats = (await g.table(A, 'players', (q) => q.eq('session_id', S.sid))).data ?? []
    r.check(`trial ${t}: two users race for the last seat: one gets it, the other is told the game is full`,
      in_.length === 1 && full.length === 1 && sSeats.length === 2,
      `C: ${c.data?.[0] ? 'seated' : describeError(c.error)}; ${second.label}: ${e.data?.[0] ? 'seated' : describeError(e.error)}`)
    await g.close(S)
  }
}
