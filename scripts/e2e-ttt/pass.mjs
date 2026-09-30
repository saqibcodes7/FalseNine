/**
 * Pass & Play Football Tic-Tac-Toe, played on one phone-sized browser against
 * the local mock (scripts/mock-supabase.mjs) on a throwaway database. Run by
 * scripts/e2e-ttt/run.mjs.
 *
 * Two people share the device, so the browser holds two anonymous users. The
 * checks below follow every move to the server and confirm it went through
 * the client of the player whose turn it was.
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
  pick,
  playOut,
  sleep,
  storedSession,
  suite,
  waitUntil,
} from './kit.mjs'

const t = suite('Football Tic-Tac-Toe: Pass & Play', process.env.E2E_SHOTS_PASS || './e2e-shots/ttt/pass')
const errors = []
const browser = await launch()
const db = await database()
const LINES = await lines(db)
const AUTH_WORDS = /sign.?in|log.?in|password|e-?mail|account|sign.?up/i
const RECORD_KEY = 'fn:passplay:tic_tac_toe'
const MATCH = '[data-testid="ttt-match"]'

await clearLog()
const phone = await device(browser, 'phone', errors)
const page = phone.page
const since = (log, at) => log.filter((e) => e.at >= at)
const attr = (name) => page.getAttribute(MATCH, name)
const record = () => page.evaluate((k) => JSON.parse(window.localStorage.getItem(k)), RECORD_KEY)

/** Which local player plays this mark on the current board, from the screen. */
async function localFor(mark) {
  return (await attr('data-p1-mark')) === mark ? 'p1' : 'p2'
}

/** Make a move as whoever's turn it is: take the device (Ready) if it is being handed over, then play. */
async function act(mark, move) {
  const who = await localFor(mark)
  await page.waitForSelector(`${MATCH}[data-acting="${who}"]`, { timeout: 10000 })
  if (await page.getByTestId('handoff').isVisible()) await page.getByTestId('handoff-ready').click()
  if (move.kind === 'pass') await page.getByTestId('pass-turn').click()
  else await answer(page, move.cell, move.who)
}

/** Seats as the server holds them: which anonymous user owns which seat. */
async function owners(sessionId) {
  return (await db.query('select player_id, auth_user_id from public.seat_owners where session_id = $1', [sessionId])).rows
}

