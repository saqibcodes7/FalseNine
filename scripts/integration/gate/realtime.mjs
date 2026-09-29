/**
 * Gate section 7: Supabase Realtime, with separately signed-in clients.
 *
 * Every subscriber listens with the app's filters (useLiveSession: one
 * postgres_changes binding per table, filtered to the lobby), except two that
 * listen to whole tables with no filter at all. Each table is on a channel of
 * its own, so the report can say which subscription Realtime accepted or
 * refused. Realtime checks each change against the subscriber's own read
 * policies, so the seated players should hear their lobby and nobody else
 * should hear anything but a bare DELETE, which Realtime cannot check.
 *
 * A signed-out subscriber (the anon role) has no SELECT on ttt_settings,
 * ttt_games or ttt_moves, and Realtime refuses those Postgres Changes
 * subscriptions outright. The app must therefore never put a Tic-Tac-Toe
 * table on a channel for a signed-out browser: Realtime creates a channel's
 * subscriptions together, so the refusal would take the others down with it.
 */
import { Stop, aboutLobby, decodeJwt, describeError, sleep } from './kit.mjs'

const SETTLE_MS = 2500

async function waitFor(predicate, ms = 10000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (predicate()) return true
    await sleep(100)
  }
  return predicate()
}

const summarise = (events) => events.map((e) => `${e.table} ${e.type}`).join(', ') || 'nothing'

// Listeners with no signed-in user, and the tables only signed-in users may read.
const SIGNED_OUT = new Set(['out', 'outWide'])
const GAME_TABLES = new Set(['ttt_settings', 'ttt_games', 'ttt_moves'])

const describe = (list) =>
  list.map((b) => `${b.label} ${b.table}: channel ${b.channelJoined ? 'joined' : b.statuses.join(' > ') || 'no status'}, Postgres Changes ${b.pgStatus}`).join('; ')

/** One INFO line per attempted subscription, and Realtime's full answer whenever it was not "ok". */
function reportSubscriptions(r, subsList) {
  r.note('Subscriptions attempted: who | table | event | filter -> channel status; Postgres Changes answer')
  for (const s of subsList) {
    for (const b of s.bindings) {
      r.info(`subscription ${s.label} | ${b.table} | ${b.event} | ${b.filter ?? 'no filter'}`,
        `channel ${b.statuses.join(' > ') || 'no status'}; Postgres Changes ${b.pgStatus}${b.pgStatus === 'ok' ? '' : ' (full answer below)'}`)
      if (b.pgStatus !== 'ok') r.note(`      Realtime said: ${b.pgMessage}`)
    }
  }
}

