/**
 * Races real database connections against each other to prove Football
 * Tic-Tac-Toe's moves are safe when two phones act at the same moment.
 *
 *   npm run test:concurrency
 *
 * Same target and same safety rules as `npm run test:db`: it reads
 * FN_TEST_PG_URL (never DATABASE_URL), only talks to a plain local Postgres,
 * and refuses anything that looks like Supabase. It does not repeat those
 * checks itself; it runs `node scripts/test-db.mjs --check` first and stops
 * unless that passes. Then it builds its own throwaway database, runs the
 * races, and drops it. Exits 0 if every race behaved, 1 if one did not, 2 if
 * it was refused or misconfigured.
 *
 * Each race holds one move open inside a transaction for a moment, so the
 * other connection is guaranteed to arrive while it is still in flight:
 *
 *   1. Both players go for the same square.
 *   2. Ten double-taps from one phone.
 *   3. Both players move at once, on different squares.
 *   4. The opponent leaves while the host is mid-move, and the other way round.
 *   5. Control: copies of ttt_submit_move with the safety layers taken away
 *      one at a time. With the locks gone, the move numbering still stops a
 *      double claim; with the numbering gone too, the unique indexes on
 *      squares and footballers still do.
 *   6. Joining: one user double-taps Join, and two users race for the last
 *      seat.
 *
 * Every connection acts as a signed-in user the way the SQL sees one: the
 * authenticated role, with request.jwt.claims set to that user. That is a
 * stand-in for Supabase Auth at the SQL level only, not a test of Auth,
 * PostgREST or Realtime.
 */
import { spawn, spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_URL = 'postgresql://postgres@localhost:5432/postgres'
const HOLD_SECONDS = 1.5

// ---------------------------------------------------------------------------
// Safety: exactly the checks test:db makes, by asking test:db to make them.
// ---------------------------------------------------------------------------

const guard = spawnSync(process.execPath, [path.join(ROOT, 'scripts/test-db.mjs'), '--check'], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
})
if (guard.status !== 0) {
  console.error('\ntest:concurrency refused: the test:db safety check did not pass.\n')
  process.exit(2)
}

const adminUrl = new URL(process.env.FN_TEST_PG_URL || DEFAULT_URL)
const psqlEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)))

function withDatabase(name) {
  const next = new URL(adminUrl.href)
  next.pathname = `/${name}`
  return next.href
}

function psqlSync(connection, extra) {
  const result = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...extra, connection], {
    cwd: ROOT,
    env: psqlEnv,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`.trim())
  return result.stdout.trim()
}

/** Run statements on one connection, after `delay` ms. Resolves with what happened. */
function psqlLater(connection, statements, delay = 0) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const started = Date.now()
      const args = ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', connection]
      for (const statement of statements) args.push('-c', statement)
      const child = spawn('psql', args, { cwd: ROOT, env: psqlEnv })
      let out = ''
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (out += d))
      child.on('close', (code) => {
        const error = (out.match(/ERROR:\s+(.*)/) || [])[1] || null
        resolve({ ok: code === 0, out: out.trim(), error, ms: Date.now() - started })
      })
    }, delay)
  })
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

let failures = 0
function check(name, ok, extra = '') {
  if (!ok) failures += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`)
}

// ---------------------------------------------------------------------------
// The throwaway database
// ---------------------------------------------------------------------------

const name = `fn_test_${Date.now()}_${randomBytes(4).toString('hex')}`
const db = withDatabase(name)
let created = false

// Sign in as a user, the way the SQL sees it.
const claimsFor = (uid) => JSON.stringify({ sub: uid, role: 'authenticated' })