try {
  // ---------------------------------------------------------------------------
  t.section('Setting up')
  await page.goto(`${BASE}/tic-tac-toe`, { waitUntil: 'networkidle' })
  const mode = page.getByRole('link', { name: /^Pass & Play/ })
  t.check('Pass & Play is one of Tic-Tac-Toe’s two modes', (await mode.count()) === 1)
  await mode.click()
  await page.getByTestId('pass-setup').waitFor()
  const setupText = await page.locator('body').innerText()
  t.check('setup asks for two names and a difficulty', (await page.getByLabel('Player 1').count()) === 1 && (await page.getByLabel('Player 2').count()) === 1 && (await page.getByRole('radiogroup', { name: 'Difficulty' }).count()) === 1)
  t.check('with no code, no sharing and nothing about an online lobby', (await page.getByTestId('join-code').count()) === 0 && !/invite|share|join code|waiting for/i.test(setupText))
  t.check('and nothing about signing in', !AUTH_WORDS.test(setupText))
  t.check('nobody is signed in until the game starts', (await mockLog()).filter((e) => e.kind === 'signup').length === 0)

  await page.getByLabel('Player 1').fill('Sam')
  await page.getByLabel('Player 2').fill('sam')
  t.check('two players with the same name cannot start', await page.getByTestId('pass-start').isDisabled())
  await page.getByLabel('Player 1').fill('Mohammed')
  await page.getByLabel('Player 2').fill('Aisha')
  await page.getByRole('radiogroup', { name: 'Difficulty' }).getByRole('radio', { name: 'Easy' }).click()
  await t.shot(page, '01-setup')

  let mark = Date.now()
  await page.getByTestId('pass-start').click()
  await page.getByTestId('handoff').waitFor({ timeout: 15000 })
  let log = since(await mockLog(), mark)
  const p1 = (await storedSession(page, AUTH_KEYS.p1))?.user?.id
  const p2 = (await storedSession(page, AUTH_KEYS.p2))?.user?.id
  const signups = log.filter((e) => e.kind === 'signup').map((e) => e.sub)
  t.check('two anonymous players were made, one per person', signups.length === 2 && new Set(signups).size === 2)
  t.check('each saved under its own key', Boolean(p1 && p2) && p1 !== p2 && signups.includes(p1) && signups.includes(p2))
  t.check('and Pass & Play made no Online identity', !(await storedSession(page, AUTH_KEYS.online)))
  const rpc = (fn) => log.filter((e) => e.kind === 'rpc' && e.fn === fn)
  t.check('Player 1 created the lobby', rpc('ttt_create_session')[0]?.sub === p1 && rpc('ttt_create_session')[0]?.args.p_difficulty === 'easy')
  t.check('Player 2 joined it as a Tic-Tac-Toe game', rpc('join_session')[0]?.sub === p2 && rpc('join_session')[0]?.args.p_game_mode === 'tic_tac_toe')
  t.check('each asked the server for their own seat', rpc('ttt_my_seat').some((e) => e.sub === p1) && rpc('ttt_my_seat').some((e) => e.sub === p2))
  t.check('and the host started the game', rpc('ttt_start_game')[0]?.sub === p1)

  const saved = await record()
  let state = await lobby(db, saved.code)
  const seats = await owners(state.session.id)
  const seatOf = (user) => seats.find((s) => s.auth_user_id === user)?.player_id
  t.check('the lobby has exactly two seats', state.players.length === 2 && seats.length === 2)
  t.check('each person owns exactly one of them', Boolean(seatOf(p1) && seatOf(p2)) && seatOf(p1) !== seatOf(p2))
  t.check('Player 1 is the host', state.session.host_player_id === seatOf(p1))
  t.check('only where to find the game is saved on the device', saved.sessionId === state.session.id && Object.keys(saved).sort().join() === 'code,savedAt,sessionId')

  // ---- The coin toss decides the marks ----
  const markOf = (seat) => (state.game.x_player_id === seat ? 'X' : state.game.o_player_id === seat ? 'O' : null)
  const p1Mark = markOf(seatOf(p1))
  const p2Mark = markOf(seatOf(p2))
  const nameOf = { X: state.game.x_name, O: state.game.o_name }
  t.check('the screen’s idea of who is X is the server’s', (await attr('data-p1-mark')) === p1Mark && (await attr('data-p2-mark')) === p2Mark, `Player 1 is ${p1Mark}`)
  t.check('whoever won the toss starts, as X', state.game.turn_mark === 'X' && (await attr('data-acting')) === (p1Mark === 'X' ? 'p1' : 'p2'))
  t.check('the device is handed to them by name', (await page.getByTestId('handoff-name').innerText()) === `Pass to ${nameOf.X}`)
  t.check('with their mark', (await page.getByTestId('handoff-mark').innerText()) === "You're X")
  t.check('and the toss announced', (await page.getByTestId('handoff-feedback').innerText()) === `Coin toss: ${nameOf.X} goes first.`)
  t.check('nothing on the board works until they press Ready', (await page.locator('button[data-testid="cell"]:not([disabled])').count()) === 0)
  await t.shot(page, '02-handoff-first')
  await page.getByTestId('handoff-ready').click()
  await page.getByTestId('handoff').waitFor({ state: 'detached' })
  t.check('after Ready it is their turn', (await page.getByTestId('turn-status').innerText()) === `${nameOf.X}'s turn`)
  await t.shot(page, '03-board')

  const idOf = { [p1Mark]: p1, [p2Mark]: p2 }

  // ---------------------------------------------------------------------------
  t.section('Turns and handing over')
  // X starts a search, gives up on it, and passes.
  await cellLocator(page, 4).click()
  let sheet = page.getByTestId('answer-sheet')
  await sheet.waitFor()
  await sheet.getByRole('combobox').fill('Ad')
  await sheet.getByTestId('search-result').first().waitFor()
  await sheet.getByTestId('search-result').first().click()
  await sheet.getByRole('button', { name: 'Close' }).click()
  mark = Date.now()
  await page.getByTestId('pass-turn').click()
  await page.getByTestId('handoff').waitFor({ timeout: 5000 })
  log = since(await mockLog(), mark)
  t.check('Pass went through X’s own client', log.find((e) => e.fn === 'ttt_pass')?.sub === idOf.X)
  t.check('Pass uses the turn and hands the device over', (await page.getByTestId('handoff-name').innerText()) === `Pass to ${nameOf.O}`)
  t.check('saying what happened', (await page.getByTestId('handoff-feedback').innerText()) === `${nameOf.X} passed.`)
  await page.getByTestId('handoff-ready').click()
  await cellLocator(page, 4).click()
  sheet = page.getByTestId('answer-sheet')
  await sheet.waitFor()
  t.check('the next player starts with an empty search', (await sheet.getByRole('combobox').inputValue()) === '' && (await sheet.locator('[aria-selected="true"]').count()) === 0)
  await sheet.getByRole('button', { name: 'Close' }).click()

  // O answers wrong.
  const wrong = (await answersFor(db, saved.code, 4)).wrong[0]
  mark = Date.now()
  await answer(page, 4, wrong)
  await page.getByTestId('handoff').waitFor({ timeout: 5000 })
  log = since(await mockLog(), mark)
  const oMove = log.find((e) => e.fn === 'ttt_submit_move')
  t.check('O’s answer went through O’s own client', oMove?.sub === idOf.O && oMove?.args.p_football_player_id === wrong.id)
  t.check('a wrong answer uses the turn and hands over', (await page.getByTestId('handoff-name').innerText()) === `Pass to ${nameOf.X}`)
  t.check('saying only that it was wrong', (await page.getByTestId('handoff-feedback').innerText()) === 'Incorrect. Turn passes.')
  await t.shot(page, '04-handoff-wrong')
  await page.getByTestId('handoff-ready').click()

  // X answers right.
  const right = (await answersFor(db, saved.code, 0)).right[0]
  mark = Date.now()
  await answer(page, 0, right)
  await page.getByTestId('handoff').waitFor({ timeout: 5000 })
  log = since(await mockLog(), mark)
  t.check('X’s answer went through X’s own client', log.find((e) => e.fn === 'ttt_submit_move')?.sub === idOf.X)
  t.check('a right answer uses the turn and hands over', (await page.getByTestId('handoff-feedback').innerText()) === 'Correct.')
  await page.getByTestId('handoff-ready').click()
  t.check('the claimed square stays on the board for both', (await cellLocator(page, 0).getAttribute('data-mark')) === 'X' && (await cellLocator(page, 0).innerText()).includes(right.known_as))

  // O tries the footballer X just used.
  const before = (await lobby(db, saved.code)).moves.length
  const actingBefore = await attr('data-acting')
  sheet = await pick(page, 8, right)
  await sheet.getByTestId('submit-answer').click()
  await sheet.locator('[role="alert"]').waitFor({ timeout: 5000 })
  t.check('a used footballer is refused', (await sheet.locator('[role="alert"]').innerText()) === `${right.known_as} has already been used on this board.`)
  t.check('without handing over', (await page.getByTestId('handoff').count()) === 0)
  t.check('the same player is still up', (await attr('data-acting')) === actingBefore && (await lobby(db, saved.code)).moves.length === before)
  await sheet.getByRole('button', { name: 'Close' }).click()

  // ---- Play to a win for X ----
  const won = await playOut(db, saved.code, LINES, { goal: 'win', winner: 'X', act })
  t.check('the board was won by X', won?.status === 'won' && won?.winner_mark === 'X', `${won?.status}`)
  await page.getByTestId('ttt-result').waitFor({ timeout: 5000 })
  t.check('the result names the winner', (await page.getByTestId('result-headline').innerText()) === `${nameOf.X} wins`)
  await page.locator('[data-testid="cell"][data-winning]').nth(2).waitFor({ timeout: 3000 }).catch(() => {})
  t.check('and lights the line', (await page.locator('[data-testid="cell"][data-winning]').count()) === 3)
  t.check('no hand-over once the board is over', (await page.getByTestId('handoff').count()) === 0)
  t.check('Play again, the difficulty and End game are offered', (await page.getByTestId('pass-play-again').count()) === 1 && (await page.getByRole('radiogroup').count()) === 1 && (await page.getByTestId('end-game').count()) === 1)
  const everyMove = (await mockLog()).filter((e) => e.fn === 'ttt_submit_move' || e.fn === 'ttt_pass')
  t.check('every move all board went through the mover’s own client', everyMove.every((e) => e.sub === p1 || e.sub === p2) && new Set(everyMove.map((e) => e.sub)).size === 2)
  await t.shot(page, '05-won')

  // ---------------------------------------------------------------------------
  t.section('Play again')
  mark = Date.now()
  await page.getByRole('radio', { name: 'Hard' }).click()
  await waitUntil(async () => (await lobby(db, saved.code)).settings.difficulty === 'hard')
  t.check('the difficulty changes between boards, through the host', (await lobby(db, saved.code)).settings.difficulty === 'hard' && since(await mockLog(), mark).find((e) => e.fn === 'ttt_update_settings')?.sub === p1)
  await page.getByTestId('pass-play-again').click()
  await page.getByTestId('handoff').waitFor({ timeout: 10000 })
  state = await lobby(db, saved.code)
  t.check('Play again went through the host', since(await mockLog(), mark).find((e) => e.fn === 'ttt_rematch')?.sub === p1)
  await page.waitForFunction(() => /hard/i.test(document.querySelector('[data-testid="board-caption"]')?.innerText ?? ''), null, { timeout: 5000 }).catch(() => {})
  t.check('board 2 is at the new difficulty', state.game.board_number === 2 && /hard/i.test(await page.getByTestId('board-caption').innerText()))
  t.check('the marks stay with the same people', (await attr('data-p1-mark')) === p1Mark && markOf(seatOf(p1)) === p1Mark)
  t.check('and the other player starts', state.game.starter_mark === 'O' && (await page.getByTestId('handoff-name').innerText()) === `Pass to ${nameOf.O}`)
  t.check('which the hand-over says', (await page.getByTestId('handoff-feedback').innerText()) === `${nameOf.O} starts this board.`)
  t.check('no difficulty change while the board is in play', (await page.getByRole('radiogroup').count()) === 0)

  const drawn = await playOut(db, saved.code, LINES, { goal: 'draw', act })
  t.check('board 2 was drawn', drawn?.status === 'drawn', `${drawn?.status} ${drawn?.end_reason}`)
  await page.getByTestId('ttt-result').waitFor({ timeout: 5000 })
  t.check('and the screen says so', (await page.getByTestId('result-headline').innerText()) === 'Draw')
  await t.shot(page, '06-draw')

  // ---------------------------------------------------------------------------
  t.section('Reloading and wandering off')
  await page.getByTestId('pass-play-again').click()
  await page.getByTestId('handoff').waitFor({ timeout: 10000 })
  await page.getByTestId('handoff-ready').click()
  await page.getByTestId('pass-turn').click()
  await page.getByTestId('handoff').waitFor({ timeout: 5000 })
  const actingNow = await attr('data-acting')
  mark = Date.now()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('handoff').waitFor({ timeout: 15000 })
  log = since(await mockLog(), mark)
  t.check('after a reload the game comes back', /board 3/i.test(await page.getByTestId('board-caption').innerText()))
  t.check('with the same two players, not new ones', log.filter((e) => e.kind === 'signup').length === 0)
  t.check('whose seats were asked for again, each by its own player', [...new Set(log.filter((e) => e.fn === 'ttt_my_seat').map((e) => e.sub))].sort().join() === [p1, p2].sort().join())
  t.check('the same marks', (await attr('data-p1-mark')) === p1Mark && (await attr('data-p2-mark')) === p2Mark)
  t.check('and the device handed to whoever is up', (await attr('data-acting')) === actingNow)

  // Whoever is holding the device takes it, then wanders off to Home and back.
  await page.getByTestId('handoff-ready').click()
  await page.getByRole('link', { name: 'False Nine home' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.goto(`${BASE}/tic-tac-toe/pass`, { waitUntil: 'networkidle' })
  await page.getByTestId('handoff').waitFor({ timeout: 15000 })
  t.check('leaving the page does not end the game', /board 3/i.test(await page.getByTestId('board-caption').innerText()))
  t.check('and coming back hands the device over again before anyone can play', (await page.locator('button[data-testid="cell"]:not([disabled])').count()) === 0)
  t.check('nothing ever left it', (await mockLog()).every((e) => e.fn !== 'leave_session') && (await lobby(db, saved.code)).players.length === 2)

  // ---------------------------------------------------------------------------
  t.section('Ending, and a new game')
  await page.getByTestId('handoff-ready').click()
  mark = Date.now()
  await page.getByTestId('end-game').click()
  await page.getByTestId('end-confirm').waitFor()
  await page.getByTestId('end-confirm-yes').click()
  await page.getByTestId('pass-setup').waitFor({ timeout: 10000 })
  log = since(await mockLog(), mark)
  t.check('End game leaves through the host', log.filter((e) => e.fn === 'leave_session').length >= 1 && log.filter((e) => e.fn === 'leave_session').every((e) => e.sub === p1))
  t.check('and closes the lobby', (await lobby(db, saved.code)).session === null)
  t.check('the saved game is forgotten', (await record()) === null)
  t.check('but neither player is signed out', Boolean(await storedSession(page, AUTH_KEYS.p1)) && Boolean(await storedSession(page, AUTH_KEYS.p2)))
  t.check('the names are filled in for next time', (await page.getByLabel('Player 1').inputValue()) === 'Mohammed' && (await page.getByLabel('Player 2').inputValue()) === 'Aisha')

  mark = Date.now()
  await page.getByTestId('pass-start').click()
  await page.getByTestId('handoff').waitFor({ timeout: 15000 })
  const second = await record()
  log = since(await mockLog(), mark)
  t.check('a new game is a brand-new lobby', second.sessionId !== saved.sessionId && second.code !== saved.code)
  t.check('played by the same two players', log.filter((e) => e.kind === 'signup').length === 0 && log.find((e) => e.fn === 'ttt_create_session')?.sub === p1 && log.find((e) => e.fn === 'join_session')?.sub === p2)
  state = await lobby(db, second.code)
  const seats2 = await owners(state.session.id)
  const seat2 = (user) => seats2.find((s) => s.auth_user_id === user)?.player_id
  const mark2 = state.game.x_player_id === seat2(p1) ? 'X' : 'O'
  t.check('with its own coin toss, which the screen follows', (await attr('data-p1-mark')) === mark2, `Player 1 is ${mark2} this time`)
  await page.getByTestId('handoff-ready').click()

  // ---- One observer for Realtime ----
  const joins = (await mockLog()).filter((e) => e.kind === 'join' && e.tables.some((tbl) => /^ttt_/.test(tbl)))
  t.check('the match has one Realtime subscription, from the host', joins.length > 0 && joins.every((j) => j.sub === p1 && j.role === 'authenticated' && j.accepted), `${joins.length} subscriptions`)

  // ---- Layout ----
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  t.check('no sideways scrolling on a phone', (await overflow()) <= 0)
  await page.setViewportSize(DESKTOP)
  await sleep(300)
  await t.shot(page, '07-desktop')
  t.check('nor on a desktop', (await overflow()) <= 0)
  await page.setViewportSize(PHONE)

  await page.getByTestId('end-game').click()
  await page.getByTestId('end-confirm-yes').click()
  await page.getByTestId('pass-setup').waitFor({ timeout: 10000 })
  t.check('and that game ends cleanly too', (await lobby(db, second.code)).session === null)
} catch (error) {
  t.check('the suite ran to the end', false, error.stack?.split('\n').slice(0, 4).join(' / '))
  await t.shot(page, 'zz-failure')
}

const noise = errors.filter((e) => !/Failed to load resource: the server responded with a status of (400|401|403|404|409)/.test(e))
t.check('no unexpected console errors', noise.length === 0, noise.slice(0, 3).join(' // '))

await browser.close()
await db.end()
process.exit(t.finish() ? 1 : 0)
