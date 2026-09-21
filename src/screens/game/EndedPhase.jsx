import { useNavigate } from 'react-router-dom'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import RevealCard from '../../ui/RevealCard'
import PlayerRoster from '../../ui/PlayerRoster'
import { clearIdentity } from '../../lib/identity'

/*
 * Full time. Who won, how, and the footballer everyone was talking about.
 * Every role is public now, so the roster shows them all.
 */
export default function EndedPhase({ session, players, me, isHost, status }) {
  const navigate = useNavigate()
  const guesser = players.find((p) => p.id === session.salvage_player_id) ?? null
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

  function done() {
    clearIdentity(session.code)
    navigate(isHost ? '/imposter/create' : '/imposter', { replace: true })
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

      <div className="mt-7 grid gap-2">
        <Button size="lg" fullWidth onClick={done}>
          {isHost ? 'Set up another game' : 'Back to Football Imposter'}
        </Button>
        <Button variant="quiet" fullWidth onClick={() => navigate('/')}>
          Back to the binder
        </Button>
      </div>
    </Screen>
  )
}