// A lobby with Board A (see supabase/tests/0010_smoke.sql) in play, host as X.
// Each seat belongs to a new signed-in user; xu and ou are those users.
const SETUP = `
create function test_act(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;
create function test_board_a_lobby(p_host text, p_opp text) returns json language plpgsql as $$
declare
  v       record;
  v_opp   uuid;
  v_board uuid;
  v_xu    uuid := gen_random_uuid();
  v_ou    uuid := gen_random_uuid();
  cat     text[] := array['Harbour City FC', 'Port Aldry', 'Redmoor United', 'Ironside FC', 'Veloria', 'Veloria Premier Division'];
  ids     uuid[];
begin
  perform test_act(v_xu);
  select * into v from ttt_create_session(p_host);
  perform test_act(v_ou);
  select j.player_id into v_opp from join_session(v.code, p_opp, 'tic_tac_toe') j;
  select array_agg(fc.id order by array_position(cat, fc.label)) into ids
  from football_categories fc where fc.label = any (cat) and fc.active;
  v_board := ttt_build_board(ids[1:3], ids[4:6], 'medium', 'dev');
  insert into ttt_games (session_id, board_number, board_id, x_player_id, o_player_id, x_name, o_name, starter_mark, turn_mark)
  values (v.session_id, 1, v_board, v.player_id, v_opp, p_host, p_opp, 'X', 'X');
  update sessions set status = 'playing' where id = v.session_id;
  return json_build_object('sid', v.session_id, 'x', v.player_id, 'o', v_opp, 'xu', v_xu, 'ou', v_ou);
end $$;
-- A waiting lobby with its host seated and one seat free.
create function test_waiting_lobby(p_host text) returns json language plpgsql as $$
declare
  v    record;
  v_hu uuid := gen_random_uuid();
begin
  perform test_act(v_hu);
  select * into v from ttt_create_session(p_host);
  return json_build_object('sid', v.session_id, 'code', v.code, 'hu', v_hu);
end $$;
create function test_fid(p_name text) returns uuid language sql as $$ select id from football_players where full_name = p_name $$;
update ttt_config set active_profile = 'dev';
`

function lobby(label) {
  return JSON.parse(psqlSync(db, ['-c', `select test_board_a_lobby('${label} X', '${label} O')`]))
}
const waitingLobby = (label) => JSON.parse(psqlSync(db, ['-c', `select test_waiting_lobby('${label} Host')`]))
const fid = (full) => psqlSync(db, ['-c', `select test_fid('${full}')`])
const scalar = (sql) => psqlSync(db, ['-c', sql])
// The acting seat comes from the signed-in user, never from an argument.
const move = (sid, cell, footballer, fn = 'ttt_submit_move') =>
  `select outcome from ${fn}('${sid}', ${cell}, '${footballer}')`
const signIn = (uid) => `select set_config('request.jwt.claims', '${claimsFor(uid)}', false) is not null`
const held = (uid, statement) =>
  ['begin', 'set local role authenticated', signIn(uid), statement, `select pg_sleep(${HOLD_SECONDS})`, 'commit']
const quick = (uid, statement) => ['set role authenticated', signIn(uid), statement]

