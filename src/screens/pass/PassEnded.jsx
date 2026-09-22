import { useNavigate } from 'react-router-dom'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import RevealCard from '../../ui/RevealCard'
import PassTable from './PassTable'
import { impostersLeft } from '../../lib/passplay'

/*
 * Every card face up: the footballer, and who was lying about knowing him.
 *
 * There is no "civilians win" banner here on purpose. The phone dealt the
 * cards and kept the time; who won is for the table to settle, and this screen
 * gives them everything they need to settle it.
 */
export default function PassEnded({ game, onAgain, onNewSetup }) {
  const navigate = useNavigate()
  const imposters = game.roles
    .map((role, i) => (role === 'imposter' ? i + 1 : null))
    .filter(Boolean)
  const caught = imposters.filter((n) => game.out.includes(n))
  const remaining = impostersLeft(game)

  const message =
    remaining === 0
      ? `Every imposter was found. ${imposters.length === 1 ? 'It was' : 'They were'} ${imposters.map((n) => `Player ${n}`).join(' and ')}.`
      : `${caught.length} of ${imposters.length} found. ${imposters
          .map((n) => `Player ${n}`)
          .join(' and ')} ${imposters.length === 1 ? 'was the imposter' : 'were the imposters'}.`

  return (
    <Screen
      back="/imposter"
      backLabel="Imposter"
      title="Cards on the table"
      subtitle={`${game.round} round${game.round === 1 ? '' : 's'}.`}
    >
      <RevealCard
        eyebrow="The footballer"
        name={game.target}
        tone="answer"
        chipText={`${game.settings.players} players, ${imposters.length} imposter${imposters.length === 1 ? '' : 's'}`}
        message={message}
      />

      <div className="mt-7">
        <PassTable game={game} title="Who was who" reveal />
      </div>

      <div className="mt-7 grid gap-2">
        <Button size="lg" fullWidth onClick={onAgain} data-testid="deal-again">
          Deal again
        </Button>
        <p className="mb-1 text-center text-footnote text-text-2">
          Same table, same settings, a new footballer.
        </p>

        <Button variant="secondary" size="lg" fullWidth onClick={onNewSetup}>
          Change the setup
        </Button>
        <Button variant="quiet" fullWidth onClick={() => navigate('/imposter')}>
          Back to Football Imposter
        </Button>
      </div>
    </Screen>
  )
}
