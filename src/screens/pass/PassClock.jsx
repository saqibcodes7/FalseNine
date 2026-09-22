import { useEffect, useRef } from 'react'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import Panel from '../../ui/Panel'
import TimerDisplay from '../../ui/TimerDisplay'
import { useElapsed } from '../../hooks/useCountdown'
import { isUnlimited } from '../../lib/clocks'
import PassTable from './PassTable'

/*
 * The discussion and the vote are the same screen: a clock, who is still in,
 * and one button to move on. The table does the talking and the voting out
 * loud, so the phone's whole job here is to be a clock everyone can see.
 *
 * Either clock can be set to no limit, in which case it counts up instead and
 * the phase ends when somebody presses the button.
 */
export default function PassClock({ game, onAdvance, onQuit }) {
  const voting = game.phase === 'voting'
  const total = voting ? game.settings.votingSeconds : game.settings.discussionSeconds
  const unlimited = isUnlimited(total)

  const elapsed = useElapsed(game.phaseStartedAt)
  const secondsLeft = unlimited ? elapsed : Math.max(0, total - elapsed)
  const expired = !unlimited && secondsLeft === 0

  // A clock that runs out moves the game on by itself. The button is there for
  // a table that has finished early, not for one that has run out of time.
  const fired = useRef(null)
  useEffect(() => {
    if (!expired) return
    const key = `${game.phase}:${game.round}`
    if (fired.current === key) return
    fired.current = key
    onAdvance()
  }, [expired, game.phase, game.round, onAdvance])

  return (
    <Screen
      back="/imposter"
      backLabel="Imposter"
      title={voting ? 'Vote' : 'Discussion'}
      subtitle={
        voting
          ? 'Hands up. Argue about it. The phone is only keeping time.'
          : 'One clue each, round the table. Vague enough to survive, sharp enough to prove you know.'
      }
      status={
        <span className="tabular text-footnote font-semibold text-text-3">
          Round {game.round}
        </span>
      }
    >
      <TimerDisplay
        label={voting ? 'Voting' : 'Discussion'}
        secondsLeft={secondsLeft}
        total={unlimited ? 0 : total}
        countUp={unlimited}
      />

      <div className="mt-7">
        <PassTable game={game} title="Still in" />
      </div>

      <div className="mt-7">
        <Button
          size="lg"
          fullWidth
          variant={expired || unlimited ? 'primary' : 'secondary'}
          onClick={onAdvance}
          data-testid="advance"
        >
          {voting ? "Voting's done" : 'Go to the vote'}
        </Button>
        <p className="mt-2 text-center text-footnote text-text-2">
          {unlimited
            ? 'No clock on this one. Move on whenever the table is ready.'
            : "It moves on by itself when the clock runs out. Press this if you're done early."}
        </p>
      </div>

      {voting && (
        <Panel title="How it works" className="mt-7">
          <p className="text-subhead leading-relaxed text-text-2">
            Vote however you like — a show of hands, a count of three, a shout. When
            the table has settled on somebody, press the button and the phone will ask
            who it was.
          </p>
        </Panel>
      )}

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
