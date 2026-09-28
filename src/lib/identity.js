/**
 * Who this browser is, per lobby, per game.
 *
 * There are no logins. When you create or join a game the server hands back a
 * player uuid, and that uuid is how this browser proves it is you for the rest
 * of the game. It is stored per session code so you can have two lobbies open
 * in two tabs while testing without them fighting over one key.
 *
 * Each game keeps its seats under its own prefix, `fn:<mode>:<CODE>`, where
 * <mode> is the game's id in the database (`sessions.game_mode`). Football
 * Imposter was the only game when this was written, and its seats were always
 * stored as `fn:imposter:<CODE>`, which is exactly that shape, so every seat
 * saved before other games existed is still found where it always was.
 * Imposter is the default mode, so its screens call these exactly as before.
 *
 * A v4 uuid is unguessable, so this is a reasonable bearer token for a party
 * game. It is not a security boundary against someone with access to your
 * actual phone, and it does not need to be.
 */

const DEFAULT_MODE = 'imposter'

/**
 * How many seats the Rejoin list offers. Two, because the only ones worth
 * offering are the game you are in and the one you were just in. Nothing here
 * ever expired, so on a phone that is never cleared the list grew into a
 * history of every game ever played.
 */
const REJOIN_LIMIT = 2

/**
 * How many seats stay in storage, per game. More than the list shows, because
 * a seat that is not offered is still a seat: someone with three lobbies open
 * should not be thrown out of the oldest one on refresh just because it is not
 * on the list any more. Counted per game, so playing lots of one game never
 * evicts your seat in another.
 */
const KEEP_LIMIT = 10

function prefixFor(mode) {
  // Mode ids are lowercase words (the database checks the same shape), and
  // codes never contain a colon, so one game's prefix can never match another's.
  if (!/^[a-z][a-z0-9_]*$/.test(mode)) throw new Error(`Unknown game mode: ${mode}`)
  return `fn:${mode}:`
}

function keyFor(code, mode) {
  return `${prefixFor(mode)}${String(code || '').toUpperCase()}`
}

/** Safe to call in private mode or with storage disabled — returns null. */
export function loadIdentity(code, mode = DEFAULT_MODE) {
  if (!code) return null
  try {
    const raw = window.localStorage.getItem(keyFor(code, mode))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && parsed.playerId ? parsed : null
  } catch {
    return null
  }
}

export function saveIdentity(code, identity, mode = DEFAULT_MODE) {
  try {
    window.localStorage.setItem(keyFor(code, mode), JSON.stringify(identity))
    pruneIdentities(mode)
  } catch {
    // Storage full, blocked, or private mode. The player stays in the game for
    // this page load; they just lose their seat on refresh. Not worth crashing.
  }
}

/** Drop this game's oldest seats past KEEP_LIMIT so storage cannot grow forever. */
function pruneIdentities(mode) {
  try {
    for (const entry of allIdentities(mode).slice(KEEP_LIMIT)) {
      window.localStorage.removeItem(keyFor(entry.code, mode))
    }
  } catch {
    // Pruning is housekeeping. If it fails, nothing the player does breaks.
  }
}

export function clearIdentity(code, mode = DEFAULT_MODE) {
  try {
    window.localStorage.removeItem(keyFor(code, mode))
  } catch {
    // Nothing useful to do here.
  }
}

/**
 * The seats worth offering on a game's home screen: that game's newest few,
 * not the lot. Pass a different limit if you want more; Infinity for all.
 */
export function listIdentities({ mode = DEFAULT_MODE, limit = REJOIN_LIMIT } = {}) {
  return allIdentities(mode).slice(0, limit)
}

/** Every lobby of one game this browser has a seat in, newest first. */
function allIdentities(mode) {
  const prefix = prefixFor(mode)
  const out = []
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith(prefix)) continue
      const value = JSON.parse(window.localStorage.getItem(key))
      if (value && value.playerId) {
        out.push({ code: key.slice(prefix.length), ...value })
      }
    }
  } catch {
    return []
  }
  return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
}
