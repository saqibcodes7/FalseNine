/**
 * What the Tic-Tac-Toe E2E suites share: checks, browsers, the mock's log,
 * and a direct line to the throwaway database so a test can find a right or
 * a wrong answer for a square (the browser never can) and confirm what the
 * server recorded.
 *
 * Only ever used against the throwaway database scripts/e2e-ttt/run.mjs makes.
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import pg from 'pg'

export const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5191'
export const MOCK = process.env.E2E_MOCK || 'http://127.0.0.1:54329'
export const PHONE = { width: 390, height: 844 }
export const DESKTOP = { width: 1280, height: 900 }

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function suite(title, shotsDir) {
  mkdirSync(shotsDir, { recursive: true })
  const results = []
  console.log(`\n=== ${title} ===`)
  return {
    check(name, ok, extra = '') {
      results.push({ name, ok: Boolean(ok) })
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
      return Boolean(ok)
    },
    section(name) {
      console.log(`\n--- ${name} ---`)
    },
    shot(page, file) {
      return page.screenshot({ path: `${shotsDir}/${file}.png`, fullPage: true }).catch(() => {})
    },
    finish() {
      const failed = results.filter((r) => !r.ok).length
      console.log(`\n${results.length - failed}/${results.length} checks passed`)
      return failed
    },
  }
}

export async function launch() {
  const path = process.env.E2E_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
  return chromium.launch(path ? { executablePath: path } : {})
}

/** A phone (or a desktop), with every console error and page crash collected. */
export async function device(browser, label, errors, viewport = PHONE) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(`${label}: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  return { label, ctx, page }
}

// ---- The mock's log ---------------------------------------------------------------
export async function mockLog() {
  return (await fetch(`${MOCK}/__mock/log`)).json()
}

// ---- The database, for answers and for checking what the server recorded --------------
export async function database() {
  // Only the throwaway database run.mjs made: local, and named fn_...
  const raw = process.env.E2E_DB_URL
  let url = null
  try {
    url = new URL(raw)
  } catch {
    // handled below
  }
  const host = url ? decodeURIComponent(url.hostname) : ''
  const name = url ? decodeURIComponent(url.pathname.replace(/^\//, '')) : ''
  if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || /supabase/i.test(host) || !/^fn_[a-z0-9_]+$/.test(name)) {
    console.error('The Tic-Tac-Toe suites only talk to the local throwaway database scripts/e2e-ttt/run.mjs makes. Run npm run test:ttt.')
    process.exit(2)
  }
  const client = new pg.Client({ connectionString: raw })
  await client.connect()
  return client
}

/** The lobby with this code, its newest board and that board's moves. */
export async function lobby(db, code) {
  const session = (await db.query('select * from public.sessions where code = $1', [code])).rows[0] ?? null
  if (!session) return { session: null, game: null, moves: [], players: [] }
  const game = (await db.query('select * from public.ttt_games where session_id = $1 order by board_number desc limit 1', [session.id])).rows[0] ?? null
  const moves = game ? (await db.query('select * from public.ttt_moves where game_id = $1 order by move_number', [game.id])).rows : []
  const players = (await db.query('select * from public.players where session_id = $1 order by joined_at', [session.id])).rows
  const settings = (await db.query('select * from public.ttt_settings where session_id = $1', [session.id])).rows[0] ?? null
  return { session, game, moves, players, settings }
}

/**
 * For one square of the lobby's current board: footballers who fit it and
 * have not claimed a square yet (right), and footballers who do not fit it
 * and have not claimed one (wrong). Straight from the database; the browser
 * has no way to know any of this.
 */
export async function answersFor(db, code, cell) {
  const { rows } = await db.query(
    `with g as (
       select g.* from public.ttt_games g join public.sessions s on s.id = g.session_id
       where s.code = $1 order by g.board_number desc limit 1),
     ax as (
       select r.category_id as row_cat, c.category_id as col_cat
       from g
       join public.ttt_board_axes r on r.board_id = g.board_id and r.axis = 'row' and r.position = $2::int / 3
       join public.ttt_board_axes c on c.board_id = g.board_id and c.axis = 'col' and c.position = $2::int % 3),
     used as (select m.football_player_id from public.ttt_moves m join g on m.game_id = g.id where m.kind = 'claim')
     select fp.id, fp.known_as,
            public.football_satisfies(fp.id, ax.row_cat) and public.football_satisfies(fp.id, ax.col_cat) as fits,
            fp.id in (select football_player_id from used) as used
     from public.football_players fp cross join ax
     order by fp.known_as`,
    [code, cell],
  )
  return {
    right: rows.filter((r) => r.fits && !r.used),
    wrong: rows.filter((r) => !r.fits && !r.used),
    used: rows.filter((r) => r.used),
  }
}

/** A footballer picked from the database by id. */
export async function footballer(db, id) {
  return (await db.query('select id, known_as, full_name from public.football_players where id = $1', [id])).rows[0]
}

/** The fixture's nationality labels: none of them may ever show in a search result. */
export async function nationalityLabels(db) {
  return (await db.query("select label from public.football_categories where type = 'NATIONALITY'")).rows.map((r) => r.label)
}

export async function waitUntil(fn, { timeout = 10000, every = 150 } = {}) {
  const until = Date.now() + timeout
  let last
  while (Date.now() < until) {
    last = await fn()
    if (last) return last
    await sleep(every)
  }
  return last
}

// ---- Playing through the UI -------------------------------------------------------------------
export const cellLocator = (page, cell) => page.locator(`[data-testid="cell"][data-cell="${cell}"]`)

/** Open a square, search for the footballer by name, pick him by id. Leaves the sheet open. */
export async function pick(page, cell, who) {
  await cellLocator(page, cell).click()
  const sheet = page.getByTestId('answer-sheet')
  await sheet.waitFor()
  await sheet.getByRole('combobox').fill(who.known_as)
  const option = sheet.locator(`[data-testid="search-result"][data-footballer-id="${who.id}"]`)
  await option.waitFor({ timeout: 8000 })
  await option.click()
  return sheet
}

/** Open a square, pick the footballer, submit, and wait for the sheet to close (or show a refusal). */
export async function answer(page, cell, who) {
  const sheet = await pick(page, cell, who)
  await sheet.getByTestId('submit-answer').click()
  await Promise.race([
    sheet.waitFor({ state: 'detached', timeout: 10000 }),
    sheet.locator('[role="alert"]').waitFor({ timeout: 10000 }),
  ]).catch(() => {})
  return sheet
}

/** Local storage entry holding a Supabase session, parsed; null if none. */
export async function storedSession(page, key) {
  return page.evaluate((k) => {
    try {
      return JSON.parse(window.localStorage.getItem(k))
    } catch {
      return null
    }
  }, key)
}

export const AUTH_KEYS = {
  online: 'fn:auth:tic_tac_toe:online',
  p1: 'fn:auth:tic_tac_toe:pass:p1',
  p2: 'fn:auth:tic_tac_toe:pass:p2',
}

/** The squares that make each line, from the migration's ttt_lines. */
export async function lines(db) {
  return (await db.query('select line, cells from public.ttt_lines order by line')).rows.map((r) => r.cells.map(Number))
}

// ---- Playing a board out -------------------------------------------------------------------
/**
 * How a fresh board can be drawn for certain: a maximum matching of squares
 * to distinct footballers who fit them, marked in a pattern with no line for
 * either side:
 *
 *      X O X
 *      X O O
 *      O X X
 *
 * Claiming every matched square wins nothing (no subset of that pattern holds
 * a line), and it ends the board: either all nine are claimed (board full), or
 * every square left over has only footballers already used, which is exactly
 * when the server calls a draw with no answers left. (In a maximum matching,
 * an unmatched square cannot have an unused footballer who fits it, or the
 * matching could grow.)
 */
const DRAW_PATTERN = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']

async function drawPlan(db, code) {
  const options = []
  for (let cell = 0; cell < 9; cell += 1) options.push((await answersFor(db, code, cell)).right)
  const owner = new Map() // footballer id -> cell
  const tryCell = (cell, seen) => {
    for (const f of options[cell]) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      if (!owner.has(f.id) || tryCell(owner.get(f.id), seen)) {
        owner.set(f.id, cell)
        return true
      }
    }
    return false
  }
  for (let cell = 0; cell < 9; cell += 1) tryCell(cell, new Set())
  const plan = []
  for (const [id, cell] of owner) plan.push({ cell, mark: DRAW_PATTERN[cell], who: options[cell].find((f) => f.id === id) })
  return plan
}

/**
 * Plays the lobby's current board to an end through the UI, choosing moves
 * from the database:
 *
 *   goal 'win'   `winner` works along a line the other mark has not touched,
 *                and the other mark passes every turn
 *   goal 'draw'  a fresh board is played to a certain draw (see drawPlan);
 *                a mark with nothing left to claim passes
 *
 * `act(mark, move)` makes the move in the right browser: { kind: 'claim',
 * cell, who } or { kind: 'pass' }. Returns the board as the server left it.
 */
export async function playOut(db, code, allLines, { goal, winner, act, maxTurns = 40 }) {
  const plan = goal === 'draw' ? await drawPlan(db, code) : null
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const { game, moves } = await lobby(db, code)
    if (!game || game.status !== 'playing') return game
    const mark = game.turn_mark
    const claimed = moves.filter((m) => m.kind === 'claim')
    const taken = new Set(claimed.map((m) => m.cell))
    let move = { kind: 'pass' }

    if (goal === 'win' && mark === winner) {
      const mine = claimed.filter((c) => c.mark === mark).map((c) => c.cell)
      const theirs = claimed.filter((c) => c.mark !== mark).map((c) => c.cell)
      const open = allLines
        .filter((line) => line.every((c) => !theirs.includes(c)))
        .sort((a, b) => b.filter((c) => mine.includes(c)).length - a.filter((c) => mine.includes(c)).length)
      search: for (const line of open) {
        for (const cell of line) {
          if (taken.has(cell)) continue
          const who = (await answersFor(db, code, cell)).right[0]
          if (who) {
            move = { kind: 'claim', cell, who }
            break search
          }
        }
      }
    } else if (goal === 'draw') {
      const next = plan.find((p) => p.mark === mark && !taken.has(p.cell))
      if (next) move = { kind: 'claim', cell: next.cell, who: next.who }
    }

    const before = moves.length
    await act(mark, move)
    await waitUntil(async () => {
      const now = await lobby(db, code)
      return now.moves.length > before || now.game?.status !== 'playing'
    }, { timeout: 15000 })
  }
  return (await lobby(db, code)).game
}

/** Start a suite with an empty log, so what it checks is only what it did. */
export async function clearLog() {
  await fetch(`${MOCK}/__mock/log/clear`, { method: 'POST' })
}
