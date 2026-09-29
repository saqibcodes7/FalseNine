/**
 * Gate section 6: Football Imposter's public behaviour is unchanged, for a
 * signed-out browser (how the app runs today) and for a signed-in one (how it
 * may run once the app signs everyone in anonymously).
 */
import { describeError } from './kit.mjs'

// The same arguments the app's screens send (CreateGame.jsx, Lobby.jsx).
const CREATE_ARGS = {
  p_player_pack: 'premier_league',
  p_difficulty: 'casual',
  p_num_imposters: 1,
  p_hints_enabled: false,
  p_votes_visible: false,
  p_discussion_seconds: 180,
  p_voting_seconds: 60,
}

export async function imposter(g) {
  const { r } = g
  const { C, D } = g.users
  r.section('6. Football Imposter still works')

  const host = g.signedOut('Imposter host (signed out)')
  const guest = g.signedOut('Imposter guest (signed out)')
  const created = await g.call(host, 'create_session', { p_display_name: 'Pia', ...CREATE_ARGS })
  const row = created.data?.[0]
  if (!g.ok('signed out, create_session makes an Imposter lobby, as today', created, row ? `code ${row.code}` : '')) return
  const I = { label: 'I', sid: row.session_id, code: row.code, host: { ...host, imposterSeat: row.player_id } }
  g.imposterLobby = I

  const q = await g.call(guest, 'join_session', { p_code: I.code, p_display_name: 'Quin' })
  g.ok('signed out, the two-argument join_session call the app makes today still joins', q)
  const cal = await g.call(C, 'join_session', { p_code: I.code, p_display_name: 'Cal', p_game_mode: 'imposter' })
  g.ok('signed in, joining an Imposter lobby works too', cal)
  const guestSeat = q.data?.[0]?.player_id
  const calSeat = cal.data?.[0]?.player_id

  g.ok('the host saves settings with update_session_settings', await g.call(host, 'update_session_settings', {
    p_session_id: I.sid, p_player_id: row.player_id, p_player_pack: 'premier_league', p_difficulty: 'ball_aware',
    p_num_imposters: 1, p_hints_enabled: false, p_votes_visible: true, p_discussion_seconds: 180, p_voting_seconds: 60,
  }))
  for (const who of [guest, D]) {
    const sessions = await g.table(who, 'sessions', (qb) => qb.eq('id', I.sid))
    const players = await g.table(who, 'players', (qb) => qb.eq('session_id', I.sid))
    r.check(`${who === guest ? 'signed out' : 'signed in, with no seat'}, anyone can read the Imposter lobby and its players, as today`,
      sessions.data?.length === 1 && sessions.data[0].difficulty === 'ball_aware' && players.data?.length === 3,
      `${sessions.data?.length} session, ${players.data?.length} players ${describeError(sessions.error ?? players.error)}`)
  }

  g.ok('the host starts the round with start_game', await g.call(host, 'start_game', {
    p_session_id: I.sid, p_player_id: row.player_id, p_candidates: ['Pelé', 'Zico', 'Sócrates'], p_hints: null,
  }))
  const cards = []
  for (const [who, seat] of [[host, row.player_id], [guest, guestSeat], [C, calSeat]]) {
    const card = await g.call(who, 'get_my_card', { p_session_id: I.sid, p_player_id: seat })
    cards.push(card.data?.[0]?.role ?? describeError(card.error))
  }
  r.check('each player gets their card from get_my_card: one imposter, two civilians',
    cards.filter((c) => c === 'imposter').length === 1 && cards.filter((c) => c === 'civilian').length === 2, cards.join(', '))
  const peeking = await g.table(guest, 'sessions', (qb) => qb.eq('id', I.sid))
  const rounds = await g.table(guest, 'rounds', (qb) => qb.eq('session_id', I.sid))
  r.check('anyone can see the lobby move into its first round (peeking), and rounds stay readable, as today',
    peeking.data?.[0]?.status === 'peeking' && peeking.data[0].current_round === 1 && Array.isArray(rounds.data),
    `${peeking.data?.[0]?.status}, round ${peeking.data?.[0]?.current_round}; rounds ${rounds.data ? rounds.data.length : describeError(rounds.error)}`)
  g.denied('hidden roles stay unreadable (player_secrets)', await g.table(guest, 'player_secrets'))
  g.ok('an Imposter player leaves with leave_session and their player id, as today', await g.call(guest, 'leave_session', { p_session_id: I.sid, p_player_id: guestSeat }))
  const left = await g.table(host, 'players', (qb) => qb.eq('session_id', I.sid))
  r.check('the seat has gone, or is marked out mid-round, as Imposter\'s own rules say',
    left.data && (left.data.length === 2 || left.data.some((p) => p.id === guestSeat && p.is_active === false)), `${left.data?.length} seats`)
  await g.call(host, 'leave_session', { p_session_id: I.sid, p_player_id: row.player_id })
  await g.call(host, 'leave_session', { p_session_id: I.sid, p_player_id: row.player_id })
}
