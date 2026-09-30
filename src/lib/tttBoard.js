/**
 * Reading a Football Tic-Tac-Toe lobby's rows into what the screen shows.
 *
 * Everything here is arithmetic on rows the server has already decided: who
 * is X, whose turn it is, which squares are claimed, whether the board is won,
 * drawn or forfeited, and which line won. None of it judges an answer, finds a
 * winner, spots a draw or decides a turn. The server does all of that, and a
 * screen built from these functions can only ever show what it said.
 *
 * Kept free of imports so it can be checked outside the browser.
 */

export const MARKS = Object.freeze(['X', 'O'])

export const otherMark = (mark) => (mark === 'X' ? 'O' : mark === 'O' ? 'X' : null)

/** The lobby's newest board, or null before the first one. */
export function latestGame(games) {
  let latest = null
  for (const game of games ?? []) {
    if (!latest || game.board_number > latest.board_number) latest = game
  }
  return latest
}

/** One board's moves, oldest first. */
export function movesOf(moves, gameId) {
  if (!gameId) return []
  return (moves ?? []).filter((m) => m.game_id === gameId).sort((a, b) => a.move_number - b.move_number)
}

/** Nine squares, 0 to 8 left to right and top to bottom: null, or who claimed it with whom. */
export function boardCells(moves) {
  const cells = Array.from({ length: 9 }, () => null)
  for (const move of moves ?? []) {
    if (move.kind === 'claim' && move.cell >= 0 && move.cell <= 8) {
      cells[move.cell] = { mark: move.mark, footballer: move.footballer_name, moveNumber: move.move_number }
    }
  }
  return cells
}

/** The three rows and three columns, in position order, or null until all six are there. */
export function boardAxes(axes) {
  const rows = [null, null, null]
  const cols = [null, null, null]
  for (const a of axes ?? []) {
    const list = a.axis === 'row' ? rows : a.axis === 'col' ? cols : null
    if (list && a.position >= 0 && a.position <= 2) list[a.position] = a
  }
  if ([...rows, ...cols].some((a) => !a)) return null
  return { rows, cols }
}

/** Square number to its row and column positions. */
export const rowOf = (cell) => Math.floor(cell / 3)
export const colOf = (cell) => cell % 3

/** The mark this seat plays on this board, or null (not on it, or seat gone). */
export function markOfSeat(game, seatId) {
  if (!game || !seatId) return null
  if (game.x_player_id === seatId) return 'X'
  if (game.o_player_id === seatId) return 'O'
  return null
}

/** The name recorded for a mark. Stays even after that player has left. */
export function nameOfMark(game, mark) {
  if (!game) return null
  return mark === 'X' ? game.x_name : mark === 'O' ? game.o_name : null
}

/**
 * Where the lobby is, from the server's own statuses:
 *
 *   lobby    waiting for a start (no board yet, or an opponent left)
 *   playing  a board is in play
 *   between  the last board is over and the match can go on
 *   ended    the host left mid-board; nothing more can happen here
 */
export function matchPhase(session, game) {
  if (!session) return null
  if (session.status === 'waiting') return 'lobby'
  if (session.status === 'ended') return 'ended'
  if (game?.status === 'playing') return 'playing'
  return 'between'
}

/**
 * Whether a board in play and its moves agree about whose turn it is. Every
 * recorded move passes the turn (a claim that does not end the board, a wrong
 * answer, a pass), so the starter is up after an even number of moves and the
 * other mark after an odd number. The board row and the moves are fetched
 * separately, and a fetch can land between the two writes of a move; when
 * they disagree, the screen is looking at half a move and must wait for the
 * next fetch rather than act on it.
 */
export function turnInStep(game, moves) {
  if (!game || game.status !== 'playing') return true
  const expected = (moves ?? []).length % 2 === 0 ? game.starter_mark : otherMark(game.starter_mark)
  return game.turn_mark === expected
}

/**
 * Identifies one turn of one board. It changes exactly when the server
 * records a move (a claim, a wrong answer or a pass), which is exactly when
 * the turn passes. A refused attempt records nothing and leaves it alone.
 */
export function turnKey(game, moves) {
  if (!game || game.status !== 'playing') return null
  return `${game.id}:${(moves ?? []).length}:${game.turn_mark}`
}

export const lastMove = (moves) => (moves && moves.length ? moves[moves.length - 1] : null)

/**
 * Boards won by each mark in the current match: the boards played by these
 * same two seats. A new opponent starts a new match, and their seat is not on
 * the older boards, so those drop out by themselves.
 */
export function matchScore(games, game) {
  const score = { X: 0, O: 0, drawn: 0, boards: 0 }
  if (!game?.x_player_id || !game?.o_player_id) return score
  for (const g of games ?? []) {
    if (g.x_player_id !== game.x_player_id || g.o_player_id !== game.o_player_id) continue
    if (g.status === 'playing') continue
    score.boards += 1
    if (g.winner_mark === 'X' || g.winner_mark === 'O') score[g.winner_mark] += 1
    else score.drawn += 1
  }
  return score
}

/** The squares of the line the server said won, from ttt_lines. */
export function winningCells(game, lines) {
  if (!game || game.status !== 'won' || game.winning_line == null) return []
  const line = (lines ?? []).find((l) => l.line === game.winning_line)
  return line ? line.cells.map(Number) : []
}

/**
 * Pass & Play: which of the two people on this device is which seat and which
 * mark, and whose turn it is. `seats` holds each person's seat as the server
 * gave it to their own client (ttt_my_seat). Marks come from the board, which
 * the server's coin toss decided, never from who is Player 1.
 *
 * `acting` is the person whose client must make the next move, or null when
 * no board is in play. `consistent` is false if the board and the two seats
 * do not add up (one of them is not on it, or both claim the same mark), in
 * which case the screen must not let anyone act.
 */
export function passSeating(game, seats) {
  const p1 = { seat: seats?.p1 ?? null, mark: markOfSeat(game, seats?.p1) }
  const p2 = { seat: seats?.p2 ?? null, mark: markOfSeat(game, seats?.p2) }
  const consistent = Boolean(game && p1.mark && p2.mark && p1.mark !== p2.mark)
  let acting = null
  if (consistent && game.status === 'playing') {
    acting = game.turn_mark === p1.mark ? 'p1' : game.turn_mark === p2.mark ? 'p2' : null
  }
  return { p1, p2, consistent, acting }
}
