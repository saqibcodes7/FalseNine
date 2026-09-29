/**
 * Gate sections 0 to 6: the project answers, Anonymous Auth, a whole
 * Tic-Tac-Toe match through the API, nobody acting for anyone else, who can
 * read what, and leaving.
 */
import { randomUUID } from 'node:crypto'
import { Stop, decodeJwt, describeError } from './kit.mjs'

const RESULT_KEYS = 'end_reason,game_status,outcome,winner_mark'
const TTT_TABLES = ['ttt_settings', 'ttt_games', 'ttt_moves', 'ttt_boards', 'ttt_board_axes']

// ---------------------------------------------------------------------------
export async function preflight(g) {
  const { r, config } = g
  r.section('0. The development project answers')
  let settings
  try {
    const res = await fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: config.key }, signal: AbortSignal.timeout(20000) })
    settings = res.ok ? await res.json() : null
    r.check('the Auth API answers the publishable key', res.ok, `HTTP ${res.status}`)
  } catch (error) {
    throw new Stop(`could not reach ${config.url}: ${error.message}`)
  }
  if (!settings) throw new Stop('the Auth API did not accept the publishable key')
  const anonymous = settings.external?.anonymous_users
  if (anonymous === undefined) {
    r.info('the Auth settings do not say whether Anonymous Sign-ins are on; the first sign-in will tell', Object.keys(settings.external ?? {}).join(', '))
  } else if (!r.check('Anonymous Sign-ins are enabled', anonymous === true, `external.anonymous_users = ${anonymous}`)) {
    throw new Stop('turn on Anonymous Sign-ins for the development project (see scripts/integration/README.md), then run the gate again')
  }
  if (!r.check('new sign-ups are allowed (an anonymous sign-in is a sign-up)', settings.disable_signup === false, `disable_signup = ${settings.disable_signup}`)) {
    throw new Stop('turn on "Allow new users to sign up" for the development project, then run the gate again')
  }

  const out = g.signedOut()
  const lines = await g.table(out, 'ttt_lines')
  if (lines.error) {
    throw new Stop(`the Data API cannot see ttt_lines (${describeError(lines.error)}): migration 0010 is not applied, or the API has not reloaded its schema`)
  }
  r.check('the Tic-Tac-Toe schema is live in the Data API: anyone can read the eight winning lines', lines.data.length === 8, `${lines.data.length} lines`)
  await g.resolveAllFootballers()
  r.pass(`every footballer in the fictional fixture is found through football_search_players (${g.footballerIds.size})`)
}

// ---------------------------------------------------------------------------
export async function anonymousAuth(g) {
  const { r } = g
  r.section('1. Anonymous Auth')
  const A = await g.signIn('A')
  const claims = decodeJwt(A.session.access_token) ?? {}
  r.check('signInAnonymously() creates a real anonymous user', A.user.is_anonymous === true && Boolean(A.id), `user ${A.id}`)
  r.check("the user's access token is for the authenticated role, marked anonymous, and names that user",
    claims.role === 'authenticated' && claims.is_anonymous === true && claims.sub === A.id,
    { role: claims.role, is_anonymous: claims.is_anonymous, aud: claims.aud, lifetime_seconds: claims.exp - claims.iat })

  const B = await g.signIn('B')
  const C = await g.signIn('C')
  const D = await g.signIn('D')
  r.check('four sign-ins are four different users', new Set([A, B, C, D].map((u) => u.id)).size === 4)

  const out = g.signedOut()
  const none = await out.client.auth.getSession()
  r.check('a client holding only the publishable key has no user', !none.data.session)

  const reloaded = g.reloaded(A)
  const again = await reloaded.client.auth.getSession()
  r.check('a new client over the same saved session is the same user, with no new sign-in', again.data.session?.user?.id === A.id)
  g.reloadedA = reloaded
}

