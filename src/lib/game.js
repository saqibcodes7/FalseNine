/**
 * Pure helpers for reading the game state the server publishes. Nothing in
 * here touches the network; every function takes rows from useLobby and
 * returns something a screen can render. Kept separate so the rules are easy
 * to read in one place and easy to test without a browser.
 */

/** The row for a given phase of the current round, if the server has opened it. */
export function phaseRound(rounds, session, phase = session?.status) {
  if (!session || !rounds) return null
  return (
    rounds.find((r) => r.round_number === session.current_round && r.phase === phase) ?? null
  )
}

/** The voting row of the current round: where votes and the result live. */
export function votingRound(rounds, session) {
  return phaseRound(rounds, session, 'voting')
}

/** Whole seconds left until `endsAt`, judged by the server's clock. */
export function secondsUntil(endsAt, clockOffset = 0, now = Date.now()) {
  if (!endsAt) return 0
  const serverNow = now + clockOffset
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - serverNow) / 1000))
}

export function activePlayers(players) {
  return players.filter((p) => p.is_active)
}

export function isOut(player) {
  return player && !player.is_active
}

/** The vote this player cast in the given round, or null. */
export function voteBy(votes, round, playerId) {
  if (!round) return null
  return votes.find((v) => v.round_id === round.id && v.voter_id === playerId) ?? null
}

/** Votes cast in a round, newest last. */
export function votesIn(votes, round) {
  if (!round) return []
  return votes.filter((v) => v.round_id === round.id)
}

/**
 * The breakdown of a round's votes, ready to draw: one line per candidate
 * with their count and the names of who picked them, plus the skips.
 */
export function tallyView(votes, round, players) {
  const cast = votesIn(votes, round)
  const byId = new Map(players.map((p) => [p.id, p]))
  const lines = new Map()
  const skips = []

  for (const v of cast) {
    const voter = byId.get(v.voter_id)?.display_name ?? 'Someone'
    if (v.is_skip) {
      skips.push(voter)
      continue
    }
    const target = byId.get(v.voted_for_id)
    if (!target) continue
    const line = lines.get(target.id) ?? { player: target, count: 0, voters: [] }
    line.count += 1
    line.voters.push(voter)
    lines.set(target.id, line)
  }

  return {
    cast: cast.length,
    lines: [...lines.values()].sort((a, b) => b.count - a.count),
    skips,
  }
}

/**
 * Imposters still in the game, worked out from public data only: the total
 * the host set, minus the imposters who have been revealed and are out.
 */
export function impostersRemaining(session, players) {
  if (!session) return 0
  const found = players.filter((p) => !p.is_active && p.revealed_role === 'imposter').length
  return Math.max(0, session.num_imposters - found)
}

/**
 * What the host's Continue button will do after a reveal, so the screen can
 * say so. Mirrors continue_round() on the server.
 */
export function nextAfterReveal(session, players) {
  const imposters = impostersRemaining(session, players)
  const active = activePlayers(players).length
  const civilians = active - imposters
  if (imposters === 0) return 'salvage'
  if (imposters >= civilians) return 'imposters-win'
  return 'discussion'
}

/** The player voted out in the current round, if any. */
export function eliminatedThisRound(rounds, session, players) {
  const round = votingRound(rounds, session)
  if (!round?.eliminated_player_id) return null
  return players.find((p) => p.id === round.eliminated_player_id) ?? null
}

/** Section 5's wording for an imposter being found. */
export function imposterFoundMessage(name, remaining) {
  if (remaining === 0) return `${name} was indeed the Imposter. That was the last one.`
  return `${name} was indeed the Imposter. ${remaining} imposter${remaining === 1 ? '' : 's'} remain${
    remaining === 1 ? 's' : ''
  }.`
}

/** Phase labels for the status chip. */
export const PHASE_LABEL = {
  peeking: 'Peek',
  discussion: 'Discuss',
  voting: 'Vote',
  reveal: 'Reveal',
  salvage: 'Last chance',
  ended: 'Full time',
}
