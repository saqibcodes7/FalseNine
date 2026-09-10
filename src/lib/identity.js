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
  } catch {
    // Storage full, blocked, or private mode. The player stays in the game for
    // this page load; they just lose their seat on refresh. Not worth crashing.
  }
}

export function clearIdentity(code) {
  try {
    window.localStorage.removeItem(keyFor(code))
  } catch {
    // Nothing useful to do here.
  }
}

/** Every lobby this browser has a seat in, newest first. */
export function listIdentities() {
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
