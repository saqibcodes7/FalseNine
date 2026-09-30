/**
 * What to tell a player when the Tic-Tac-Toe backend says no.
 *
 * Refusals from migration 0010 carry a stable hint (ttt_not_your_turn,
 * ttt_square_taken, ...) as well as a sentence, so this maps the hint, which
 * will not change when a message is reworded. The few refusals shared with
 * Football Imposter (joining, names) have no hint and are matched by message.
 *
 * A wrong answer is not an error: ttt_submit_move accepts it, records it and
 * passes the turn, and says only 'wrong'. The one line a player sees for it is
 * WRONG_ANSWER, which never says which half of the square missed. Nothing in
 * the app knows that; the server keeps it to itself.
 *
 * Anything this does not recognise is logged, so it gets noticed, and the
 * player gets a sentence they can do something with.
 *
 * Kept free of imports so it can be checked outside the browser.
 */

export const WRONG_ANSWER = 'Incorrect. Turn passes.'
export const RIGHT_ANSWER = 'Correct.'

const GENERIC = 'Something went wrong. Try again.'
const OFFLINE = 'Could not reach the game server. Check your connection and try again.'

const BY_HINT = {
  ttt_not_your_turn: () => "It's not your turn.",
  ttt_square_taken: () => 'That square has already been claimed.',
  ttt_unknown_footballer: () => 'Choose a footballer from the search results.',
  ttt_footballer_used: (error) => `${error.message.replace(/\.$/, '')}.`,
  ttt_bad_square: () => 'That square is not on the board.',
  ttt_no_board: () => 'That board has already finished.',
  ttt_already_seated: () => "You're already in this game.",
  ttt_not_in_game: () => "You're not in this game.",
  ttt_not_your_seat: () => 'You can only leave your own seat.',
  ttt_no_game: () => 'This game no longer exists.',
  ttt_wrong_game: () => 'That code is not for a Football Tic-Tac-Toe game.',
  ttt_game_over: () => 'This game is over.',
  ttt_need_two_players: () => 'You need an opponent before you can start.',
  ttt_no_board_found: () => 'Could not make a board at this difficulty. Try another difficulty.',
  ttt_no_auth: () => OFFLINE,
  ttt_not_host: (_error, context) =>
    ({
      difficulty: 'Only the host can change the difficulty.',
      start: 'Only the host can start the game.',
      rematch: 'Only the host can start the next board.',
    })[context] ?? 'Only the host can do that.',
  ttt_board_in_play: (_error, context) =>
    context === 'difficulty' ? 'Difficulty can be changed after this board.' : 'Finish this board first.',
}

// Refusals without a hint, matched by what the server says. The ones worth
// passing on as they are come back unchanged.
const BY_MESSAGE = [
  [/^That game is full/i, () => 'This game already has two players.'],
  [/^No game found with code/i, () => 'No game found with that code. Check it and try again.'],
  [/^That game has already started/i, () => 'That game has already started.'],
  [/^The game has already started/i, () => 'The game has already started.'],
  [/^There is no match to continue/i, () => 'This match has finished.'],
  [/^That code is for .+\. Join it from there\.$/i, (m) => m],
  [/^Someone in this game is already called /i, (m) => `${m}. Pick another name.`],
  [/^Enter a display name/i, () => 'Enter a name.'],
  [/^Display name must be 20 characters or fewer/i, () => 'Names are 20 characters at most.'],
  [/^Pick a difficulty/i, () => 'Pick a difficulty.'],
  [/^Failed to fetch$|NetworkError|Load failed|fetch failed/i, () => OFFLINE],
]

/**
 * A sentence for the player. `context` is what they were doing ('create',
 * 'join', 'start', 'rematch', 'difficulty', 'move', 'pass', 'leave', 'load'),
 * for the few refusals whose wording depends on it.
 */
export function tttErrorMessage(error, context = 'action') {
  if (!error) return GENERIC
  if (error.name === 'TttConnectError') return error.message

  const hint = typeof error.hint === 'string' ? error.hint : null
  if (hint && BY_HINT[hint]) return BY_HINT[hint](error, context)

  const message = String(error.message || error.error_description || '').trim()

  // The app is ahead of the database: a migration has not been run.
  if (error.code === 'PGRST202' || /could not find the function public\.\w+/i.test(message)) {
    logUnexpected(error, context)
    return 'The game server is a step behind the app. Try again later.'
  }
  // A session the server no longer accepts. Rare, since sessions refresh
  // themselves; a retry picks up the refreshed one.
  if (error.code === 'PGRST301' || /JWT expired|JWSError/i.test(message)) {
    return 'Your connection to the game dropped. Try again.'
  }

  for (const [pattern, say] of BY_MESSAGE) {
    if (pattern.test(message)) return say(message)
  }

  logUnexpected(error, context)
  return GENERIC
}

function logUnexpected(error, context) {
  console.error(`[tic-tac-toe] unexpected ${context} error`, {
    code: error?.code,
    message: error?.message,
    hint: error?.hint,
    details: error?.details,
  })
}

/**
 * True for refusals that mean "what you are looking at is out of date": the
 * board moved on, or ended, or the square went, while the player was
 * answering. The answer sheet closes and the real state is shown. A footballer
 * who has already been used is not one of these: the square is still there,
 * so the sheet stays open for another pick.
 */
export function isStaleStateError(error) {
  return ['ttt_not_your_turn', 'ttt_no_board', 'ttt_square_taken', 'ttt_game_over', 'ttt_board_in_play', 'ttt_not_in_game'].includes(error?.hint)
}
