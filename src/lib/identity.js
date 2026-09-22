/**
 * Who this browser is, per lobby.
 *
 * There are no logins. When you create or join a game the server hands back a
 * player uuid, and that uuid is how this browser proves it is you for the rest
 * of the game. It is stored per session code so you can have two lobbies open
 * in two tabs while testing without them fighting over one key.
 *
 * A v4 uuid is unguessable, so this is a reasonable bearer token for a party
 * game. It is not a security boundary against someone with access to your
 * actual phone, and it does not need to be.
 */

const KEY_PREFIX = 'fn:imposter:'

/**
 * How many seats the Rejoin list offers. Two, because the only ones worth
 * offering are the game you are in and the one you were just in. Nothing here
 * ever expired, so on a phone that is never cleared the list grew into a
 * history of every game ever played.
 */
const REJOIN_LIMIT = 2

/**
 * How many seats stay in storage. More than the list shows, because a seat
 * that is not offered is still a seat: someone with three lobbies open should
 * not be thrown out of the oldest one on refresh just because it is not on
 * the list any more.
 */
const KEEP_LIMIT = 10

function keyFor(code) {
  return `${KEY_PREFIX}${String(code || '').toUpperCase()}`
}

/** Safe to call in private mode or with storage disabled — returns null. */
export function loadIdentity(code) {
  if (!code) return null
  try {
    const raw = window.localStorage.getItem(keyFor(code))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && parsed.playerId ? parsed : null
  } catch {
    return null
  }
}

export function saveIdentity(code, identity) {
  try {
    window.localStorage.setItem(keyFor(code), JSON.stringify(identity))
    pruneIdentities()
  } catch {
    // Storage full, blocked, or private mode. The player stays in the game for
    // this page load; they just lose their seat on refresh. Not worth crashing.
  }
}

/** Drop the oldest seats past KEEP_LIMIT so storage cannot grow forever. */
function pruneIdentities() {
  try {
    const all = allIdentities()
    for (const entry of all.slice(KEEP_LIMIT)) {
      window.localStorage.removeItem(keyFor(entry.code))
    }
  } catch {
    // Pruning is housekeeping. If it fails, nothing the player does breaks.
  }
}

export function clearIdentity(code) {
  try {
    window.localStorage.removeItem(keyFor(code))
  } catch {
    // Nothing useful to do here.
  }
}

/**
 * The seats worth offering on the home screen: the newest few, not the lot.
 * Pass a different limit if you want more; pass Infinity for everything.
 */
export function listIdentities(limit = REJOIN_LIMIT) {
  return allIdentities().slice(0, limit)
}

/** Every lobby this browser has a seat in, newest first. */
function allIdentities() {
  const out = []
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith(KEY_PREFIX)) continue
      const value = JSON.parse(window.localStorage.getItem(key))
      if (value && value.playerId) {
        out.push({ code: key.slice(KEY_PREFIX.length), ...value })
      }
    }
  } catch {
    return []
  }
  return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
}
