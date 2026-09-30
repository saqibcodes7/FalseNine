/**
 * Online Football Tic-Tac-Toe, played in real browsers against the local mock
 * (scripts/mock-supabase.mjs) on a throwaway database. Run by
 * scripts/e2e-ttt/run.mjs, which sets everything up and tears it down.
 *
 * Four phones: the host, a guest, an outsider who never gets a seat, and a
 * replacement who joins after the guest walks out.
 */
import {
  AUTH_KEYS,
  BASE,
  DESKTOP,
  PHONE,
  answer,
  answersFor,
  cellLocator,
  clearLog,
  database,
  device,
  launch,
  lines,
  lobby,
  mockLog,
  nationalityLabels,
  pick,
  playOut,
  sleep,
  storedSession,
  suite,
  waitUntil,
} from './kit.mjs'

const t = suite('Football Tic-Tac-Toe: Online', process.env.E2E_SHOTS_ONLINE || './e2e-shots/ttt/online')
const errors = []
const browser = await launch()
const db = await database()
const LINES = await lines(db)
const NATIONS = await nationalityLabels(db)
const AUTH_WORDS = /sign.?in|log.?in|password|e-?mail|account|sign.?up/i

await clearLog()
const host = await device(browser, 'host', errors)
const guest = await device(browser, 'guest', errors)
const outsider = await device(browser, 'outsider', errors)

const bodyText = (p) => p.page.locator('body').innerText()
const myMark = (p) => p.page.getAttribute('[data-testid="ttt-match"]', 'data-my-mark')
const status = (p) => p.page.getByTestId('turn-status').innerText()
const since = (log, at) => log.filter((e) => e.at >= at)