// ---------------------------------------------------------------------------
export async function wholeMatch(g) {
  const { r } = g
  const { A, B, C, D } = g.users
  r.section('2. A whole match through the API (lobby L)')

  const L = await g.createLobby(A, 'Ana', 'medium', 'L')
  g.L = L
  r.pass('A creates a Tic-Tac-Toe lobby with ttt_create_session', `code ${L.code}`)

  const mine = await g.call(A, 'ttt_my_seat', { p_session_id: L.sid })
  r.check("auth.uid() inside the RPCs is A's user: ttt_my_seat gives back the seat ttt_create_session made for A", mine.data === L.seats.A, describeError(mine.error))
  const mineReloaded = await g.call(g.reloadedA, 'ttt_my_seat', { p_session_id: L.sid })
  r.check('after a reload, the saved session still holds that seat', mineReloaded.data === L.seats.A, describeError(mineReloaded.error))

  const before = (await A.client.auth.getSession()).data.session.access_token
  const refreshed = await A.client.auth.refreshSession()
  const after = refreshed.data?.session
  r.check('refreshing the token gives a new access token for the same user',
    !refreshed.error && after?.user?.id === A.id && after.access_token !== before, describeError(refreshed.error))
  const mineRefreshed = await g.call(A, 'ttt_my_seat', { p_session_id: L.sid })
  r.check('and the same seat', mineRefreshed.data === L.seats.A, describeError(mineRefreshed.error))

  const out = g.signedOut()
  g.refused('signed out, joining a Tic-Tac-Toe lobby is refused', await g.call(out, 'join_session', { p_code: L.code, p_display_name: 'Nobody', p_game_mode: 'tic_tac_toe' }), 'ttt_no_auth')
  g.denied('signed out, ttt_create_session is refused', await g.call(out, 'ttt_create_session', { p_display_name: 'Nobody' }))

  const joined = await g.join(B, L, 'Ben')
  g.ok('B joins with join_session', joined)
  const bSeat = await g.call(B, 'ttt_my_seat', { p_session_id: L.sid })
  r.check("B's ttt_my_seat is the seat join_session made for B", bSeat.data === L.seats.B && bSeat.data !== L.seats.A)
  const cSeat = await g.call(C, 'ttt_my_seat', { p_session_id: L.sid })
  r.check('a user with no seat here gets no seat from ttt_my_seat', cSeat.data === null && !cSeat.error, describeError(cSeat.error))
  g.refused('B joining a second time is refused', await g.join(B, L, 'Ben again'), 'ttt_already_seated')
  g.refusedWith('a third player is refused: exactly two seats', await g.join(D, L, 'Dee'), 'That game is full (2 players max)')
  const seats = await g.table(A, 'players', (q) => q.eq('session_id', L.sid))
  r.check('the lobby has exactly two seats, host first', seats.data?.length === 2 && seats.data.some((p) => p.is_host && p.display_name === 'Ana'),
    seats.data?.map((p) => p.display_name).join(', '))

  // A lobby kept open for integration:dev:verify to inspect seat ownership.
  const EV = await g.createLobby(A, 'Evidence', 'medium', 'EV')
  await g.join(B, EV, 'Ben')
  g.keep(EV, [
    { label: 'EV host', user: 'A', via: 'ttt_create_session', playerId: EV.seats.A },
    { label: 'EV opponent', user: 'B', via: 'join_session', playerId: EV.seats.B },
  ])

  // Settings in the lobby, then kick-off.
  g.ok('the host changes the difficulty in the lobby', await g.call(A, 'ttt_update_settings', { p_session_id: L.sid, p_difficulty: 'easy' }))
  g.refused('the guest cannot change it', await g.call(B, 'ttt_update_settings', { p_session_id: L.sid, p_difficulty: 'hard' }), 'ttt_not_host')
  g.refused('the guest cannot start the game', await g.call(B, 'ttt_start_game', { p_session_id: L.sid }), 'ttt_not_host')
  const started = await g.call(A, 'ttt_start_game', { p_session_id: L.sid })
  if (started.error?.hint === 'ttt_no_board_found') {
    throw new Stop("no board could be made: the development project is still on the 'standard' difficulty profile, which the small fixture cannot satisfy. Run npm run integration:dev:migrate, which switches it to 'dev'.")
  }
  g.ok('the host starts board 1 with ttt_start_game', started)

  let board = await g.board(A, L)
  const boardRow = await g.table(A, 'ttt_boards', (q) => q.eq('id', board.game.board_id))
  r.check('board 1 is in play, X to move, at the difficulty chosen in the lobby',
    board.game.board_number === 1 && board.game.status === 'playing' && board.game.turn_mark === 'X' && boardRow.data?.[0]?.difficulty === 'easy',
    `${board.game.status}, turn ${board.game.turn_mark}, ${boardRow.data?.[0]?.difficulty}`)
  g.refused('changing the difficulty while the board is in play is refused', await g.call(A, 'ttt_update_settings', { p_session_id: L.sid, p_difficulty: 'hard' }), 'ttt_board_in_play')
  const settings = await g.table(A, 'ttt_settings', (q) => q.eq('session_id', L.sid))
  r.check('and the difficulty did not change', settings.data?.[0]?.difficulty === 'easy')

  const X = board.userOf('X')
  const O = board.userOf('O')
  r.info('the coin toss', `${X.label} is X, ${O.label} is O`)
  const plan = g.planLine(board, 'X')
  if (!plan) throw new Stop('board 1 has no line X can complete with different footballers. That is rare; run the gate again for a new board.')
  const [first, ...rest] = plan.picks

  g.refused('O moving on X\'s turn is refused', await g.move(O, L, first.cell, first.name), 'ttt_not_your_turn')
  g.refused('O passing on X\'s turn is refused', await g.pass(O, L), 'ttt_not_your_turn')

  const claim = await g.move(X, L, first.cell, first.name)
  const row = claim.data?.[0]
  r.check('X names a footballer who fits both criteria: the square is claimed', row?.outcome === 'claimed' && row.game_status === 'playing', describeError(claim.error))
  r.check('the move result says only outcome, game status, end reason and winner', row && Object.keys(row).sort().join(',') === RESULT_KEYS, row ? Object.keys(row).join(', ') : '')

  g.refused('O naming someone for the square X holds is refused', await g.move(O, L, first.cell, g.allFootballers.find((n) => n !== first.name)), 'ttt_square_taken')
  const otherCell = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((c) => c !== first.cell && !plan.picks.some((p) => p.cell === c)) ?? rest[0].cell
  g.refused('O naming a footballer X has already used is refused', await g.move(O, L, otherCell, first.name), 'ttt_footballer_used')
  g.refused('square 9 is refused', await g.move(O, L, 9, first.name), 'ttt_bad_square')
  g.refused('a footballer who does not exist is refused', await g.move(O, L, otherCell, randomUUID()), 'ttt_unknown_footballer')
  board = await g.board(A, L)
  r.check('none of those refusals used up O\'s turn or recorded anything', board.moves.length === 1 && board.game.turn_mark === 'O', `${board.moves.length} moves, turn ${board.game.turn_mark}`)

  const wrongName = g.wrongAnswer(board, otherCell)
  const wrong = await g.move(O, L, otherCell, wrongName)
  const wrongRow = wrong.data?.[0]
  r.check('O names someone who does not fit: told only "wrong", no square, turn passes',
    wrongRow?.outcome === 'wrong' && wrongRow.game_status === 'playing' && wrongRow.end_reason === null && wrongRow.winner_mark === null,
    wrongRow ?? describeError(wrong.error))
  board = await g.board(A, L)
  const wrongMove = board.moves.find((m) => m.kind === 'wrong')
  r.check('the wrong answer is on the record for both players, with nothing about which half failed',
    Boolean(wrongMove) && !Object.keys(wrongMove).some((k) => /row_ok|col_ok/.test(k)) && board.game.turn_mark === 'X' && !board.claimedBy.has(otherCell),
    wrongMove ? Object.keys(wrongMove).join(', ') : 'no wrong move visible')
  g.denied('why it was wrong (ttt_move_checks) stays unreadable', await g.table(O, 'ttt_move_checks'))

  g.ok('X passes', await g.pass(X, L))
  g.ok('O passes', await g.pass(O, L))
  board = await g.board(A, L)
  r.check('each pass handed the turn over', board.game.turn_mark === 'X' && board.moves.filter((m) => m.kind === 'pass').length === 2)

  let last = null
  for (const [i, pick] of rest.entries()) {
    last = await g.move(X, L, pick.cell, pick.name)
    if (last.error || last.data?.[0]?.outcome !== 'claimed') break
    if (i < rest.length - 1) await g.pass(O, L)
  }
  const final = last?.data?.[0]
  board = await g.board(A, L)
  r.check('X completes a line and wins; the winning move says so',
    final?.game_status === 'won' && final.winner_mark === 'X' && final.end_reason === 'line' && board.game.status === 'won' && board.game.winning_line === plan.line,
    final ?? describeError(last?.error))
  const wrongSeat = board.moves.filter((m) => m.player_id !== (m.mark === 'X' ? board.game.x_player_id : board.game.o_player_id))
  r.check('every move is recorded against the seat of the user who made it', wrongSeat.length === 0, `${board.moves.length} moves`)

  // Between boards.
  g.refused('the guest cannot call the rematch', await g.call(B, 'ttt_rematch', { p_session_id: L.sid }), 'ttt_not_host')
  g.refused('the guest cannot change the difficulty between boards', await g.call(B, 'ttt_update_settings', { p_session_id: L.sid, p_difficulty: 'hard' }), 'ttt_not_host')
  g.ok('the host changes the difficulty between boards', await g.call(A, 'ttt_update_settings', { p_session_id: L.sid, p_difficulty: 'extreme' }))
  g.ok('the host calls the rematch with ttt_rematch', await g.call(A, 'ttt_rematch', { p_session_id: L.sid }))
  const second = await g.board(A, L)
  const secondRow = await g.table(A, 'ttt_boards', (q) => q.eq('id', second.game.board_id))
  r.check('board 2 keeps the marks, the other player starts, on a new board',
    second.game.board_number === 2 && second.game.x_player_id === board.game.x_player_id && second.game.starter_mark === 'O' && second.game.turn_mark === 'O' && second.game.board_id !== board.game.board_id)
  r.check('and it uses the difficulty chosen between boards', secondRow.data?.[0]?.difficulty === 'extreme', secondRow.data?.[0]?.difficulty)
  g.refused('changing the difficulty during board 2 is refused', await g.call(A, 'ttt_update_settings', { p_session_id: L.sid, p_difficulty: 'easy' }), 'ttt_board_in_play')
  g.L_boards = [board.game.board_id, second.game.board_id]
  g.L_moves = board.moves.length
}

