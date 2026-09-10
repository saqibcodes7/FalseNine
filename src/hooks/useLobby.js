import { useCallback, useEffect, useRef, useState } from 'react'
import {
  supabase,
  isSupabaseConfigured,
  PLAYER_COLUMNS,
  SESSION_COLUMNS,
} from '../lib/supabase'

/**
 * Live view of one lobby, keyed by join code.
 *
 * Realtime tells us *that* something changed; we then refetch both rows. For a
 * lobby capped at 12 players that is two tiny queries, and it sidesteps a whole
 * category of bug where you try to merge an event payload into local state and
 * get the ordering wrong.
 *
 * If the websocket never connects (corporate wifi, flaky tethering), it falls
 * back to polling every 5s so the lobby still fills in.
 */
export function useLobby(code) {
  const [session, setSession] = useState(null)
  const [players, setPlayers] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | missing | error
  const [error, setError] = useState(null)
  const [live, setLive] = useState(false)

  // Kept in a ref so the realtime callback never closes over a stale id.
  const sessionIdRef = useRef(null)

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !code) return

    const normalised = String(code).toUpperCase()

    const { data: sessionRow, error: sessionError } = await supabase
      .from('sessions')
      .select(SESSION_COLUMNS)
      .eq('code', normalised)
      .maybeSingle()

    if (sessionError) {
      setError(sessionError.message)
      setStatus('error')
      return
    }

    if (!sessionRow) {
      // The host closed the lobby, or the code was mistyped.
      sessionIdRef.current = null
      setSession(null)
      setPlayers([])
      setStatus('missing')
      return
    }

    sessionIdRef.current = sessionRow.id
    setSession(sessionRow)

    const { data: playerRows, error: playersError } = await supabase
      .from('players')
      .select(PLAYER_COLUMNS)
      .eq('session_id', sessionRow.id)
      .order('joined_at', { ascending: true })

    if (playersError) {
      setError(playersError.message)
      setStatus('error')
      return
    }

    setPlayers(playerRows ?? [])
    setError(null)
    setStatus('ready')
  }, [code])

  // Initial load.
  useEffect(() => {
    setStatus('loading')
    refresh()
  }, [refresh])

  // Realtime subscription, re-established whenever the session id changes.
  useEffect(() => {
    if (!isSupabaseConfigured || !session?.id) return undefined

    const sessionId = session.id
    const channel = supabase
      .channel(`lobby:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'players',
          filter: `session_id=eq.${sessionId}`,
        },
        () => refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${sessionId}`,
        },
        () => refresh(),
      )
      .subscribe((channelStatus) => {
        setLive(channelStatus === 'SUBSCRIBED')
      })

    return () => {
      setLive(false)
      supabase.removeChannel(channel)
    }
    // `refresh` is stable for a given code, so this runs once per lobby.
  }, [session?.id, refresh])

  // Polling fallback, only while the websocket is down.
  useEffect(() => {
    if (!isSupabaseConfigured || live || status === 'missing') return undefined
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [live, status, refresh])

  return { session, players, status, error, live, refresh }
}
