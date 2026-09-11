import { useCallback, useEffect, useRef, useState } from 'react'
import {
  supabase,
  isSupabaseConfigured,
  PLAYER_COLUMNS,
  SESSION_COLUMNS,
  ROUND_COLUMNS,
  VOTE_COLUMNS,
} from '../lib/supabase'

/**
 * Live view of one game, keyed by join code: the session, its players, its
 * rounds and its votes.
 *
 * Realtime tells us *that* something changed; we then refetch. For a lobby
 * capped at 12 players that is four tiny queries, and it sidesteps a whole
 * category of bug where you try to merge an event payload into local state
 * and get the ordering wrong.
 *
 * If the websocket never connects (corporate wifi, flaky tethering), it falls
 * back to polling every 3s so the game still moves.
 *
 * `clockOffset` is server time minus this phone's time, measured once, so
 * countdowns can be run against the server's deadline rather than trusting
 * the phone's clock.
 */
export function useLobby(code) {
  const [session, setSession] = useState(null)
  const [players, setPlayers] = useState([])
  const [rounds, setRounds] = useState([])
  const [votes, setVotes] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | missing | error
  const [error, setError] = useState(null)
  const [live, setLive] = useState(false)
  const [clockOffset, setClockOffset] = useState(0)

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
      setRounds([])
      setVotes([])
      setStatus('missing')
      return
    }

    sessionIdRef.current = sessionRow.id

    const [playersRes, roundsRes, votesRes] = await Promise.all([
      supabase
        .from('players')
        .select(PLAYER_COLUMNS)
        .eq('session_id', sessionRow.id)
        .order('joined_at', { ascending: true }),
      sessionRow.status === 'waiting'
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from('rounds')
            .select(ROUND_COLUMNS)
            .eq('session_id', sessionRow.id)
            .order('started_at', { ascending: true }),
      sessionRow.status === 'waiting'
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from('votes')
            .select(VOTE_COLUMNS)
            .eq('session_id', sessionRow.id)
            .order('created_at', { ascending: true }),
    ])

    const failed = playersRes.error || roundsRes.error || votesRes.error
    if (failed) {
      setError(failed.message)
      setStatus('error')
      return
    }

    // Set the session last so a screen never sees a new status with stale rows.
    setPlayers(playersRes.data ?? [])
    setRounds(roundsRes.data ?? [])
    setVotes(votesRes.data ?? [])
    setSession(sessionRow)
    setError(null)
    setStatus('ready')
  }, [code])

  // Initial load.
  useEffect(() => {
    setStatus('loading')
    refresh()
  }, [refresh])

  // One clock check per page load. If it fails we assume the phone is right.
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const sent = Date.now()
    supabase.rpc('server_now').then(({ data }) => {
      if (!data) return
      const received = Date.now()
      const serverMs = new Date(data).getTime()
      // Assume the reply took as long to come back as the request took to go.
      setClockOffset(serverMs - (sent + received) / 2)
    })
  }, [])

  // Realtime subscription, re-established whenever the session id changes.
  useEffect(() => {
    if (!isSupabaseConfigured || !session?.id) return undefined

    const sessionId = session.id
    const on = (table, filter) => ({
      event: '*',
      schema: 'public',
      table,
      filter,
    })

    const channel = supabase
      .channel(`lobby:${sessionId}`)
      .on('postgres_changes', on('players', `session_id=eq.${sessionId}`), () => refresh())
      .on('postgres_changes', on('sessions', `id=eq.${sessionId}`), () => refresh())
      .on('postgres_changes', on('rounds', `session_id=eq.${sessionId}`), () => refresh())
      .on('postgres_changes', on('votes', `session_id=eq.${sessionId}`), () => refresh())
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
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [live, status, refresh])

  return { session, players, rounds, votes, status, error, live, refresh, clockOffset }
}