// ---------------------------------------------------------------------------
export async function nobodyActsForAnyoneElse(g) {
  const { r } = g
  const { A, B, C, D } = g.users
  const L = g.L
  r.section('3. Nobody can act for anyone else')
  r.note('None of the Tic-Tac-Toe RPCs take a player id; each acts for the caller\'s own seat. leave_session still takes one, for Football Imposter.')

  const Z = await g.createLobby(C, 'Cal', 'medium', 'Z')
  g.Z = Z
  let board = await g.board(A, L)
  const turnBefore = board.game.turn_mark
  const T = board.userOf(turnBefore)
  const N = board.userOf(turnBefore === 'X' ? 'O' : 'X')
  const open = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((c) => board.candidates[c].length > 0)
  const someone = board.candidates[open][0]

  g.refused(`${N.label}, whose turn it is not, cannot claim a square`, await g.move(N, L, open, someone), 'ttt_not_your_turn')
  g.refused(`${N.label} cannot pass for ${T.label}`, await g.pass(N, L), 'ttt_not_your_turn')
  g.refused('B cannot change the host\'s settings', await g.call(B, 'ttt_update_settings', { p_session_id: L.sid, p_difficulty: 'easy' }), 'ttt_not_host')
  g.refused('B cannot start the host\'s game', await g.call(B, 'ttt_start_game', { p_session_id: L.sid }), 'ttt_not_host')
  g.refused('B cannot call the host\'s rematch', await g.call(B, 'ttt_rematch', { p_session_id: L.sid }), 'ttt_not_host')
  g.refused('B cannot make A leave, even with A\'s player id', await g.call(B, 'leave_session', { p_session_id: L.sid, p_player_id: L.seats.A }), 'ttt_not_your_seat')
  g.refused('A cannot make B leave, even with B\'s player id', await g.call(A, 'leave_session', { p_session_id: L.sid, p_player_id: L.seats.B }), 'ttt_not_your_seat')

  const outsiders = [
    [C, 'C, seated in another lobby,', 'ttt_not_in_game'],
    [D, 'D, signed in with no seat,', 'ttt_not_in_game'],
  ]
  for (const [who, name, hint] of outsiders) {
    g.refused(`${name} cannot claim a square`, await g.move(who, L, open, someone), hint)
    g.refused(`${name} cannot pass`, await g.pass(who, L), hint)
    g.refused(`${name} cannot change settings`, await g.call(who, 'ttt_update_settings', { p_session_id: L.sid, p_difficulty: 'easy' }), hint)
    g.refused(`${name} cannot start`, await g.call(who, 'ttt_start_game', { p_session_id: L.sid }), hint)
    g.refused(`${name} cannot call a rematch`, await g.call(who, 'ttt_rematch', { p_session_id: L.sid }), hint)
    g.refused(`${name} cannot make A leave`, await g.call(who, 'leave_session', { p_session_id: L.sid, p_player_id: L.seats.A }), 'ttt_not_your_seat')
  }
  const out = g.signedOut()
  g.denied('signed out, claiming a square is refused', await g.move(out, L, open, someone))
  g.denied('signed out, passing is refused', await g.pass(out, L))
  g.denied('signed out, changing settings is refused', await g.call(out, 'ttt_update_settings', { p_session_id: L.sid, p_difficulty: 'easy' }))
  g.denied('signed out, starting is refused', await g.call(out, 'ttt_start_game', { p_session_id: L.sid }))
  g.denied('signed out, calling a rematch is refused', await g.call(out, 'ttt_rematch', { p_session_id: L.sid }))
  g.denied('signed out, ttt_my_seat is refused', await g.call(out, 'ttt_my_seat', { p_session_id: L.sid }))
  g.refused('signed out, making A leave is refused', await g.call(out, 'leave_session', { p_session_id: L.sid, p_player_id: L.seats.A }), 'ttt_not_your_seat')
  g.refused('A cannot change the settings of a lobby A is not in', await g.call(A, 'ttt_update_settings', { p_session_id: Z.sid, p_difficulty: 'easy' }), 'ttt_not_in_game')
  g.refused('A cannot start a lobby A is not in', await g.call(A, 'ttt_start_game', { p_session_id: Z.sid }), 'ttt_not_in_game')

  // A token is only as good as its signature. Take A's real token, change the
  // user id inside it to B's, and send it straight to the API; then the same
  // claims with no signature at all.
  const aToken = (await A.client.auth.getSession()).data.session?.access_token
  const [head, , sig] = aToken.split('.')
  const forgedBody = Buffer.from(JSON.stringify({ ...decodeJwt(aToken), sub: B.id })).toString('base64url')
  const unsignedHead = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  for (const [label, token] of [
    ["A's own token with the user id inside changed to B's", `${head}.${forgedBody}.${sig}`],
    ['an unsigned token naming B', `${unsignedHead}.${forgedBody}.`],
  ]) {
    let status = 0
    let body
    try {
      const res = await fetch(`${g.config.url}/rest/v1/rpc/ttt_my_seat`, {
        method: 'POST',
        headers: { apikey: g.config.key, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_session_id: L.sid }),
        signal: AbortSignal.timeout(20000),
      })
      status = res.status
      body = await res.text()
    } catch (error) {
      body = error.message
    }
    r.check(`${label} is rejected before it reaches the database`,
      (status === 401 || status === 403) && !body.includes(L.seats.B), `HTTP ${status} ${body.slice(0, 160)}`)
  }

  const F = await g.signIn('F')
  r.check('a browser that lost its saved session signs in as a new, different user', F.id !== A.id && F.id !== B.id)
  const fSeat = await g.call(F, 'ttt_my_seat', { p_session_id: L.sid })
  r.check('which holds no seat in the old lobby', fSeat.data === null && !fSeat.error)
  g.refused('and cannot act in it', await g.move(F, L, open, someone), 'ttt_not_in_game')

  board = await g.board(A, L)
  const players = await g.table(A, 'players', (q) => q.eq('session_id', L.sid))
  const settings = await g.table(A, 'ttt_settings', (q) => q.eq('session_id', L.sid))
  const zPlayers = await g.table(C, 'players', (q) => q.eq('session_id', Z.sid))
  r.check('nothing anyone tried changed either lobby',
    board.moves.length === 0 && board.game.status === 'playing' && board.game.turn_mark === turnBefore &&
    players.data?.length === 2 && settings.data?.[0]?.difficulty === 'extreme' && zPlayers.data?.length === 1,
    `L: ${board.moves.length} moves on board 2, ${players.data?.length} seats, ${settings.data?.[0]?.difficulty}; Z: ${zPlayers.data?.length} seat`)
}

