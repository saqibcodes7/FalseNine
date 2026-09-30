import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import { Alert } from '../../ui/Field'
import { isSupabaseConfigured } from '../../lib/supabase'
import { tttClient } from '../../lib/tttClient'
import { TTT_MODE, leaveGame } from '../../lib/tttApi'
import { tttErrorMessage } from '../../lib/tttErrors'
import { matchPhase } from '../../lib/tttBoard'
import { clearIdentity, loadIdentity } from '../../lib/identity'
import { useTttAuth } from '../../hooks/useTttAuth'
import { useTicTacToeSession } from '../../hooks/useTicTacToeSession'
import TttLobby from './TttLobby'
import TttOnlineMatch from './TttOnlineMatch'

/*
 * One Online game, from the lobby to the last board, at /tic-tac-toe/game/:code.
 *
 * On arrival, including after a reload, the device's saved anonymous session
 * is restored (never created: a screen that shows a lobby has no business
 * making users). Only then is anything read or subscribed to. The lobby is
 * only readable from a seat in it, and which seat is yours comes from the
 * server (ttt_my_seat), so a reload lands you back in your own seat and
 * nobody else's.
 *
 * Leaving happens only when someone presses Leave. Closing the tab, reloading
 * or navigating away does nothing on the server, so a player who drops out by
 * accident can come straight back.
 */
export default function TttGame() {
  const { code } = useParams()
  const upper = (code || '').toUpperCase()
  const client = tttClient('online')
  const auth = useTttAuth(client, { create: false })
  const view = useTicTacToeSession(client, upper, { ready: auth.status === 'ready' })
  const hadSeat = Boolean(loadIdentity(upper, TTT_MODE))
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)
  const [leaveError, setLeaveError] = useState(null)

  if (!isSupabaseConfigured) return <Navigate to="/tic-tac-toe" replace />

  if (auth.status === 'error') return <Problem message={auth.error?.message} onRetry={auth.retry} />
  if (auth.status === 'none') return <NotInGame code={upper} hadSeat={hadSeat} />
  if (auth.status === 'loading' || view.status === 'loading') return <Loading />
  // Our own Leave closing the lobby is not news; the navigation is on its way.
  if (view.status === 'missing' && leaving) return <Loading />
  if (view.status === 'missing') return <NotInGame code={upper} hadSeat={hadSeat} />
  if (!view.session) return <Problem message="Could not load this game. Check your connection." onRetry={view.refresh} />
  if (view.mySeat === undefined) return <Loading />
  if (view.mySeat === null) return <NotInGame code={upper} hadSeat={hadSeat} />

  const isHost = view.session.host_player_id === view.mySeat

  async function leave() {
    if (leaving) return
    setLeaving(true)
    setLeaveError(null)
    const { error } = await leaveGame(client, view.session.id, view.mySeat)
    if (error) {
      setLeaveError(tttErrorMessage(error, 'leave'))
      setLeaving(false)
      view.refresh()
      return
    }
    clearIdentity(upper, TTT_MODE)
    navigate('/tic-tac-toe/online', { replace: true })
  }

  const shared = { client, view, isHost, onLeave: leave, leaving, leaveError }
  return matchPhase(view.session, view.game) === 'lobby' ? <TttLobby {...shared} /> : <TttOnlineMatch {...shared} />
}

function Loading() {
  return (
    <Screen back="/tic-tac-toe/online" backLabel="Online" accent="accent-teal" title="Loading game…">
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="surface h-16 animate-pulse" />
        ))}
      </div>
    </Screen>
  )
}

function Problem({ message, onRetry }) {
  return (
    <Screen back="/tic-tac-toe/online" backLabel="Online" accent="accent-teal" title="Can't reach the game">
      <Alert>{message || 'Could not reach the game server. Check your connection and try again.'}</Alert>
      <Button fullWidth size="lg" className="mt-6" onClick={onRetry}>
        Try again
      </Button>
    </Screen>
  )
}

/*
 * A lobby this device cannot see: the code is wrong, the game has closed, or
 * this device never had a seat in it. From outside they look the same, which
 * is the point, so the words depend only on whether this device was in it.
 */
function NotInGame({ code, hadSeat }) {
  const navigate = useNavigate()
  if (hadSeat) {
    return (
      <Screen back="/tic-tac-toe/online" backLabel="Online" accent="accent-teal" title="That game has closed">
        <p className="max-w-[38ch] text-body leading-relaxed text-text-2" data-testid="ttt-not-in-game">
          The host may have closed it, or you left it on another screen.
        </p>
        <Button
          fullWidth
          size="lg"
          className="mt-6"
          onClick={() => {
            clearIdentity(code, TTT_MODE)
            navigate('/tic-tac-toe/online', { replace: true })
          }}
        >
          Back to Online
        </Button>
      </Screen>
    )
  }
  return (
    <Screen back="/tic-tac-toe/online" backLabel="Online" accent="accent-teal" title="You're not in this game">
      <p className="max-w-[38ch] text-body leading-relaxed text-text-2" data-testid="ttt-not-in-game">
        This device has no seat in game <span className="tabular font-bold tracking-[0.08em] text-gold">{code}</span>. If
        it is still waiting for an opponent, you can join it.
      </p>
      <Button fullWidth size="lg" className="mt-6" onClick={() => navigate(`/tic-tac-toe/online/join?code=${code}`)}>
        Join this game
      </Button>
    </Screen>
  )
}
