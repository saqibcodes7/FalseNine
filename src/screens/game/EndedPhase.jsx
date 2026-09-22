import { useNavigate } from 'react-router-dom'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import RevealCard from '../../ui/RevealCard'
import PlayerRoster from '../../ui/PlayerRoster'
import { Alert } from '../../ui/Field'
import { clearIdentity } from '../../lib/identity'

/*
 * Full time. Who won, how, and the footballer everyone was talking about.
 * Every role is public now, so the roster shows them all.
 *
 * "Play again" puts this same lobby back to waiting: same code, same people,
 * same settings. Nobody types a code in twice, and the rest of the table is
 * carried along automatically, because every phone is watching the status.
 */
export default function EndedPhase({ session, players, me, isHost, call, busy, error, status }) {
  const navigate = useNavigate()
  const guesser = players.find((p) => p.id === session.salvage_player_id) ?? null
  const host = players.find((p) => p.id === session.host_player_id) ?? null
  const civiliansWon = session.winner === 'civilians'
  const stolen = session.winner === 'imposters' && session.salvage_correct === true

  // The chip on the card names the winner; the big word says how.
  let tone = 'win'
  let name = 'Clean sheet'
  let message = `Every imposter was found. The player was ${session.revealed_target}.`

  if (civiliansWon && session.salvage_guess) {
    message = `${guesser?.display_name ?? 'The last imposter'} guessed “${session.salvage_guess}”. It was ${session.revealed_target}.`
  } else if (stolen) {
    tone = 'steal'
    name = 'Stolen'
    message = `${guesser?.display_name ?? 'The last imposter'} guessed “${session.salvage_guess}”. It was ${session.revealed_target}.`
  } else if (!civiliansWon) {
    tone = 'steal'
    name = 'Outnumbered'
    message = `The imposters were no longer outnumbered. The player was ${session.revealed_target}.`
  }

  // Leaving has to reach the server now, or the lobby would carry you into the
  // next game as someone who never turns up.
  async function done() {
    await call('leave_session')
    clearIdentity(session.code)
    navigate('/imposter', { replace: true })
  }

  return (
    <Screen status={status} title="Full time" subtitle={`${session.current_round} round${session.current_round === 1 ? '' : 's'}.`}>
      <RevealCard eyebrow="Full time" name={name} tone={tone} message={message} />

      <div className="mt-7">
        <PlayerRoster
          players={players}
          youId={me.id}
          minPlayers={0}
          title="Who was who"
          marks={(p) =>
            p.revealed_role === 'imposter'
              ? [{ tone: 'flag', text: 'Imposter' }]
              : p.revealed_role === 'civilian'
                ? [{ tone: 'neutral', text: 'Civilian' }]
                : []
          }
        />
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="mt-7 grid gap-2">
        {isHost ? (
          <>
            <Button
              size="lg"
              fullWidth
              disabled={busy}
              onClick={() => call('play_again', {}, 'Could not start another game.')}
            >
              {busy ? 'Resetting…' : 'Play again'}
            </Button>
            <p className="mb-1 text-center text-footnote text-text-2">
              Same code, same players, back to the lobby. Everyone comes with you.
            </p>
          </>
        ) : (
          <p className="mb-1 text-center text-footnote text-text-2">
            If {host?.display_name ?? 'the host'} starts another game, you will be
            taken back to the lobby. Stay put.
          </p>
        )}

        <Button variant="secondary" size="lg" fullWidth onClick={done}>
          {isHost ? 'Close this lobby' : 'Leave the lobby'}
        </Button>
        <Button variant="quiet" fullWidth onClick={() => navigate('/')}>
          Back to the binder
        </Button>
      </div>
    </Screen>
  )
}