// ---------------------------------------------------------------------------
async function lobbyView(g, who, L) {
  const ids = g.L_boards
  return {
    sessions: await g.count(who, 'sessions', (q) => q.eq('id', L.sid)),
    by_code: await g.count(who, 'sessions', (q) => q.eq('code', L.code)),
    players: await g.count(who, 'players', (q) => q.eq('session_id', L.sid)),
    settings: await g.count(who, 'ttt_settings', (q) => q.eq('session_id', L.sid)),
    games: await g.count(who, 'ttt_games', (q) => q.eq('session_id', L.sid)),
    moves: await g.count(who, 'ttt_moves', (q) => q.eq('session_id', L.sid)),
    boards: await g.count(who, 'ttt_boards', (q) => q.in('id', ids)),
    axes: await g.count(who, 'ttt_board_axes', (q) => q.in('board_id', ids)),
  }
}

const show = (v) => Object.entries(v).map(([k, n]) => `${k} ${n}`).join(', ')

export async function whoCanRead(g) {
  const { r } = g
  const { A, B, C, D } = g.users
  const { L, Z } = g
  r.section('4. Who can read what')
  const full = { sessions: 1, by_code: 1, players: 2, settings: 1, games: 2, moves: g.L_moves, boards: 2, axes: 12 }
  const nothing = { sessions: 0, by_code: 0, players: 0, settings: 0, games: 0, moves: 0, boards: 0, axes: 0 }
  const signedOutNothing = { sessions: 0, by_code: 0, players: 0, settings: 'denied', games: 'denied', moves: 'denied', boards: 'denied', axes: 'denied' }

  for (const who of [A, B]) {
    const v = await lobbyView(g, who, L)
    r.check(`${who.label}, seated, reads everything the lobby needs`, JSON.stringify(v) === JSON.stringify(full), show(v))
  }
  const vc = await lobbyView(g, C, L)
  r.check('C, seated in another lobby, reads nothing of L, even by its id, code and board ids', JSON.stringify(vc) === JSON.stringify(nothing), show(vc))
  const vd = await lobbyView(g, D, L)
  r.check('D, signed in with no seat, reads nothing of L', JSON.stringify(vd) === JSON.stringify(nothing), show(vd))
  const out = g.signedOut()
  const vo = await lobbyView(g, out, L)
  r.check('signed out, L is invisible and the gameplay tables are refused outright', JSON.stringify(vo) === JSON.stringify(signedOutNothing), show(vo))

  // Scanning whole tables.
  const gateLobbies = new Set(g.lobbies.map((l) => l.sid))
  gateLobbies.delete(Z.sid)
  const scan = async (who) => {
    const sessions = (await g.table(who, 'sessions', (q) => q.eq('game_mode', 'tic_tac_toe'))).data ?? []
    const players = ((await who.client.from('players').select('session_id').limit(5000)).data ?? []).filter((p) => gateLobbies.has(p.session_id))
    const rows = {}
    for (const t of TTT_TABLES) {
      const res = await g.table(who, t, (q) => q.limit(5000))
      rows[t] = res.error ? (res.error.code === '42501' ? 'denied' : describeError(res.error)) : res.data
    }
    return { sessions, players, rows }
  }
  const sc = await scan(C)
  const cLeak = TTT_TABLES.filter((t) => Array.isArray(sc.rows[t]) && sc.rows[t].some((row) => (row.session_id ?? null) !== Z.sid))
  r.check('scanning whole tables, C finds only its own lobby',
    sc.sessions.every((s) => s.id === Z.sid) && sc.sessions.length === 1 && sc.players.length === 0 && cLeak.length === 0 &&
    sc.rows.ttt_games.length === 0 && sc.rows.ttt_boards.length === 0 && sc.rows.ttt_board_axes.length === 0,
    `Tic-Tac-Toe sessions ${sc.sessions.length}, other lobbies' seats ${sc.players.length}, ttt rows ${TTT_TABLES.map((t) => `${t} ${Array.isArray(sc.rows[t]) ? sc.rows[t].length : sc.rows[t]}`).join(', ')}`)
  const sd = await scan(D)
  r.check('scanning whole tables, D finds no Tic-Tac-Toe rows at all',
    sd.sessions.length === 0 && sd.players.length === 0 && TTT_TABLES.every((t) => Array.isArray(sd.rows[t]) && sd.rows[t].length === 0),
    `sessions ${sd.sessions.length}, seats ${sd.players.length}`)
  const so = await scan(out)
  r.check('scanning whole tables signed out finds no Tic-Tac-Toe lobby, and the gameplay tables are refused',
    so.sessions.length === 0 && so.players.length === 0 && TTT_TABLES.every((t) => so.rows[t] === 'denied'),
    `sessions ${so.sessions.length}, seats ${so.players.length}`)

  // Private tables.
  const privateTables = ['seat_owners', 'ttt_move_checks', 'ttt_board_cells', 'ttt_config', 'ttt_difficulty_bands', 'ttt_threshold_profiles',
    'football_players', 'football_categories', 'football_category_members', 'football_player_clubs', 'player_secrets', 'session_secrets']
  for (const who of [A, out]) {
    const results = []
    for (const t of privateTables) results.push([t, await g.count(who, t, (q) => q.limit(1))])
    const open = results.filter(([, n]) => n !== 'denied')
    r.check(`${who === A ? 'signed in and seated' : 'signed out'}, every private table is refused: ${privateTables.join(', ')}`,
      open.length === 0, open.map(([t, n]) => `${t}: ${n}`).join(', '))
  }

  // The small helpers the read policies use.
  const seated = async (who, sid) => (await g.call(who, 'ttt_is_seated', { p_session_id: sid })).data
  r.check('ttt_is_seated answers only for the caller: true for A in L, false for C, D, signed out, and for a made-up lobby',
    (await seated(A, L.sid)) === true && (await seated(C, L.sid)) === false && (await seated(D, L.sid)) === false &&
    (await seated(out, L.sid)) === false && (await seated(A, randomUUID())) === false)
  const visible = async (who, sid) => (await g.call(who, 'session_visible', { p_session_id: sid })).data
  r.check('session_visible: true for A in L, false for C and signed out',
    (await visible(A, L.sid)) === true && (await visible(C, L.sid)) === false && (await visible(out, L.sid)) === false)
  const canSee = await g.call(C, 'ttt_can_see_board', { p_board_id: g.L_boards[0] })
  const canSeeA = await g.call(A, 'ttt_can_see_board', { p_board_id: g.L_boards[0] })
  r.check('ttt_can_see_board: true for A, false for C', canSeeA.data === true && canSee.data === false, `${describeError(canSeeA.error)} / ${describeError(canSee.error)}`)
  g.notCallable('ttt_can_see_board is not callable signed out', await g.call(out, 'ttt_can_see_board', { p_board_id: g.L_boards[0] }))
  r.info('none of these helpers takes a user id, so none can be asked about another caller; session_visible is true for any Football Imposter lobby, which is public by design')

  // The API surface.
  const obsolete = [
    ['ttt_submit_move', { p_session_id: L.sid, p_player_id: L.seats.A, p_cell: 0, p_football_player_id: randomUUID() }],
    ['ttt_pass', { p_session_id: L.sid, p_player_id: L.seats.A }],
    ['ttt_start_game', { p_session_id: L.sid, p_player_id: L.seats.A }],
    ['ttt_rematch', { p_session_id: L.sid, p_player_id: L.seats.A }],
    ['ttt_update_settings', { p_session_id: L.sid, p_player_id: L.seats.A, p_difficulty: 'easy' }],
    ['ttt_leave_in_play', { p_session_id: L.sid, p_player_id: L.seats.A }],
  ]
  for (const [fn, args] of obsolete) g.missingFunction(`the old ${fn}(${Object.keys(args).join(', ')}) is gone from the API`, await g.call(A, fn, args))
  const internal = [
    ['ttt_leave', { p_session_id: L.sid, p_player_id: L.seats.B }],
    ['ttt_acting_seat', { p_session_id: L.sid }],
    ['ttt_begin_board', { p_session_id: L.sid }],
    ['ttt_generate_board', { p_difficulty: 'easy' }],
    ['give_up_seat', { p_session_id: L.sid, p_player_id: L.seats.B }],
    ['football_satisfies', { p_player_id: randomUUID(), p_category_id: randomUUID() }],
  ]
  for (const [fn, args] of internal) g.notCallable(`internal ${fn} cannot be called by a signed-in user`, await g.call(A, fn, args))
  r.info('the new signatures are exercised throughout: ttt_create_session(p_display_name, p_difficulty), ttt_update_settings(p_session_id, p_difficulty), ttt_start_game(p_session_id), ttt_rematch(p_session_id), ttt_submit_move(p_session_id, p_cell, p_football_player_id), ttt_pass(p_session_id), ttt_my_seat(p_session_id)')

  // Nothing changed.
  const after = await lobbyView(g, A, L)
  r.check('after all of that, the host still reads the same lobby', JSON.stringify(after) === JSON.stringify(full), show(after))
}

