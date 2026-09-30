/**
 * Checks on the plain functions the Tic-Tac-Toe screens are built on, and a
 * scan of the frontend for things it must never do. No browser, no database.
 * Run by scripts/e2e-ttt/run.mjs, or on its own:
 *
 *   node scripts/e2e-ttt/logic.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  boardAxes,
  boardCells,
  latestGame,
  markOfSeat,
  matchPhase,
  matchScore,
  movesOf,
  nameOfMark,
  passSeating,
  turnInStep,
  turnKey,
  winningCells,
} from '../../src/lib/tttBoard.js'
import { WRONG_ANSWER, isStaleStateError, tttErrorMessage } from '../../src/lib/tttErrors.js'
import { TTT_DIFFICULTIES } from '../../src/data/tttDifficulties.js'
import { criterionSentence, footballerMeta } from '../../src/ui/ttt/format.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let passed = 0
let failed = 0
function check(name, ok, extra = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}

console.log('\n=== Tic-Tac-Toe logic ===')

// ---- Reading a board ------------------------------------------------------------
const A = 'seat-a'
const B = 'seat-b'
const game1 = { id: 'g1', board_number: 1, board_id: 'b1', x_player_id: B, o_player_id: A, x_name: 'Bea', o_name: 'Ali', starter_mark: 'X', turn_mark: 'O', status: 'playing' }
const moves = [
  { game_id: 'g1', move_number: 2, mark: 'O', kind: 'wrong', cell: 4, footballer_name: 'Wrong Guy' },
  { game_id: 'g1', move_number: 1, mark: 'X', kind: 'claim', cell: 0, footballer_name: 'Right Guy' },
  { game_id: 'g1', move_number: 3, mark: 'X', kind: 'pass', cell: null, footballer_name: null },
  { game_id: 'g0', move_number: 1, mark: 'O', kind: 'claim', cell: 8, footballer_name: 'Other Board' },
]
const mine = movesOf(moves, 'g1')
check('moves are one board’s, oldest first', mine.map((m) => m.move_number).join() === '1,2,3')
const cells = boardCells(mine)
check('a claim fills its square with mark and footballer', cells[0]?.mark === 'X' && cells[0]?.footballer === 'Right Guy')
check('a wrong answer claims nothing', cells[4] === null)
check('another board’s claim is not on this board', cells[8] === null)
check('latest board is the highest number', latestGame([{ board_number: 1 }, { board_number: 3 }, { board_number: 2 }]).board_number === 3)

const axes = [
  ...[0, 1, 2].map((p) => ({ axis: 'row', position: p, label: `R${p}` })),
  ...[0, 1, 2].map((p) => ({ axis: 'col', position: p, label: `C${p}` })),
]
check('six axes read as three rows and three columns', boardAxes(axes)?.rows.map((a) => a.label).join() === 'R0,R1,R2')
check('an incomplete board has no axes yet', boardAxes(axes.slice(1)) === null)

// ---- Marks come from the board, never from who is Player 1 -------------------------
check('a seat’s mark is read from the board', markOfSeat(game1, A) === 'O' && markOfSeat(game1, B) === 'X')
check('a seat not on the board has no mark', markOfSeat(game1, 'seat-c') === null)
check('names follow the marks', nameOfMark(game1, 'X') === 'Bea' && nameOfMark(game1, 'O') === 'Ali')

const pass1 = passSeating(game1, { p1: A, p2: B })
check('Pass & Play: Player 1 can be O', pass1.p1.mark === 'O' && pass1.p2.mark === 'X')
check('Pass & Play: the O player acts on O’s turn', pass1.acting === 'p1' && pass1.consistent)
const pass2 = passSeating({ ...game1, turn_mark: 'X' }, { p1: A, p2: B })
check('Pass & Play: the X player acts on X’s turn', pass2.acting === 'p2')
const flipped = passSeating({ ...game1, x_player_id: A, o_player_id: B, turn_mark: 'X' }, { p1: A, p2: B })
check('Pass & Play: after the other coin toss Player 1 is X and acts on X', flipped.p1.mark === 'X' && flipped.acting === 'p1')
check('Pass & Play: nobody acts between boards', passSeating({ ...game1, status: 'won', turn_mark: null }, { p1: A, p2: B }).acting === null)
check('Pass & Play: a seat missing from the board stops play', passSeating(game1, { p1: A, p2: 'seat-c' }).consistent === false)
check('Pass & Play: two seats on one mark stops play', passSeating(game1, { p1: A, p2: A }).consistent === false)

// ---- Phases and turns ------------------------------------------------------------------
check('waiting is the lobby', matchPhase({ status: 'waiting' }, game1) === 'lobby')
check('playing with a board in play', matchPhase({ status: 'playing' }, game1) === 'playing')
check('playing with the board over is between boards', matchPhase({ status: 'playing' }, { status: 'drawn' }) === 'between')
check('ended is ended', matchPhase({ status: 'ended' }, { status: 'forfeited' }) === 'ended')
const k1 = turnKey(game1, mine)
check('the turn key moves on with each recorded move', k1 !== turnKey(game1, mine.slice(0, 2)))
check('a refused attempt (nothing recorded) keeps the turn key', k1 === turnKey(game1, [...mine]))
check('no turn key once the board is over', turnKey({ ...game1, status: 'won' }, mine) === null)
// game1: X started, three moves recorded, so O is up; the row says O.
check('a board and its moves agree on whose turn it is', turnInStep(game1, mine))
check('half a move (new move, old board row) is caught', !turnInStep({ ...game1, turn_mark: 'X' }, mine))
check('and so is the other half (new board row, move not yet seen)', !turnInStep(game1, mine.slice(0, 2)))
check('a fresh board is in step with its starter up', turnInStep({ ...game1, starter_mark: 'O', turn_mark: 'O' }, []))

// ---- Score and winning line -------------------------------------------------------------------
const games = [
  { x_player_id: B, o_player_id: A, status: 'won', winner_mark: 'X' },
  { x_player_id: B, o_player_id: A, status: 'drawn', winner_mark: null },
  { x_player_id: B, o_player_id: A, status: 'forfeited', winner_mark: 'O' },
  { x_player_id: null, o_player_id: A, status: 'won', winner_mark: 'O' },
  { x_player_id: B, o_player_id: A, status: 'playing', winner_mark: null },
]
const score = matchScore(games, game1)
check('score counts this pairing’s finished boards only', score.X === 1 && score.O === 1 && score.drawn === 1 && score.boards === 3, JSON.stringify(score))
check(
  'winning squares come from the server’s line',
  winningCells({ status: 'won', winning_line: 6 }, [{ line: 6, cells: [0, 4, 8] }]).join() === '0,4,8',
)

// ---- Errors -------------------------------------------------------------------------------------
const quiet = console.error
const logged = []
console.error = (...args) => logged.push(args)
const say = (hint, context, message = 'x') => tttErrorMessage({ hint, message }, context)
check('not your turn', say('ttt_not_your_turn') === "It's not your turn.")
check('square taken', say('ttt_square_taken') === 'That square has already been claimed.')
check('unknown footballer', say('ttt_unknown_footballer') === 'Choose a footballer from the search results.')
check('footballer used keeps the name', say('ttt_footballer_used', 'move', 'Joël Åsmark has already been used on this board') === 'Joël Åsmark has already been used on this board.')
check('host only, per action', say('ttt_not_host', 'difficulty') === 'Only the host can change the difficulty.' && say('ttt_not_host', 'rematch') === 'Only the host can start the next board.')
check('difficulty mid-board', say('ttt_board_in_play', 'difficulty') === 'Difficulty can be changed after this board.')
check('already in the game', say('ttt_already_seated') === "You're already in this game.")
check('full game', tttErrorMessage({ message: 'That game is full (2 players max)' }, 'join') === 'This game already has two players.')
check('bad code', /^No game found with that code/.test(tttErrorMessage({ message: 'No game found with code ZZZZZ' }, 'join')))
check('offline', /Could not reach the game server/.test(tttErrorMessage({ message: 'Failed to fetch' }, 'load')))
check('the known refusals were not logged as surprises', logged.length === 0, `${logged.length} logged`)
const generic = tttErrorMessage({ code: 'XX000', message: 'boom' }, 'move')
check('an unknown error gets a generic sentence', generic === 'Something went wrong. Try again.')
check('and is logged', logged.length === 1)
console.error = quiet
check('the wrong-answer line names no criterion', !/club|nation|trophy|won|played|row|column/i.test(WRONG_ANSWER), WRONG_ANSWER)
check('stale refusals close the sheet', isStaleStateError({ hint: 'ttt_not_your_turn' }) && isStaleStateError({ hint: 'ttt_square_taken' }))
check('a used footballer keeps the sheet open for another pick', !isStaleStateError({ hint: 'ttt_footballer_used' }) && !isStaleStateError({ hint: 'ttt_not_host' }))

// ---- Words ----------------------------------------------------------------------------------------
check('a trophy criterion says it was won', criterionSentence({ category_type: 'TROPHY', label: 'World Shield' }) === 'Won the World Shield')
check('a club criterion says he played there', criterionSentence({ category_type: 'CLUB', label: 'Vale Albion' }) === 'Played for Vale Albion')
check('a nationality criterion says nationality', criterionSentence({ category_type: 'NATIONALITY', label: 'Estrana' }) === 'Nationality: Estrana')
check('a search result shows full name and birth year only', footballerMeta({ known_as: 'Joël', full_name: 'Joël Åsmark', birth_year: 1994, nationality: 'Estrana' }) === 'Joël Åsmark · 1994')

// ---- Difficulties match the migration --------------------------------------------------------------
const migration = readFileSync(path.join(ROOT, 'supabase/migrations/0010_tic_tac_toe.sql'), 'utf8')
const allowed = migration.match(/ttt_settings_difficulty_valid check \(difficulty in \(([^)]+)\)\)/)?.[1].replace(/['\s]/g, '').split(',')
check('difficulties are exactly the ones the backend accepts', allowed && allowed.join() === TTT_DIFFICULTIES.map((d) => d.id).join(), `${allowed} vs ${TTT_DIFFICULTIES.map((d) => d.id)}`)

// ---- What the frontend must never do ----------------------------------------------------------------
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? files(full) : /\.(js|jsx)$/.test(name) ? [full] : []
  })
}
const src = files(path.join(ROOT, 'src')).map((file) => ({ file: path.relative(ROOT, file), text: readFileSync(file, 'utf8') }))
const privateTables = /\.from\(\s*['"](seat_owners|ttt_move_checks|ttt_board_cells|ttt_difficulty_bands|ttt_config|ttt_threshold_profiles|player_secrets|session_secrets|football_[a-z_]+)['"]/
check('no screen reads a private table', src.every((f) => !privateTables.test(f.text)), src.filter((f) => privateTables.test(f.text)).map((f) => f.file).join(', '))
check('no secret or service-role key anywhere in the frontend', src.every((f) => !/service_role|sb_secret_/i.test(f.text)))
const tttFiles = src.filter((f) => /ttt|Ttt/.test(f.file))
const rpcs = new Set(tttFiles.flatMap((f) => [...f.text.matchAll(/\.rpc\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])))
const allowedRpcs = new Set(['ttt_create_session', 'join_session', 'ttt_my_seat', 'ttt_update_settings', 'ttt_start_game', 'ttt_rematch', 'ttt_submit_move', 'ttt_pass', 'leave_session', 'football_search_players'])
check('Tic-Tac-Toe calls only the public RPCs', [...rpcs].every((r) => allowedRpcs.has(r)), [...rpcs].join(', '))
check('no Tic-Tac-Toe file signs anyone out', tttFiles.every((f) => !/signOut\(/.test(f.text)))
check('Imposter’s shared client still keeps no session', /persistSession:\s*false/.test(src.find((f) => f.file.endsWith(path.join('lib', 'supabase.js'))).text))

console.log(`\n${passed}/${passed + failed} logic checks passed`)
process.exit(failed ? 1 : 0)
