import { createClient, isAuthRetryableFetchError } from '@supabase/supabase-js'
import { isSupabaseConfigured } from './supabase'

/**
 * The Supabase clients Football Tic-Tac-Toe plays through.
 *
 * Every Tic-Tac-Toe seat belongs to a signed-in user (migration 0010), so this
 * game needs a session where Football Imposter deliberately has none. The
 * shared client in lib/supabase.js is left exactly as it is: it keeps no
 * session, and Imposter goes on working signed out. Tic-Tac-Toe gets clients
 * of its own instead, each with its session saved under its own storage key:
 *
 *   online  the one person holding this device, for Online games
 *   p1, p2  the two people sharing this device in Pass & Play
 *
 * Pass & Play needs two because the backend gives each seat to a different
 * auth.uid(), and one person can never hold both seats of a game. So the two
 * players really are two anonymous users, and every move goes through the
 * client of the player making it.
 *
 * Nobody ever sees any of this. There is no sign-in screen: the first time a
 * client needs a session it signs in anonymously, and Supabase keeps that
 * session in localStorage and refreshes it. Nothing here ever signs anyone
 * out, so the same anonymous user comes back after a reload, and a game left
 * open can be picked up again.
 *
 * The keys sit under `fn:auth:` so they can never be mistaken for the lobby
 * seats in lib/identity.js (`fn:<game>:<CODE>`), nor for each other, nor for
 * the key the shared client would use.
 *
 * Clients are made on first use, and only by Tic-Tac-Toe screens, so opening
 * Football Imposter never creates one.
 */
export const TTT_AUTH_KEYS = Object.freeze({
  online: 'fn:auth:tic_tac_toe:online',
  p1: 'fn:auth:tic_tac_toe:pass:p1',
  p2: 'fn:auth:tic_tac_toe:pass:p2',
})

const clients = new Map()

export function tttClient(slot) {
  if (!isSupabaseConfigured) return null
  const storageKey = TTT_AUTH_KEYS[slot]
  if (!storageKey) throw new Error(`Unknown Tic-Tac-Toe client: ${slot}`)
  if (!clients.has(slot)) {
    clients.set(
      slot,
      createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey,
        },
        realtime: { params: { eventsPerSecond: 10 } },
      }),
    )
  }
  return clients.get(slot)
}

/** Raised when a client could not get a session. `message` is fit to show. */
export class TttConnectError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'TttConnectError'
    this.cause = cause
  }
}

function connectMessage(error) {
  const status = error?.status
  if (status === 429) return 'Too many new players from this network just now. Wait a minute and try again.'
  if (status === 422 || /anonymous sign-ins are disabled/i.test(error?.message ?? '')) {
    return 'Football Tic-Tac-Toe is not available right now.'
  }
  return 'Could not reach the game server. Check your connection and try again.'
}

/**
 * The session this client already has, or null. Never creates a user, so it
 * is what a screen uses to find out whether this device is anyone yet.
 * Throws when the server cannot be reached, rather than reporting "nobody":
 * losing the connection must never look like losing your seat.
 */
export async function restoreSession(client) {
  const { data, error } = await client.auth.getSession()
  if (data?.session) return data.session
  if (error && isAuthRetryableFetchError(error)) throw new TttConnectError(connectMessage(error), error)
  return null
}

async function sessionOrSignIn(client) {
  const existing = await restoreSession(client)
  if (existing) return existing
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data?.session) throw new TttConnectError(connectMessage(error), error)
  return data.session
}

// One queue per client. React runs effects twice in development, and two
// taps can land at once: without this, two calls that both find no session
// would each sign in and make two users.
const queues = new WeakMap()

/**
 * The client's session, signing in anonymously first if it has none. Calls
 * for the same client run one after another, so only the first can create a
 * user; the rest find its session.
 */
export function ensureSession(client) {
  const previous = queues.get(client) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(() => sessionOrSignIn(client))
  queues.set(client, next)
  return next
}