// ---------------------------------------------------------------------------
export async function leaving(g) {
  const { r } = g
  const { A, B } = g.users
  const L = g.L
  r.section('5. Leaving')
  const board = await g.board(A, L)
  const aMark = board.markOf('A')
  g.ok('B leaves mid-board', await g.call(B, 'leave_session', { p_session_id: L.sid, p_player_id: null }))
  const after = await g.board(A, L)
  const session = (await g.table(A, 'sessions', (q) => q.eq('id', L.sid))).data?.[0]
  const players = (await g.table(A, 'players', (q) => q.eq('session_id', L.sid))).data ?? []
  r.check('the host wins board 2 by forfeit, B\'s seat is gone and the lobby is back to waiting',
    after.game.status === 'forfeited' && after.game.winner_mark === aMark && session?.status === 'waiting' && players.length === 1,
    `${after.game.status} to ${after.game.winner_mark}, lobby ${session?.status}, ${players.length} seat`)
  const bView = await lobbyView(g, B, L)
  const bSeat = await g.call(B, 'ttt_my_seat', { p_session_id: L.sid })
  r.check('B, having left, holds no seat and can read nothing of the lobby',
    bSeat.data === null && Object.values(bView).every((n) => n === 0), show(bView))

  const E = await g.signIn('E')
  g.ok('E joins as the new opponent', await g.join(E, L, 'Eve'))
  const eGames = await g.count(E, 'ttt_games', (q) => q.eq('session_id', L.sid))
  r.check('E can read the lobby, including its earlier boards (a seat counts while it exists)', eGames === 2, `${eGames} games`)
  g.ok('the host starts a new match with E', await g.call(A, 'ttt_start_game', { p_session_id: L.sid }))
  const third = await g.board(A, L)
  r.info('a new opponent means a new coin toss', `A is ${third.markOf('A')}, E is ${third.markOf('E')}`)

  g.ok('the host leaves mid-board', await g.call(A, 'leave_session', { p_session_id: L.sid, p_player_id: null }))
  const ended = await g.board(E, L)
  const endedSession = (await g.table(E, 'sessions', (q) => q.eq('id', L.sid))).data?.[0]
  const hostRow = (await g.table(E, 'players', (q) => q.eq('id', L.seats.A))).data?.[0]
  r.check('E wins by forfeit, the lobby ends, and the host is out but keeps the seat',
    ended.game.status === 'forfeited' && ended.game.winner_mark === third.markOf('E') && endedSession?.status === 'ended' && hostRow?.is_active === false)
  g.refused('E cannot move once the host has gone', await g.move(E, L, 0, g.allFootballers[0]), 'ttt_no_board')
  g.refused('the host cannot change the difficulty of the ended lobby', await g.call(A, 'ttt_update_settings', { p_session_id: L.sid, p_difficulty: 'easy' }), 'ttt_game_over')
  const hostStill = await g.count(A, 'sessions', (q) => q.eq('id', L.sid))
  r.check('the host still holds the seat, so can still see how it ended', hostStill === 1)
  g.ok('E leaves the ended lobby', await g.call(E, 'leave_session', { p_session_id: L.sid, p_player_id: null }))
  g.ok('the host leaves again, which closes the lobby', await g.call(A, 'leave_session', { p_session_id: L.sid, p_player_id: null }))
  const gone = await g.count(A, 'sessions', (q) => q.eq('id', L.sid))
  r.check('lobby L is gone', gone === 0)
  L.closed = true
  g.closedLobbies.push(L.sid)
}