try {
  // ---------------------------------------------------------------------------
  t.section('Getting in')
  await host.page.goto(BASE, { waitUntil: 'networkidle' })
  const card = host.page.getByRole('link', { name: /Football Tic-Tac-Toe/ })
  t.check('the Tic-Tac-Toe card on Home is a live link', (await card.count()) === 1)
  await card.click()
  await host.page.waitForURL('**/tic-tac-toe')
  // The URL changes before the lazily loaded screen replaces Home, so wait
  // for something only the entry screen has.
  await host.page.getByRole('navigation', { name: 'How are you playing?' }).waitFor()
  t.check('it opens the Tic-Tac-Toe entry screen', await host.page.getByRole('heading', { level: 1, name: 'Football Tic-Tac-Toe' }).isVisible())
  t.check(
    'which offers Online and Pass & Play',
    (await host.page.getByRole('link', { name: /^Online/ }).count()) === 1 && (await host.page.getByRole('link', { name: /^Pass & Play/ }).count()) === 1,
  )
  t.check('with no sign-in words anywhere', !AUTH_WORDS.test(await bodyText(host)))
  await t.shot(host.page, '01-entry')

  await host.page.getByRole('link', { name: /^Online/ }).click()
  await host.page.waitForURL('**/tic-tac-toe/online')
  await host.page.getByRole('heading', { level: 1, name: 'Online' }).waitFor()
  t.check('Online offers Create and Join', (await host.page.getByRole('button', { name: 'Create game' }).isVisible()) && (await host.page.getByRole('button', { name: 'Join game' }).isVisible()))
  await host.page.getByRole('button', { name: 'Create game' }).click()
  await host.page.waitForURL('**/online/create')
  await host.page.getByLabel('Your name').waitFor()
  t.check('nobody is signed in just for looking', (await mockLog()).filter((e) => e.kind === 'signup').length === 0)
  t.check('the create screen asks for a name and a difficulty, and nothing else', !AUTH_WORDS.test(await bodyText(host)) && (await host.page.getByRole('radiogroup', { name: 'Difficulty' }).count()) === 1)
  await host.page.getByLabel('Your name').fill('Saqib')
  await host.page.getByRole('radiogroup', { name: 'Difficulty' }).getByRole('radio', { name: 'Hard' }).click()
  await t.shot(host.page, '02-create')
  await host.page.getByRole('button', { name: 'Create game' }).click()
  await host.page.waitForSelector('[data-testid="join-code"]', { timeout: 15000 })
  const code = await host.page.getAttribute('[data-testid="join-code"]', 'data-code')
  t.check('the lobby has a five-character code', /^[A-Z0-9]{5}$/.test(code), code)

  let log = await mockLog()
  const signups = log.filter((e) => e.kind === 'signup')
  const hostId = (await storedSession(host.page, AUTH_KEYS.online))?.user?.id
  const created = log.find((e) => e.kind === 'rpc' && e.fn === 'ttt_create_session')
  t.check('creating signed the device in anonymously, once', signups.length === 1 && signups[0].sub === hostId)
  t.check('and the lobby was created as that signed-in user', created?.role === 'authenticated' && created?.sub === hostId)
  t.check('with the difficulty chosen', created?.args?.p_difficulty === 'hard' && created?.args?.p_display_name === 'Saqib')
  t.check('the session is saved under its own key, apart from Pass & Play', Boolean(hostId) && !(await storedSession(host.page, AUTH_KEYS.p1)) && !(await storedSession(host.page, AUTH_KEYS.p2)))
  const ttTouch = (e) => (e.kind === 'rpc' && (/^ttt_/.test(e.fn) || e.args?.p_game_mode === 'tic_tac_toe')) || (e.kind === 'table' && /^ttt_/.test(e.table))
  t.check('nothing protected was asked for signed out', log.filter(ttTouch).every((e) => e.role === 'authenticated'))

  t.check('the host sees host controls', (await host.page.getAttribute('[data-testid="ttt-lobby"]', 'data-role')) === 'host')
  t.check('Start waits for an opponent', await host.page.getByTestId('ttt-start').isDisabled())
  t.check('and says so', /Waiting for an opponent/.test(await host.page.getByTestId('ttt-start-hint').innerText()))
  t.check('the chosen difficulty is set', (await host.page.getByRole('radio', { name: 'Hard' }).getAttribute('aria-checked')) === 'true')
  await t.shot(host.page, '03-lobby-waiting')

  // ---------------------------------------------------------------------------
  t.section('Joining')
  await outsider.page.goto(`${BASE}/tic-tac-toe/online/join?code=ZZZZZ`, { waitUntil: 'networkidle' })
  await outsider.page.getByLabel('Your name').fill('Nosy')
  await outsider.page.getByRole('button', { name: 'Join game' }).click()
  await outsider.page.waitForSelector('[role="alert"]')
  t.check('a code that does not exist is turned away clearly', /No game found with that code/.test(await outsider.page.locator('[role="alert"]').innerText()))

  await guest.page.goto(`${BASE}/tic-tac-toe/online/join?code=${code}`, { waitUntil: 'networkidle' })
  t.check('the invite link fills the code in', (await guest.page.getByLabel('Game code').inputValue()) === code)
  await guest.page.getByLabel('Your name').fill('Mo')
  await guest.page.getByRole('button', { name: 'Join game' }).click()
  await guest.page.waitForSelector('[data-testid="ttt-lobby"]', { timeout: 15000 })
  const guestId = (await storedSession(guest.page, AUTH_KEYS.online))?.user?.id
  log = await mockLog()
  const joined = log.find((e) => e.kind === 'rpc' && e.fn === 'join_session' && e.sub === guestId)
  t.check('joining said it was a Tic-Tac-Toe game', joined?.args?.p_game_mode === 'tic_tac_toe' && joined?.role === 'authenticated')
  t.check('the guest sees no host controls', (await guest.page.getAttribute('[data-testid="ttt-lobby"]', 'data-role')) === 'guest' && (await guest.page.getByTestId('ttt-start').count()) === 0)
  t.check('and cannot change the difficulty, only see it', (await guest.page.getByRole('radiogroup').count()) === 0 && /Hard/.test(await guest.page.getByTestId('ttt-difficulty-readout').innerText()))
  await t.shot(guest.page, '04-lobby-guest')

  await host.page.waitForFunction(() => document.body.innerText.includes('Mo'), null, { timeout: 5000 })
  t.check('the host sees the opponent arrive without a reload', true)
  t.check('Start is offered once two are seated', await host.page.getByTestId('ttt-start').isEnabled())
  t.check('the lobby is live', (await host.page.getByText('Live', { exact: true }).count()) === 1)

  await host.page.getByRole('radio', { name: 'Easy' }).click()
  await guest.page.waitForFunction(() => /Easy/.test(document.querySelector('[data-testid="ttt-difficulty-readout"]')?.innerText ?? ''), null, { timeout: 5000 })
  t.check('the host changes the difficulty and the guest sees it', ((await lobby(db, code)).settings?.difficulty) === 'easy')

  await outsider.page.getByLabel('Game code').fill(code)
  await outsider.page.getByRole('button', { name: 'Join game' }).click()
  await outsider.page.waitForFunction(() => /two players/.test(document.querySelector('[role="alert"]')?.innerText ?? ''), null, { timeout: 5000 })
  t.check('a third player is told the game already has two', true)

  await guest.page.goto(`${BASE}/tic-tac-toe/online/join?code=${code}`, { waitUntil: 'networkidle' })
  await guest.page.getByLabel('Your name').fill('Mo again')
  await guest.page.getByRole('button', { name: 'Join game' }).click()
  await guest.page.waitForSelector('[data-testid="ttt-lobby"]', { timeout: 10000 })
  t.check('joining a game you are already in just takes you back to it', (await guest.page.getAttribute('[data-testid="ttt-lobby"]', 'data-role')) === 'guest')

  await host.page.reload({ waitUntil: 'networkidle' })
  await host.page.waitForSelector('[data-testid="ttt-lobby"]')
  t.check('after a reload the host is still the host', (await host.page.getAttribute('[data-testid="ttt-lobby"]', 'data-role')) === 'host')
  t.check('and the same anonymous user: no new sign-ins', (await mockLog()).filter((e) => e.kind === 'signup').length === 3, 'host, guest and the outsider')

  // ---------------------------------------------------------------------------
  t.section('The first board')
  await host.page.getByTestId('ttt-start').click()
  await host.page.waitForSelector('[data-testid="ttt-board"]', { timeout: 15000 })
  await guest.page.waitForSelector('[data-testid="ttt-board"]', { timeout: 15000 })
  t.check('both phones show the board', true)
  t.check('three column labels and three row labels', (await host.page.getByTestId('axis-col').count()) === 3 && (await host.page.getByTestId('axis-row').count()) === 3)
  t.check('nine squares', (await host.page.getByTestId('cell').count()) === 9)

  let state = await lobby(db, code)
  const hostSeat = state.players.find((p) => p.is_host).id
  const hostMark = await myMark(host)
  const guestMark = await myMark(guest)
  const serverHostMark = state.game.x_player_id === hostSeat ? 'X' : 'O'
  t.check('the coin toss decided the marks, and each phone shows its own', hostMark === serverHostMark && guestMark === (hostMark === 'X' ? 'O' : 'X'), `host ${hostMark}, guest ${guestMark}`)
  t.check('X starts the first board', state.game.starter_mark === 'X' && state.game.turn_mark === 'X')
  const X = hostMark === 'X' ? host : guest
  const O = X === host ? guest : host
  const nameX = X === host ? 'Saqib' : 'Mo'
  const nameO = O === host ? 'Saqib' : 'Mo'
  t.check('X is told it is their turn', /Your turn/.test(await status(X)))
  t.check('O is told whose turn it is', (await status(O)) === `${nameX} to play.`)
  t.check('the scoreboard marks X to play, in words', (await X.page.getByTestId('plate-X').getAttribute('data-to-play')) === '' && /To play/.test(await X.page.getByTestId('plate-X').innerText()))
  t.check('O cannot touch the board', (await O.page.locator('button[data-testid="cell"]:not([disabled])').count()) === 0)
  t.check('nobody can change the difficulty mid-board', (await host.page.getByRole('radiogroup').count()) === 0)
  await t.shot(X.page, '05-board-x')
  await t.shot(O.page, '06-board-o')

  // The outsider is signed in but has no seat.
  await outsider.page.goto(`${BASE}/tic-tac-toe/game/${code}`, { waitUntil: 'networkidle' })
  await outsider.page.waitForSelector('[data-testid="ttt-not-in-game"]')
  t.check('an outsider opening the game is told they are not in it', true)
  const peek = await outsider.page.evaluate(
    async ({ mock, key, token, sid }) => {
      const get = (path) => fetch(`${mock}/rest/v1/${path}`, { headers: { apikey: key, authorization: `Bearer ${token}` } }).then((r) => r.json())
      return { games: await get(`ttt_games?select=id&session_id=eq.${sid}`), sessions: await get(`sessions?select=id&id=eq.${sid}`), moves: await get(`ttt_moves?select=id&session_id=eq.${sid}`) }
    },
    { mock: process.env.E2E_MOCK, key: process.env.E2E_KEY, token: (await storedSession(outsider.page, AUTH_KEYS.online)).access_token, sid: state.session.id },
  )
  t.check('and reading the lobby directly gets them nothing', peek.games.length === 0 && peek.sessions.length === 0 && peek.moves.length === 0, JSON.stringify(peek))

  // ---- A wrong answer ----
  const c1 = 4
  const wrong = (await answersFor(db, code, c1)).wrong[0]
  await cellLocator(X.page, c1).click()
  const sheet = X.page.getByTestId('answer-sheet')
  await sheet.waitFor()
  t.check('picking a square names both of its criteria', (await sheet.getByTestId('answer-criteria').locator('> span').count()) === 2)
  await sheet.getByRole('combobox').fill(wrong.known_as.slice(0, 3))
  await sheet.getByTestId('search-result').first().waitFor({ timeout: 8000 })
  const resultsText = await sheet.getByTestId('search-results').innerText()
  t.check('the autocomplete shows footballers', resultsText.length > 0)
  t.check('and never a nationality', NATIONS.every((n) => !resultsText.includes(n)), resultsText.replace(/\n/g, ' | '))
  t.check('nor whether anyone fits', !/match|valid|fits|correct|club|nation|won/i.test(resultsText))
  log = await mockLog()
  const searches = log.filter((e) => e.kind === 'rpc' && e.fn === 'football_search_players')
  t.check('search goes to football_search_players, a few at a time', searches.length > 0 && searches.every((s) => s.args.p_limit <= 8))
  await t.shot(X.page, '07-answer-sheet')
  await sheet.getByRole('button', { name: 'Close' }).click()

  let mark = Date.now()
  await answer(X.page, c1, wrong)
  await X.page.getByTestId('move-feedback').waitFor({ timeout: 5000 })
  const feedback = await X.page.getByTestId('move-feedback').innerText()
  t.check('a wrong answer says only that it was wrong', feedback === 'Incorrect. Turn passes.', feedback)
  log = await mockLog()
  const sent = since(log, mark).find((e) => e.kind === 'rpc' && e.fn === 'ttt_submit_move')
  t.check('the move sent the footballer’s id, not his name', sent?.args?.p_football_player_id === wrong.id && sent?.args?.p_cell === c1)
  t.check('and went as the player whose turn it was', sent?.sub === (X === host ? hostId : guestId))
  state = await lobby(db, code)
  t.check('the turn passed', state.game.turn_mark === 'O' && state.moves.at(-1)?.kind === 'wrong')
  await O.page.waitForFunction((n) => document.querySelector('[data-testid="turn-status"]')?.innerText === `${n} got one wrong. Your turn.`, nameX, { timeout: 2500 })
  t.check('the other phone hears of it straight away', true)
  t.check('a wrong answer claims nothing', (await O.page.locator('[data-testid="cell"][data-mark]').count()) === 0)

  // ---- A right answer ----
  const c2 = 0
  const right = (await answersFor(db, code, c2)).right[0]
  await answer(O.page, c2, right)
  await O.page.getByTestId('move-feedback').waitFor({ timeout: 5000 })
  t.check('a right answer says so', (await O.page.getByTestId('move-feedback').innerText()) === 'Correct.')
  await X.page.locator(`[data-testid="cell"][data-cell="${c2}"][data-mark="O"]`).waitFor({ timeout: 2500 })
  t.check('and the square is O’s on both phones, with the footballer in it', (await X.page.locator(`[data-testid="cell"][data-cell="${c2}"]`).innerText()).includes(right.known_as))

  // ---- The same footballer again ----
  const c3 = 8
  const before = (await lobby(db, code)).moves.length
  const reused = await pick(X.page, c3, right)
  await reused.getByTestId('submit-answer').click()
  await reused.locator('[role="alert"]').waitFor({ timeout: 5000 })
  t.check('a footballer who has already claimed a square is refused', (await reused.locator('[role="alert"]').innerText()) === `${right.known_as} has already been used on this board.`)
  state = await lobby(db, code)
  t.check('and it costs nothing: same turn, nothing recorded', state.game.turn_mark === 'X' && state.moves.length === before)
  t.check('the sheet stays open for another go', await reused.isVisible())
  await reused.getByRole('button', { name: 'Close' }).click()

  // ---- Pass ----
  await X.page.getByTestId('pass-turn').click()
  await O.page.waitForFunction((n) => document.querySelector('[data-testid="turn-status"]')?.innerText === `${n} passed. Your turn.`, nameX, { timeout: 2500 })
  state = await lobby(db, code)
  t.check('passing uses the turn', state.game.turn_mark === 'O' && state.moves.at(-1)?.kind === 'pass')

  // ---- O wins ----
  const act = async (m, move) => {
    const who = m === 'X' ? X : O
    if (move.kind === 'pass') await who.page.getByTestId('pass-turn').click()
    else await answer(who.page, move.cell, move.who)
  }
  const won = await playOut(db, code, LINES, { goal: 'win', winner: 'O', act })
  t.check('the board was won', won?.status === 'won' && won?.winner_mark === 'O' && won?.end_reason === 'line', `${won?.status} ${won?.end_reason}`)
  await O.page.getByTestId('ttt-result').waitFor({ timeout: 5000 })
  await X.page.getByTestId('ttt-result').waitFor({ timeout: 5000 })
  t.check('the winner is told they won', (await O.page.getByTestId('result-headline').innerText()) === 'You win')
  t.check('the loser is told who won', (await X.page.getByTestId('result-headline').innerText()) === `${nameO} wins`)
  await X.page.locator('[data-testid="cell"][data-winning]').nth(2).waitFor({ timeout: 3000 })
  t.check('the winning line lights up on both phones', (await X.page.locator('[data-testid="cell"][data-winning]').count()) === 3 && (await O.page.locator('[data-testid="cell"][data-winning]').count()) === 3)
  await t.shot(O.page, '08-won')

  // ---------------------------------------------------------------------------
  t.section('Between boards')
  t.check('the host gets Play again and the difficulty', (await host.page.getByTestId('ttt-rematch').count()) === 1 && (await host.page.getByRole('radiogroup').count()) === 1)
  t.check('the guest waits for the host, and cannot start the next board', (await guest.page.getByTestId('guest-waiting').count()) === 1 && (await guest.page.getByTestId('ttt-rematch').count()) === 0)
  await host.page.getByRole('radio', { name: 'Medium' }).click()
  await guest.page.waitForFunction(() => /Medium/.test(document.querySelector('[data-testid="ttt-difficulty-readout"]')?.innerText ?? ''), null, { timeout: 5000 })
  t.check('the host changes the difficulty between boards', (await lobby(db, code)).settings.difficulty === 'medium')
  await t.shot(guest.page, '09-between-guest')

  await host.page.getByTestId('ttt-rematch').click()
  await waitUntil(async () => (await lobby(db, code)).game.board_number === 2)
  state = await lobby(db, code)
  await host.page.waitForFunction(() => /board 2/i.test(document.querySelector('[data-testid="board-caption"]')?.innerText ?? ''), null, { timeout: 5000 })
  await guest.page.waitForFunction(() => /board 2/i.test(document.querySelector('[data-testid="board-caption"]')?.innerText ?? ''), null, { timeout: 5000 })
  t.check('board 2 is at the new difficulty', /medium/i.test(await host.page.getByTestId('board-caption').innerText()) && state.game.status === 'playing')
  t.check('marks stay with the same people', (await myMark(host)) === hostMark && (await myMark(guest)) === guestMark)
  t.check('and the other player starts', state.game.starter_mark === 'O' && state.game.turn_mark === 'O')
  t.check('which O is told', /Your turn/.test(await status(O)))
  t.check('the score carries over', (await O.page.getByTestId('plate-O').innerText()).includes('1'))

  // ---- Reload and wander off: nothing is lost, nobody leaves ----
  await guest.page.reload({ waitUntil: 'networkidle' })
  await guest.page.waitForSelector('[data-testid="ttt-board"]', { timeout: 10000 })
  t.check('after a reload the guest is back in the same seat with the same mark', (await myMark(guest)) === guestMark && /board 2/i.test(await guest.page.getByTestId('board-caption').innerText()))
  await guest.page.getByRole('link', { name: 'False Nine home' }).click()
  await guest.page.waitForURL(`${BASE}/`)
  await guest.page.goto(`${BASE}/tic-tac-toe/online`, { waitUntil: 'networkidle' })
  const rejoin = guest.page.getByTestId('ttt-rejoin-code').filter({ hasText: code })
  t.check('Online offers the game to rejoin', (await rejoin.count()) === 1)
  await rejoin.click()
  await guest.page.waitForSelector('[data-testid="ttt-board"]', { timeout: 10000 })
  t.check('and rejoining lands in the same seat', (await myMark(guest)) === guestMark)
  t.check('leaving the page never left the game', (await mockLog()).every((e) => e.fn !== 'leave_session') && (await lobby(db, code)).players.length === 2)

  // ---- Board 2 ends in a draw ----
  const drawn = await playOut(db, code, LINES, { goal: 'draw', act })
  t.check('the board was drawn', drawn?.status === 'drawn', `${drawn?.status} ${drawn?.end_reason}`)
  await host.page.getByTestId('ttt-result').waitFor({ timeout: 5000 })
  await guest.page.getByTestId('ttt-result').waitFor({ timeout: 5000 })
  t.check('both phones say it is a draw', (await host.page.getByTestId('result-headline').innerText()) === 'Draw' && (await guest.page.getByTestId('result-headline').innerText()) === 'Draw')
  await t.shot(host.page, '10-draw')

  // ---- Layout: phone and desktop, nothing off the side ----
  const overflow = (p) => p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  t.check('no sideways scrolling on a phone', (await overflow(host)) <= 0)
  await host.page.setViewportSize(DESKTOP)
  await sleep(300)
  await t.shot(host.page, '11-desktop')
  t.check('nor on a desktop', (await overflow(host)) <= 0)
  const boardWidth = await host.page.getByTestId('ttt-board').evaluate((el) => el.getBoundingClientRect().width)
  t.check('the board is the focus on a desktop without sprawling', boardWidth > 400 && boardWidth <= 560, `${Math.round(boardWidth)}px`)
  await host.page.setViewportSize(PHONE)

  // ---------------------------------------------------------------------------
  t.section('Leaving, and a replacement')
  await host.page.getByTestId('ttt-rematch').click()
  await waitUntil(async () => (await lobby(db, code)).game.board_number === 3)
  await guest.page.waitForFunction(() => /board 3/i.test(document.querySelector('[data-testid="board-caption"]')?.innerText ?? ''), null, { timeout: 5000 })
  mark = Date.now()
  await guest.page.getByTestId('ttt-leave').click()
  await guest.page.getByTestId('leave-confirm').waitFor()
  t.check('leaving mid-board asks first, and says it forfeits', /forfeit/i.test(await guest.page.getByTestId('leave-confirm').innerText()))
  await guest.page.getByTestId('leave-confirm-yes').click()
  await guest.page.waitForURL('**/tic-tac-toe/online')
  const guestSeat = state.players.find((p) => !p.is_host).id
  const left = since(await mockLog(), mark).find((e) => e.fn === 'leave_session')
  t.check('Leave called the server, for the guest’s own seat', left?.sub === guestId && left?.args?.p_player_id === guestSeat)
  state = await lobby(db, code)
  t.check('the board went to the host by forfeit', state.game.status === 'forfeited' && state.game.winner_mark === hostMark)
  t.check('the guest’s seat is gone and the lobby is waiting again', state.session.status === 'waiting' && state.players.length === 1)
  await host.page.getByTestId('lobby-last-board').waitFor({ timeout: 5000 })
  t.check('the host is told what happened', /Mo left mid-board, so board 3 went to you by forfeit/.test(await host.page.getByTestId('lobby-last-board').innerText()))
  t.check('and waits for someone new', await host.page.getByTestId('ttt-start').isDisabled())
  await t.shot(host.page, '12-opponent-left')

  const sub = await device(browser, 'replacement', errors)
  await sub.page.goto(`${BASE}/tic-tac-toe/online/join?code=${code}`, { waitUntil: 'networkidle' })
  await sub.page.getByLabel('Your name').fill('Priya')
  await sub.page.getByRole('button', { name: 'Join game' }).click()
  await sub.page.waitForSelector('[data-testid="ttt-lobby"]', { timeout: 10000 })
  await host.page.waitForFunction(() => document.body.innerText.includes('Priya'), null, { timeout: 5000 })
  t.check('a replacement can join the same code', await host.page.getByTestId('ttt-start').isEnabled())
  await host.page.getByTestId('ttt-start').click()
  await waitUntil(async () => (await lobby(db, code)).game.board_number === 4)
  state = await lobby(db, code)
  const subSeat = state.players.find((p) => !p.is_host).id
  t.check('and a new match starts, with a fresh coin toss', state.game.starter_mark === 'X' && [state.game.x_player_id, state.game.o_player_id].sort().join() === [hostSeat, subSeat].sort().join())
  await sub.page.waitForSelector('[data-testid="ttt-board"]', { timeout: 10000 })

  // ---- The host walks out mid-board ----
  await host.page.getByTestId('ttt-leave').click()
  await host.page.getByTestId('leave-confirm-yes').click()
  await host.page.waitForURL('**/tic-tac-toe/online')
  state = await lobby(db, code)
  t.check('the host leaving mid-board forfeits it and ends the game', state.game.status === 'forfeited' && state.session.status === 'ended')
  await sub.page.getByTestId('ttt-result').waitFor({ timeout: 5000 })
  t.check('the opponent is told they win by forfeit', (await sub.page.getByTestId('result-headline').innerText()) === 'You win by forfeit')
  t.check('and that the game is over', /Saqib left, so this game is over/.test(await sub.page.getByTestId('game-over').innerText()))
  await t.shot(sub.page, '13-host-left')
  await sub.page.getByTestId('ttt-leave').click()
  await sub.page.waitForURL('**/tic-tac-toe/online')
  t.check('the opponent can then leave', (await lobby(db, code)).players.every((p) => p.id !== subSeat))

  await host.page.goto(`${BASE}/tic-tac-toe/game/${code}`, { waitUntil: 'networkidle' })
  await host.page.getByTestId('game-over').waitFor({ timeout: 10000 })
  t.check('the host coming back sees the game is over', /You left this game/.test(await host.page.getByTestId('game-over').innerText()))
  await host.page.getByTestId('ttt-leave').click()
  await host.page.waitForURL('**/tic-tac-toe/online')
  t.check('and closing it removes the lobby', (await lobby(db, code)).session === null)
  await sub.page.goto(`${BASE}/tic-tac-toe/game/${code}`, { waitUntil: 'networkidle' })
  await sub.page.waitForSelector('[data-testid="ttt-not-in-game"]')
  t.check('a closed game shows a dead end, not a crash', true)
  await sub.ctx.close()

  // ---------------------------------------------------------------------------
  t.section('Realtime and sessions')
  log = await mockLog()
  const joins = log.filter((e) => e.kind === 'join')
  const tttJoins = joins.filter((j) => j.tables.some((tbl) => /^ttt_/.test(tbl)))
  t.check('every Tic-Tac-Toe subscription was opened signed in, and accepted', tttJoins.length > 0 && tttJoins.every((j) => j.role === 'authenticated' && j.accepted), `${tttJoins.length} subscriptions`)
  t.check('no protected subscription was ever attempted signed out', joins.every((j) => j.role === 'authenticated' || !j.tables.some((tbl) => /^ttt_/.test(tbl))))
  const refreshes = log.filter((e) => e.kind === 'refresh' && e.sub === hostId)
  const firstRefresh = refreshes[0]?.at ?? Infinity
  t.check('the host’s session refreshed itself during the game', refreshes.length > 0, `${refreshes.length} refreshes`)
  t.check('and Realtime was given the new token', log.some((e) => e.kind === 'access_token' && e.sub === hostId && e.at >= firstRefresh))
  t.check('the game carried on after a refresh', log.some((e) => e.kind === 'rpc' && e.sub === hostId && e.at > firstRefresh && /^ttt_|leave_session/.test(e.fn)))

  // ---------------------------------------------------------------------------
  t.section('Football Imposter is untouched')
  mark = Date.now()
  await host.page.goto(`${BASE}/imposter/create`, { waitUntil: 'networkidle' })
  await host.page.getByLabel('Your display name').fill('Saqib')
  await host.page.getByRole('button', { name: 'Create game' }).click()
  await host.page.waitForSelector('[data-testid="join-code"]', { timeout: 10000 })
  const impCode = await host.page.getAttribute('[data-testid="join-code"]', 'data-code')
  const impCreate = since(await mockLog(), mark).find((e) => e.fn === 'create_session')
  t.check('on the same phone, Imposter still creates lobbies signed out', impCreate?.role === 'anon' && impCreate?.sub === null)
  await guest.page.goto(`${BASE}/imposter/join?code=${impCode}`, { waitUntil: 'networkidle' })
  await guest.page.getByLabel('Your display name').fill('Mo')
  await guest.page.getByRole('button', { name: 'Join game' }).click()
  await guest.page.waitForSelector("text=You're in", { timeout: 10000 })
  const impJoin = since(await mockLog(), mark).find((e) => e.fn === 'join_session')
  t.check('and joins them with the two-argument call, signed out', impJoin?.role === 'anon' && Object.keys(impJoin?.args ?? {}).sort().join() === 'p_code,p_display_name')
  await host.page.waitForFunction(() => document.body.innerText.includes('Mo'), null, { timeout: 8000 })
  t.check('and its lobby still updates', true)
} catch (error) {
  t.check(`the suite ran to the end`, false, error.stack?.split('\n').slice(0, 4).join(' / '))
  for (const p of [host, guest, outsider]) await t.shot(p.page, `zz-failure-${p.label}`)
}

// Refusals the test provokes on purpose are logged by the browser as failed
// requests; anything else in the console is a bug.
const noise = errors.filter((e) => !/Failed to load resource: the server responded with a status of (400|401|403|404|409)/.test(e))
t.check('no unexpected console errors', noise.length === 0, noise.slice(0, 3).join(' // '))

await browser.close()
await db.end()
process.exit(t.finish() ? 1 : 0)