export async function realtime(g) {
  const { r } = g
  const { A, B, C, D } = g.users
  r.section('7. Realtime')

  const R = await g.createLobby(A, 'Rita', 'medium', 'R')
  const out = g.signedOut('signed out')
  const subs = {}
  subs.A = await g.subscribe(A, R, 'A')
  subs.B = await g.subscribe(B, R, 'B (not seated yet)')
  subs.C = await g.subscribe(C, R, 'C (seated elsewhere)')
  subs.D = await g.subscribe(D, R, 'D (not seated yet)')
  subs.out = await g.subscribe(out, R, 'signed out')
  subs.Cwide = await g.subscribe(C, null, 'C, whole tables')
  subs.outWide = await g.subscribe(out, null, 'signed out, whole tables')
  // Every attempted subscription, one line each: who, table, event, filter,
  // the channel status (joined over the WebSocket or not) and Realtime's
  // answer about the Postgres Changes subscription itself.
  reportSubscriptions(r, Object.values(subs))
  const all = Object.entries(subs).flatMap(([k, s]) => s.bindings.map((b) => ({ ...b, key: k, label: s.label })))
  const signedIn = all.filter((b) => !SIGNED_OUT.has(b.key))
  const outShared = all.filter((b) => SIGNED_OUT.has(b.key) && !GAME_TABLES.has(b.table))
  const outGame = all.filter((b) => SIGNED_OUT.has(b.key) && GAME_TABLES.has(b.table))
  const badIn = signedIn.filter((b) => !b.accepted)
  r.check(`every signed-in subscription is accepted by Postgres Changes (${signedIn.length - badIn.length} of ${signedIn.length})`, badIn.length === 0, describe(badIn))
  const badShared = outShared.filter((b) => !b.accepted)
  r.check(`signed out, subscriptions to sessions and players are accepted, which Football Imposter needs (${outShared.length - badShared.length} of ${outShared.length})`, badShared.length === 0, describe(badShared))
  const refused = outGame.filter((b) => b.channelJoined && b.pgStatus === 'error')
  if (refused.length === outGame.length) {
    r.pass(`signed out, Postgres Changes refuses all ${outGame.length} subscriptions to ttt_settings, ttt_games and ttt_moves: the channel joins, the subscription is refused. That is expected: the anon role has no SELECT on those tables`)
  } else {
    r.info('signed out, subscriptions to ttt_settings, ttt_games and ttt_moves were not all refused (the checks below still make sure nothing arrives on them)',
      `refused ${refused.length}; ${describe(outGame.filter((b) => !refused.includes(b)))}`)
  }
  if (badIn.length || badShared.length) {
    throw new Stop('a subscription that should have been accepted was not; see the subscription lines above for which one, and what Realtime said')
  }
  await sleep(SETTLE_MS)

  const mark = () => Object.fromEntries(Object.entries(subs).map(([k, s]) => [k, s.events.length]))
  const since = (m, k) => subs[k].events.slice(m[k])
  const protectedFor = (m, k) => since(m, k).filter((e) => e.type !== 'DELETE' && aboutLobby(e, R.sid))
  const nobodyElse = (label, m, keys) => {
    const leaks = keys.map((k) => [subs[k].label, protectedFor(m, k)]).filter(([, e]) => e.length)
    r.check(label, leaks.length === 0, leaks.map(([who, e]) => `${who} got ${summarise(e)}`).join('; '))
  }
  const outsiders = ['C', 'D', 'out', 'Cwide', 'outWide']

  // 1. The opponent joins.
  let m = mark()
  g.ok('B joins lobby R', await g.join(B, R, 'Ben'))
  const joinSeen = await waitFor(() => since(m, 'A').some((e) => e.table === 'players' && e.type === 'INSERT' && e.new.display_name === 'Ben'))
  await sleep(SETTLE_MS)
  r.check('the host hears the new seat (players INSERT)', joinSeen, summarise(since(m, 'A')))
  r.info('B hears its own seat arrive (its subscription started before it held a seat)', summarise(since(m, 'B')))
  nobodyElse('nobody outside the lobby hears it, filtered or not', m, outsiders)

  // 2. Kick-off.
  m = mark()
  g.ok('the host starts board 1', await g.call(A, 'ttt_start_game', { p_session_id: R.sid }))
  const startSeen = (k) => since(m, k).some((e) => e.table === 'ttt_games' && e.type === 'INSERT') && since(m, k).some((e) => e.table === 'sessions' && e.type === 'UPDATE' && e.new.status === 'playing')
  const bothStart = await waitFor(() => startSeen('A') && startSeen('B'))
  await sleep(SETTLE_MS)
  r.check('both players hear the board start (ttt_games INSERT, sessions UPDATE)', bothStart, `A: ${summarise(since(m, 'A'))}; B: ${summarise(since(m, 'B'))}`)
  nobodyElse('nobody else hears the board, filtered or not', m, outsiders)

  // 3. A move.
  let board = await g.board(A, R)
  const T = board.userOf(board.game.turn_mark)
  const N = board.userOf(board.game.turn_mark === 'X' ? 'O' : 'X')
  const plan = g.planLine(board, board.game.turn_mark)
  const pick = plan?.picks[0] ?? { cell: board.candidates.findIndex((c) => c.length), name: board.candidates.find((c) => c.length)[0] }
  m = mark()
  const moved = await g.move(T, R, pick.cell, pick.name)
  r.check(`${T.label} claims a square`, moved.data?.[0]?.outcome === 'claimed', describeError(moved.error))
  const moveSeen = (k) => since(m, k).some((e) => e.table === 'ttt_moves' && e.type === 'INSERT' && e.new.kind === 'claim') && since(m, k).some((e) => e.table === 'ttt_games' && e.type === 'UPDATE')
  const bothMove = await waitFor(() => moveSeen('A') && moveSeen('B'))
  await sleep(SETTLE_MS)
  r.check('both players hear the move (ttt_moves INSERT, ttt_games UPDATE)', bothMove, `A: ${summarise(since(m, 'A'))}; B: ${summarise(since(m, 'B'))}`)
  const moveRecord = since(m, 'A').find((e) => e.table === 'ttt_moves')?.new ?? {}
  r.info('what a move looks like over Realtime', Object.keys(moveRecord).sort().join(', '))
  nobodyElse('nobody else hears the move', m, outsiders)

  // 4. Token refresh mid-game.
  const expiring = decodeJwt(A.client.realtime.accessTokenValue ?? '')?.exp
  for (const who of [A, B]) {
    const before = who.client.realtime.accessTokenValue
    const refreshed = await who.client.auth.refreshSession()
    await sleep(500)
    const now = who.client.realtime.accessTokenValue
    r.check(`${who.label}'s token refresh reaches its Realtime connection`,
      !refreshed.error && now === refreshed.data.session?.access_token && now !== before, describeError(refreshed.error))
  }
  m = mark()
  g.ok(`${N.label} passes after both refreshes`, await g.pass(N, R))
  const afterRefresh = await waitFor(() => ['A', 'B'].every((k) => since(m, k).some((e) => e.table === 'ttt_moves' && e.type === 'INSERT')))
  await sleep(SETTLE_MS)
  r.check('both subscriptions keep delivering after the refresh', afterRefresh, `A: ${summarise(since(m, 'A'))}; B: ${summarise(since(m, 'B'))}`)
  r.check('neither channel errored', ['A', 'B'].every((k) => !subs[k].statuses.some((s) => /ERROR|CLOSED|TIMED_OUT/.test(s))), `${subs.A.statuses.join(' > ')} / ${subs.B.statuses.join(' > ')}`)

  // 4b. Optional: outlive the token the channels were opened with.
  if (g.waitForExpiry) {
    const waitMs = expiring ? expiring * 1000 + 20000 - Date.now() : null
    if (!waitMs || waitMs > 15 * 60 * 1000) {
      r.skip('outliving the original access token', `it expires in ${waitMs ? Math.round(waitMs / 60000) : '?'} minutes; set the access token expiry to 5 minutes for this check (see README)`)
    } else {
      r.note(`Waiting ${Math.round(waitMs / 1000)} s, until 20 s after the token the channels were opened with has expired...`)
      await sleep(Math.max(0, waitMs))
      for (const who of [A, B]) await who.client.auth.refreshSession()
      m = mark()
      const after = await g.board(A, R)
      const mover = after.userOf(after.game.turn_mark)
      g.ok(`${mover.label} passes after the original token expired`, await g.pass(mover, R))
      const stillThere = await waitFor(() => ['A', 'B'].every((k) => since(m, k).some((e) => e.table === 'ttt_moves' && e.type === 'INSERT')))
      r.check('both subscriptions still deliver after the original access token has expired', stillThere,
        `A: ${summarise(since(m, 'A'))}; B: ${summarise(since(m, 'B'))}; system: ${[...subs.A.system, ...subs.B.system].map((x) => x.message).join(' | ')}`)
    }
  }

  // 5. The opponent leaves mid-board: forfeit, and a seat DELETE.
  m = mark()
  g.ok('B leaves mid-board', await g.call(B, 'leave_session', { p_session_id: R.sid, p_player_id: null }))
  const leaveSeen = await waitFor(() =>
    since(m, 'A').some((e) => e.table === 'ttt_games' && e.type === 'UPDATE' && e.new.status === 'forfeited') &&
    since(m, 'A').some((e) => e.table === 'sessions' && e.type === 'UPDATE' && e.new.status === 'waiting'))
  await sleep(SETTLE_MS * 2)
  r.check('the host hears the forfeit and the lobby going back to waiting', leaveSeen, summarise(since(m, 'A')))
  nobodyElse('nobody outside the lobby hears the forfeit', m, outsiders)

  let deleteLeak = false
  for (const [k, s] of Object.entries(subs)) {
    const deletes = since(m, k).filter((e) => e.type === 'DELETE')
    const shapes = deletes.map((e) => `${e.table} DELETE with old = {${Object.keys(e.old).join(', ')}}`)
    r.info(`${s.label} received`, shapes.length ? shapes.join('; ') : 'no DELETE')
    if (deletes.some((e) => Object.keys(e.old).some((col) => col !== 'id'))) deleteLeak = true
  }
  r.check('any seat DELETE that reaches a subscriber carries the primary key only, never the row (no name, no lobby id)', !deleteLeak)
  r.note('The app reacts to every change by re-reading the lobby (useLiveSession calls refresh()), so a DELETE for a seat it does not know costs one extra read and shows nothing.')

  // 6. After leaving, B hears nothing more.
  m = mark()
  g.ok('the host changes the difficulty while waiting', await g.call(A, 'ttt_update_settings', { p_session_id: R.sid, p_difficulty: 'hard' }))
  const settingsSeen = await waitFor(() => since(m, 'A').some((e) => e.table === 'ttt_settings' && e.type === 'UPDATE' && e.new.difficulty === 'hard'))
  await sleep(SETTLE_MS)
  r.check('the host hears the settings change', settingsSeen, summarise(since(m, 'A')))
  nobodyElse('B, who left, hears nothing of it; nor does anyone else', m, ['B', ...outsiders])

  // 7. A replacement joins, on a subscription it opened before joining.
  m = mark()
  g.ok('D joins as the replacement', await g.join(D, R, 'Dee'))
  const dJoin = await waitFor(() => since(m, 'A').some((e) => e.table === 'players' && e.type === 'INSERT' && e.new.display_name === 'Dee'))
  await sleep(SETTLE_MS)
  r.check('the host hears the replacement arrive', dJoin, summarise(since(m, 'A')))
  r.info('D hears its own seat arrive', summarise(since(m, 'D')))
  m = mark()
  g.ok('the host starts a new match with D', await g.call(A, 'ttt_start_game', { p_session_id: R.sid }))
  const dStart = await waitFor(() => since(m, 'D').some((e) => e.table === 'ttt_games' && e.type === 'INSERT') && since(m, 'A').some((e) => e.table === 'ttt_games' && e.type === 'INSERT'))
  await sleep(SETTLE_MS)
  r.check('the replacement now hears the lobby (ttt_games INSERT), as does the host', dStart, `D: ${summarise(since(m, 'D'))}`)
  nobodyElse('B, and everyone outside the lobby, still hear nothing', m, ['B', 'C', 'out', 'Cwide', 'outWide'])

  // 8. The whole-table listeners were alive all along: C hears its own lobby.
  if (g.Z) {
    m = mark()
    g.ok('C changes the difficulty of its own lobby Z', await g.call(C, 'ttt_update_settings', { p_session_id: g.Z.sid, p_difficulty: 'hard' }))
    const cAlive = await waitFor(() => since(m, 'Cwide').some((e) => e.table === 'ttt_settings' && e.new.session_id === g.Z.sid))
    r.check("C's whole-table listener was alive throughout: it hears C's own lobby", cAlive, summarise(since(m, 'Cwide')))
    r.note("That makes its silence about lobby R meaningful. The signed-out whole-table listener's positive control is the Football Imposter check below.")
  } else {
    r.skip("C's whole-table listener's positive control", 'lobby Z was not created (section 3 stopped early)')
  }

  // What else reached the listeners who should hear nothing? Row data from
  // lobby R has been checked above, phase by phase. This lists everything else
  // about Tic-Tac-Toe tables they received, such as a notice with no row in
  // it and an error (Realtime can send "Error 401: Unauthorized" to a
  // subscriber whose role may not read the table at all), so it is visible
  // in the report rather than silently ignored.
  const TTT_OR_SHARED = new Set(['sessions', 'players', 'ttt_settings', 'ttt_games', 'ttt_moves'])
  for (const k of ['C', 'out', 'Cwide', 'outWide']) {
    const odd = subs[k].events.filter((e) => TTT_OR_SHARED.has(e.table) && e.type !== 'DELETE' &&
      ((e.errors && e.errors.length) || (Object.keys(e.new).length === 0 && Object.keys(e.old).length === 0)))
    const shapes = [...new Set(odd.map((e) => `${e.table} ${e.type}${e.errors?.length ? ` errors ${JSON.stringify(e.errors)}` : ''}`))]
    r.info(`${subs[k].label}: notices with no row data`, odd.length ? `${odd.length}: ${shapes.join('; ')}` : 'none')
  }

  // 9. Football Imposter over Realtime, signed out.
  const host = g.signedOut('Imposter host')
  const created = await g.call(host, 'create_session', {
    p_display_name: 'Pia', p_player_pack: 'premier_league', p_difficulty: 'casual', p_num_imposters: 1,
    p_hints_enabled: false, p_votes_visible: false, p_discussion_seconds: 180, p_voting_seconds: 60,
  })
  const I = created.data?.[0]
  if (!I) {
    r.fail('an Imposter lobby for the Realtime check', describeError(created.error))
    return
  }
  const imp = { sid: I.session_id }
  const impOut = await g.subscribe(out, imp, 'signed out, Imposter lobby')
  const impSigned = await g.subscribe(C, imp, 'C, Imposter lobby')
  reportSubscriptions(r, [impOut, impSigned])
  await sleep(SETTLE_MS)
  const guest = g.signedOut('Imposter guest')
  g.ok('someone joins the Imposter lobby', await g.call(guest, 'join_session', { p_code: I.code, p_display_name: 'Quin' }))
  const heardQuin = (events) => events.some((e) => e.table === 'players' && e.type === 'INSERT' && e.new.display_name === 'Quin' && e.new.session_id === imp.sid)
  const impSeen = await waitFor(() => [impOut, impSigned, subs.outWide, subs.Cwide].every((s) => heardQuin(s.events)))
  r.check('Football Imposter changes still reach anyone listening, signed out or in, filtered or not, with the full row', impSeen,
    `signed out: ${summarise(impOut.events)}; signed in: ${summarise(impSigned.events)}; signed out, whole tables: ${heardQuin(subs.outWide.events)}; C, whole tables: ${heardQuin(subs.Cwide.events)}`)
  await g.call(host, 'leave_session', { p_session_id: I.session_id, p_player_id: I.player_id })

  g.R = R
}
