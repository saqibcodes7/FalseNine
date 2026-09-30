import { useCallback, useEffect, useState } from 'react'
import { ensureSession, restoreSession } from '../lib/tttClient'

const LOADING = Object.freeze({ status: 'loading', userId: null, error: null })

/**
 * Whether a Tic-Tac-Toe client has its anonymous session yet.
 *
 *   status  'loading'  still finding out
 *           'ready'    signed in; `userId` is the anonymous user
 *           'none'     this device has no session for this client (only
 *                      when `create` is false: nothing was created)
 *           'error'    the server could not be reached; `error.message` is
 *                      fit to show, and `retry()` tries again
 *
 * With `create`, a device that has no session is signed in anonymously, so
 * 'none' never happens. Without it, the saved session is only restored: a
 * screen that just shows a lobby has no business creating users.
 *
 * Nothing protected may be read or subscribed to until this says 'ready'.
 */
export function useTttAuth(client, { create = false } = {}) {
  const [state, setState] = useState(LOADING)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!client) return undefined
    let cancelled = false
    const pending = create ? ensureSession(client) : restoreSession(client)
    pending.then(
      (session) => {
        if (!cancelled) setState({ status: session ? 'ready' : 'none', userId: session?.user?.id ?? null, error: null })
      },
      (error) => {
        if (!cancelled) setState({ status: 'error', userId: null, error })
      },
    )
    return () => {
      cancelled = true
    }
  }, [client, create, attempt])

  // If Supabase ever gives up on the session (its refresh token was revoked),
  // stop showing the lobby as if nothing happened.
  useEffect(() => {
    if (!client) return undefined
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') setState({ status: 'none', userId: null, error: null })
      else if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        setState((prev) => (prev.status === 'ready' && prev.userId === session.user.id ? prev : { status: 'ready', userId: session.user.id, error: null }))
      }
    })
    return () => data.subscription.unsubscribe()
  }, [client])

  const retry = useCallback(() => {
    setState(LOADING)
    setAttempt((n) => n + 1)
  }, [])

  return { ...state, retry }
}