try {
  psqlSync(adminUrl.href, ['-c', `create database "${name}"`])
  created = true
  console.log(`\nCreated throwaway database ${name}.`)

  const migrations = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()
  for (const file of ['supabase/tests/_supabase_shim.sql', ...migrations.map((f) => `supabase/migrations/${f}`)]) {
    psqlSync(db, ['-f', file])
  }
  psqlSync(db, ['-c', "set fn.load_football_fixture = 'yes'", '-f', 'supabase/fixtures/football_fixture.sql'])
  psqlSync(db, ['-c', SETUP])
  console.log('Migrations, fictional fixture and Board A ready.\n')

  const owen = fid('Owen Marrick')
  const samuel = fid('Samuel Oduvar')
  const stefan = fid('Stefan Dravek')
  const claims = (sid) => scalar(`select count(*) from ttt_moves where session_id = '${sid}' and kind = 'claim'`)

  // -------------------------------------------------------------------------
  console.log('1. Both players go for the same square')
  {
    const g = lobby('Same')
    const [x, o] = await Promise.all([
      psqlLater(db, held(g.xu, move(g.sid, 4, owen))),
      psqlLater(db, quick(g.ou, move(g.sid, 4, samuel)), 300),
    ])
    check('X claims square 4', x.ok && x.out.includes('claimed'), x.error || '')
    check('O, arriving mid-move, waits for it and is then told the square is taken',
      !o.ok && o.error === 'That square is already taken' && o.ms >= (HOLD_SECONDS - 0.5) * 1000,
      `${o.error}; waited ${o.ms} ms`)
    check('exactly one claim on the square', claims(g.sid) === '1')
    check('and it is O\'s turn', scalar(`select turn_mark from ttt_games where session_id = '${g.sid}'`) === 'O')
  }

  // -------------------------------------------------------------------------
  console.log('\n2. Ten double-taps from one phone')
  {
    const g = lobby('Burst')
    const taps = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        psqlLater(db, i === 0 ? held(g.xu, move(g.sid, 4, owen)) : quick(g.xu, move(g.sid, 4, owen)), i === 0 ? 0 : 200)),
    )
    const landed = taps.filter((t) => t.ok && t.out.includes('claimed')).length
    const refused = taps.filter((t) => !t.ok && t.error === 'It is not your turn').length
    check('exactly one tap lands', landed === 1, `${landed} landed`)
    check('the other nine are refused as not your turn', refused === 9, `${refused} refused`)
    check('one move recorded', scalar(`select count(*) from ttt_moves where session_id = '${g.sid}'`) === '1')
  }

  // -------------------------------------------------------------------------
  console.log('\n3. Both players move at once, on different squares')
  {
    const g = lobby('Both')
    const [x, o] = await Promise.all([
      psqlLater(db, held(g.xu, move(g.sid, 4, owen))),
      psqlLater(db, quick(g.ou, move(g.sid, 3, stefan)), 300),
    ])
    check('the moves are applied one after the other, in order', x.ok && o.ok && o.ms >= (HOLD_SECONDS - 0.5) * 1000,
      `O waited ${o.ms} ms`)
    check('history reads X then O, numbered 1 and 2',
      scalar(`select string_agg(move_number || mark || cell, ' ' order by move_number) from ttt_moves where session_id = '${g.sid}'`) === '1X4 2O3')
  }

  // -------------------------------------------------------------------------
  console.log('\n4. Leaving in the middle of a move')
  {
    const g = lobby('LeaveLate')
    const [x, leave] = await Promise.all([
      psqlLater(db, held(g.xu, move(g.sid, 4, owen))),
      psqlLater(db, quick(g.ou, `select leave_session('${g.sid}', null)`), 300),
    ])
    check('the host\'s move lands first', x.ok && x.out.includes('claimed'))
    check('then the opponent\'s leave: host wins by forfeit, lobby back to waiting',
      leave.ok && scalar(`select g.status || ' ' || g.winner_mark || ' ' || s.status from ttt_games g join sessions s on s.id = g.session_id where g.session_id = '${g.sid}'`) === 'forfeited X waiting')

    const h = lobby('LeaveFirst')
    const [left, late] = await Promise.all([
      psqlLater(db, held(h.ou, `select leave_session('${h.sid}', null)`)),
      psqlLater(db, quick(h.xu, move(h.sid, 4, owen)), 300),
    ])
    check('the opponent leaves first', left.ok)
    check('then the host\'s move finds no board in play, and nothing is recorded',
      !late.ok && late.error === 'There is no board in play' && scalar(`select count(*) from ttt_moves where session_id = '${h.sid}'`) === '0',
      late.error || '')
    check('no board anywhere is in play with a missing player',
      scalar("select count(*) from ttt_games where status = 'playing' and (x_player_id is null or o_player_id is null)") === '0')
  }

  // -------------------------------------------------------------------------
  console.log('\n5. Control: take the safety layers away one at a time')
  {
    // Copies of ttt_submit_move, in this throwaway database only: one with
    // every FOR UPDATE removed, one with the move numbering removed as well.
    const def = scalar("select pg_get_functiondef('public.ttt_submit_move(uuid, int, uuid)'::regprocedure)")
    const numbering = 'select coalesce(max(m.move_number), 0) + 1 into v_number\n  from public.ttt_moves m where m.game_id = v_game.id;'
    if ((def.match(/\bfor update\b/gi) || []).length !== 2 || !def.includes(numbering)) {
      throw new Error('ttt_submit_move no longer looks the way this control expects')
    }
    const unlocked = def.replace('public.ttt_submit_move(', 'public.ttt_submit_move_unlocked(').replace(/\bfor update\b/gi, '')
    const unnumbered = unlocked
      .replace('public.ttt_submit_move_unlocked(', 'public.ttt_submit_move_bare(')
      .replace(numbering, 'v_number := 1000 + floor(random() * 1000000)::int;')
    psqlSync(db, ['-c', unlocked, '-c', unnumbered,
      '-c', 'grant execute on function public.ttt_submit_move_unlocked(uuid, int, uuid), public.ttt_submit_move_bare(uuid, int, uuid) to authenticated'])

    // Square 5 fits both Owen Marrick and Samuel Oduvar.
    const g = lobby('NoLocks')
    const [first, second] = await Promise.all([
      psqlLater(db, held(g.xu, move(g.sid, 5, owen, 'ttt_submit_move_unlocked'))),
      psqlLater(db, quick(g.xu, move(g.sid, 5, samuel, 'ttt_submit_move_unlocked')), 300),
    ])
    check('locks removed: the second claim is stopped by the move numbering',
      first.ok && /ttt_moves_number/.test(second.out) && claims(g.sid) === '1', second.error || '')

    const h = lobby('BareSquare')
    const [a, b] = await Promise.all([
      psqlLater(db, held(h.xu, move(h.sid, 5, owen, 'ttt_submit_move_bare'))),
      psqlLater(db, quick(h.xu, move(h.sid, 5, samuel, 'ttt_submit_move_bare')), 300),
    ])
    check('locks and numbering removed: the one-claim-per-square index stops it',
      a.ok && /ttt_moves_one_claim_per_square/.test(b.out) && claims(h.sid) === '1', b.error || '')

    const k = lobby('BarePlayer')
    const [c, d] = await Promise.all([
      psqlLater(db, held(k.xu, move(k.sid, 4, owen, 'ttt_submit_move_bare'))),
      psqlLater(db, quick(k.xu, move(k.sid, 5, owen, 'ttt_submit_move_bare')), 300),
    ])
    check('locks and numbering removed: the one-square-per-footballer index stops it',
      c.ok && /ttt_moves_footballer_once/.test(d.out) && claims(k.sid) === '1', d.error || '')
  }

  // -------------------------------------------------------------------------
  console.log('\n6. Joining')
  {
    const join = (code, label) => `select player_id from join_session('${code}', '${label}', 'tic_tac_toe')`
    const seats = (sid) =>
      scalar(`select count(*) || '/' || (select count(*) from seat_owners where session_id = '${sid}') from players where session_id = '${sid}'`)

    const g = waitingLobby('Double')
    const tapper = randomUUID()
    const [first, second] = await Promise.all([
      psqlLater(db, held(tapper, join(g.code, 'Tapper'))),
      psqlLater(db, quick(tapper, join(g.code, 'Tapper again')), 300),
    ])
    check('one user double-tapping Join gets one seat; the second tap waits, then is told they are already in',
      first.ok && !second.ok && second.error === 'You are already in this game'
        && second.ms >= (HOLD_SECONDS - 0.5) * 1000 && seats(g.sid) === '2/2',
      `${second.error}; waited ${second.ms} ms; seats/owners ${seats(g.sid)}`)

    const h = waitingLobby('LastSeat')
    const [a, b] = await Promise.all([
      psqlLater(db, held(randomUUID(), join(h.code, 'First'))),
      psqlLater(db, quick(randomUUID(), join(h.code, 'Second')), 300),
    ])
    check('two users racing for the last seat: one gets it, the other is told the game is full',
      a.ok && !b.ok && b.error === 'That game is full (2 players max)' && seats(h.sid) === '2/2',
      `${b.error}; seats/owners ${seats(h.sid)}`)
  }
} catch (error) {
  failures += 1
  console.log(`\n  FAIL  the run stopped: ${error.message}`)
} finally {
  if (created) {
    try {
      psqlSync(adminUrl.href, ['-c', `drop database if exists "${name}" with (force)`])
    } catch (error) {
      console.log(`\nCould not drop ${name}: ${error.message}`)
    }
  }
}

console.log(failures ? `\ntest:concurrency FAILED (${failures})` : '\ntest:concurrency passed')
process.exit(failures ? 1 : 0)
