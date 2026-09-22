import { playersFor, DEFAULT_PACK_ID, DEFAULT_DIFFICULTY_ID } from '../data/packs'

/**
 * Pass & Play: Football Imposter on one phone, with nobody online.
 *
 * There is no server here and there is nothing to keep secret from, because
 * everyone is in the same room looking at the same device. So the whole game
 * lives in this file as plain data, and the only rule that matters is the one
 * the online game enforces with a locked-down table: a card is face down until
 * the person holding the phone turns it over, and it goes face down again
 * before the phone moves on.
 *
 * Players are numbers, not names — Player 2 is the second person to peek.
 * Nobody types anything to start a game, which is the point of the mode.
 *
 * The phone deals, times and reveals. It does not referee: it never decides
 * who has won, because the table can see that for itself and arguing about it
 * is half the game.
 */

export const MIN_PLAYERS = 3
export const MAX_PLAYERS = 12

/** 0 means no limit — the table talks until someone says stop. */
export const NO_LIMIT = 0

export const DEFAULT_SETTINGS = {
  players: 5,
  imposters: 1,
  packId: DEFAULT_PACK_ID,
  difficultyId: DEFAULT_DIFFICULTY_ID,
  hints: false,
  discussionSeconds: 180,
  votingSeconds: 60,
}

/** Imposters have to be outnumbered, the same rule the online game applies. */
export function maxImpostersFor(players) {
  return Math.max(1, Math.ceil(players / 2) - 1)
}

export function settingsAreValid(settings) {
  return (
    settings.players >= MIN_PLAYERS &&
    settings.players <= MAX_PLAYERS &&
    settings.imposters >= 1 &&
    settings.imposters < settings.players - settings.imposters
  )
}

/** Fisher-Yates. Math.random is plenty for deciding who lies at a party. */
function shuffled(list) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * A fresh game from a set of settings: one footballer drawn from the pack, and
 * a role per player. `roles[0]` is Player 1.
 */
export function deal(settings) {
  const pool = playersFor(settings.packId, settings.difficultyId)
  const pick = pool[Math.floor(Math.random() * pool.length)] ?? { name: '', hint: null }

  const seats = shuffled(
    Array.from({ length: settings.players }, (_, i) => i),
  ).slice(0, settings.imposters)
  const imposterSeats = new Set(seats)

  return {
    settings,
    target: pick.name,
    hint: settings.hints ? (pick.hint ?? null) : null,
    roles: Array.from({ length: settings.players }, (_, i) =>
      imposterSeats.has(i) ? 'imposter' : 'civilian',
    ),
    out: [],        // player numbers, in the order the table voted them out
    round: 1,
    phase: 'deal',
    phaseStartedAt: null, // when the current timed phase began
    peeking: 1,     // the player number the phone is being passed to
    lastOut: null,  // the number revealed on the outcome screen
  }
}

/** Player numbers still in the game, in order. */
export function stillIn(game) {
  return Array.from({ length: game.settings.players }, (_, i) => i + 1).filter(
    (n) => !game.out.includes(n),
  )
}

export function roleOf(game, number) {
  return game.roles[number - 1]
}

/** Imposters not yet voted out. The table can see this; so can the phone. */
export function impostersLeft(game) {
  return game.roles.filter((role, i) => role === 'imposter' && !game.out.includes(i + 1)).length
}

/**
 * Another round only makes sense while there are enough people left to hold
 * one. Below that the phone offers the full reveal instead.
 */
export function canPlayAnotherRound(game) {
  return stillIn(game).length >= MIN_PLAYERS
}

// ---------------------------------------------------------------------------
// Transitions. Each returns a new game; none of them mutate.
// ---------------------------------------------------------------------------

/**
 * A timed phase records when it began, so a clock survives a refresh rather
 * than restarting and handing the table free minutes.
 */
function startingNow(game, phase) {
  return { ...game, phase, phaseStartedAt: Date.now() }
}

/** The card goes face down and the phone moves to the next player. */
export function passOn(game) {
  if (game.peeking >= game.settings.players) {
    return startingNow({ ...game, peeking: game.settings.players }, 'discussion')
  }
  return { ...game, peeking: game.peeking + 1 }
}

export function toVoting(game) {
  return startingNow(game, 'voting')
}

export function toOutcome(game) {
  return { ...game, phase: 'outcome', lastOut: null }
}

/** The table says who is out. `null` means they could not agree on anybody. */
export function voteOut(game, number) {
  if (number === null) return { ...game, lastOut: null, phase: 'outcome', skipped: true }
  if (game.out.includes(number)) return game
  return { ...game, out: [...game.out, number], lastOut: number, skipped: false }
}

export function nextRound(game) {
  return startingNow({ ...game, round: game.round + 1, lastOut: null, skipped: false }, 'discussion')
}

export function finish(game) {
  return { ...game, phase: 'ended' }
}

/** Same table, same settings, new footballer and a new deal. */
export function again(game) {
  return deal(game.settings)
}

// ---------------------------------------------------------------------------
// Surviving a refresh.
//
// A phone being passed around a table locks, sleeps, and gets its browser tab
// discarded. Losing the game to that would be miserable, so the whole thing is
// mirrored into sessionStorage. There is nothing to protect here: every person
// who can read this storage is already holding the phone everyone is sharing.
// ---------------------------------------------------------------------------

const KEY = 'fn:passplay'

export function saveGame(game) {
  try {
    if (game) window.sessionStorage.setItem(KEY, JSON.stringify(game))
    else window.sessionStorage.removeItem(KEY)
  } catch {
    // Private mode, or storage disabled. The game plays fine; it just will not
    // come back from a refresh.
  }
}

export function loadGame() {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const game = JSON.parse(raw)
    // Anything half-written or from an older shape is not worth resuming.
    if (!game?.settings?.players || !Array.isArray(game.roles)) return null
    if (game.roles.length !== game.settings.players) return null
    return game
  } catch {
    return null
  }
}

export function clearGame() {
  saveGame(null)
}
