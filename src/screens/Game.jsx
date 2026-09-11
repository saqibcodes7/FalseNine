import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Screen from '../ui/Screen'
import Chip from '../ui/Chip'
import { supabase, readableError } from '../lib/supabase'
import { clearIdentity } from '../lib/identity'
import { PHASE_LABEL } from '../lib/game'
import PeekPhase from './game/PeekPhase'
import DiscussionPhase from './game/DiscussionPhase'
import VotingPhase from './game/VotingPhase'
import RevealPhase from './game/RevealPhase'
import SalvagePhase from './game/SalvagePhase'
import EndedPhase from './game/EndedPhase'

/*
 * Everything after "Start game". One screen, six phases, all driven by
 * sessions.status arriving over Realtime. Each phase is its own component;
 * this file owns what they share: who you are, your card, and the one way
 * of calling the server.
 */
export default function Game({ session, players, rounds, votes, identity, live, clockOffset }) {
  const navigate = useNavigate()
  const me = players.find((p) => p.id === identity.playerId) ?? null
  const isHost = session.host_player_id === identity.playerId

  // ---- one door to the server ------------------------------------------
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const call = useCallback(
    async (fn, args = {}, fallback = 'Something went wrong.') => {
      setBusy(true)
      setError(null)
      const { data, error: rpcError } = await supabase.rpc(fn, {
        p_session_id: session.id,
        p_player_id: identity.playerId,
        ...args,
      })
      setBusy(false)
      if (rpcError) {
        setError(readableError(rpcError, fallback))
        return { ok: false, data: null }
      }
      return { ok: true, data }
    },
    [session.id, identity.playerId],
  )

  // The countdown's nudge when a deadline passes. Quiet on purpose: the
  // server decides whether anything is actually due, and a failed nudge is
  // retried by the hook, so there is nothing for the player to act on.
  const nudge = useCallback(() => {
    supabase.rpc('tick', { p_session_id: session.id }).then(() => {})
  }, [session.id])

  // ---- your card: fetched once per page load, held in memory ------------
  const [card, setCard] = useState(null)
  const loadCard = useCallback(async () => {
    if (card) return card
    const { ok, data } = await call('get_my_card', {}, 'Could not fetch your card.')
    if (!ok) return null
    const row = Array.isArray(data) ? data[0] : data
    if (row) setCard(row)
    return row
  }, [call, card])

  function leave() {
    call('leave_session')
    clearIdentity(session.code)
    navigate('/imposter', { replace: true })
  }

  const shared = {
    session,
    players,
    rounds,
    votes,
    me,
    isHost,
    card,
    loadCard,
    call,
    nudge,
    busy,
    error,
    clockOffset,
    leave,
  }

  const status = (
    <span className="flex items-center gap-2">
      {!live && <Chip tone="steel">Reconnecting</Chip>}
      <Chip tone="gold" data-testid="phase">
        {session.status === 'ended' || session.status === 'salvage'
          ? PHASE_LABEL[session.status]
          : `Round ${session.current_round} · ${PHASE_LABEL[session.status] ?? session.status}`}
      </Chip>
    </span>
  )

  const phase = {
    peeking: PeekPhase,
    discussion: DiscussionPhase,
    voting: VotingPhase,
    reveal: RevealPhase,
    salvage: SalvagePhase,
    ended: EndedPhase,
  }[session.status]

  if (!phase || !me) {
    return (
      <Screen status={status} title="One moment">
        <p className="text-body text-chalk-1">Catching up with the table…</p>
      </Screen>
    )
  }

  const Phase = phase
  return <Phase {...shared} status={status} />
}
