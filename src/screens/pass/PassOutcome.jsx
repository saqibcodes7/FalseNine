import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import Panel from '../../ui/Panel'
import RevealCard from '../../ui/RevealCard'
import PassTable from './PassTable'
import { imposterFoundMessage } from '../../lib/game'
import { stillIn, roleOf, impostersLeft, canPlayAnotherRound } from '../../lib/passplay'

/*
 * Who the table voted out, and what they were.
 *
 * Two screens in one: first a grid of everyone still in, to record the table's
 * decision, then the card that turns that person over. The phone is not
 * refereeing — it does not declare a winner — but it does tell you how many
 * imposters are left, because it dealt them and the table has just earned
 * that information.
 */
export default function PassOutcome({ game, onVoteOut, onSkip, onNextRound, onFinish, onQuit }) {
  const decided = game.lastOut !== null || game.skipped === true
  const remaining = impostersLeft(game)

  // ---- still choosing ----------------------------------------------------
  if (!decided) {
    return (
      <Screen
        back="/imposter"
        backLabel="Imposter"
        title="Who went out?"
        subtitle="Tap whoever the table voted for. Their card turns over for everyone."
        status={
          <span className="tabular text-footnote font-semibold text-text-3">
            Round {game.round}
          </span>
        }
      >
        <Panel title="Still in" bodyClassName="p-3">
          <ul className="grid grid-cols-3 gap-2" role="list">
            {stillIn(game).map((n) => (
              <li key={n}>
                <button
                  type="button"
                  onClick={() => onVoteOut(n)}
                  data-testid={`vote-${n}`}
                  className="pressable fill-soft grid h-[4.5rem] w-full place-items-center rounded-[18px]"
                >
                  <span className="text-caption text-text-3">Player</span>
                  <span className="tabular text-title2 font-bold text-text">{n}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Button variant="quiet" fullWidth className="mt-6" onClick={onSkip}>
          Nobody could agree
        </Button>

      <button
        type="button"
        onClick={onQuit}
        className="pressable mt-8 h-11 w-full text-subhead font-semibold text-text-3 transition-colors hover:text-flag"
      >
        End this game
      </button>
      </Screen>
    )
  }

  // ---- the table could not agree ----------------------------------------
  if (game.skipped) {
    return (
      <Screen
        back="/imposter"
        backLabel="Imposter"
        title="Nobody out"
        subtitle="No decision, no elimination. Back round for another go."
      >
        <RevealCard
          eyebrow={`Round ${game.round}`}
          name="Deadlock"
          tone="civilian"
          chipText="Nobody out"
          message="Nobody was voted out, so everybody is still in and the imposters are still at the table."
        />

        <div className="mt-7">
          <PassTable game={game} title="Still in" />
        </div>

        <div className="mt-7 grid gap-2">
          <Button size="lg" fullWidth onClick={onNextRound}>
            Start round {game.round + 1}
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={onFinish}>
            Call it here and show everything
          </Button>
        </div>
      </Screen>
    )
  }

  // ---- somebody is out ---------------------------------------------------
  const number = game.lastOut
  const name = `Player ${number}`
  const wasImposter = roleOf(game, number) === 'imposter'
  const another = canPlayAnotherRound(game)

  const message = wasImposter
    ? imposterFoundMessage(name, remaining)
    : `${name} was a civilian. ${remaining === 1 ? 'The imposter is' : 'The imposters are'} still at the table.`

  return (
    <Screen
      back="/imposter"
      backLabel="Imposter"
      title="Voted out"
      subtitle={`Round ${game.round} is over.`}
    >
      <RevealCard
        eyebrow="Voted out"
        name={name}
        tone={wasImposter ? 'imposter' : 'civilian'}
        message={message}
      />

      <div className="mt-7">
        <PassTable game={game} title="The table" />
      </div>

      <div className="mt-7 grid gap-2">
        {another && (
          <Button
            size="lg"
            fullWidth
            variant={remaining === 0 ? 'secondary' : 'primary'}
            onClick={onNextRound}
          >
            Start round {game.round + 1}
          </Button>
        )}
        <Button
          size="lg"
          fullWidth
          variant={remaining === 0 || !another ? 'primary' : 'secondary'}
          onClick={onFinish}
          data-testid="finish"
        >
          Finish and show everything
        </Button>
      </div>

      <p className="mt-3 text-center text-footnote text-text-2">
        {remaining === 0
          ? 'That was the last imposter. Give them a chance to name the footballer before you finish, if you like.'
          : another
            ? 'Keep going, or stop here and turn every card over.'
            : 'Too few left for another round.'}
      </p>
    </Screen>
  )
}
