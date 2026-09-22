import { useState } from 'react'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import RoleCard from '../../ui/RoleCard'

/*
 * The pass. One player at a time, two taps each: turn the card over, then hand
 * the phone on.
 *
 * The card is face down whenever the phone is changing hands, which is the
 * whole safety mechanism in this mode — there is no server keeping anything
 * from anyone, just a card nobody has turned over yet. So `flipped` resets on
 * every pass, there is no way back to a card you have already seen, and the
 * footballer is never rendered on an imposter's card in the first place.
 */
export default function PassDeal({ game, onPass, onQuit }) {
  const [flipped, setFlipped] = useState(false)
  const number = game.peeking
  const total = game.settings.players
  const role = game.roles[number - 1]
  const last = number >= total

  function pass() {
    setFlipped(false)
    onPass()
  }

  return (
    <Screen
      back="/imposter"
      backLabel="Imposter"
      title={`Player ${number}`}
      subtitle={
        flipped
          ? 'Keep it to yourself. Pass the phone on when you have it.'
          : `Only Player ${number} should be looking at this. Tap the card.`
      }
      status={
        <span className="tabular text-footnote font-semibold text-text-3" data-testid="pass-progress">
          {number} of {total}
        </span>
      }
    >
      <div className="flex flex-col items-center">
        <RoleCard
          flipped={flipped}
          role={role}
          playerName={game.target}
          hint={role === 'imposter' ? game.hint : null}
          onFlip={() => setFlipped((f) => !f)}
        />
      </div>

      <div className="mt-7">
        <Button
          size="lg"
          fullWidth
          disabled={!flipped}
          onClick={pass}
          data-testid="pass-on"
        >
          {last ? "Everyone's seen it" : `Pass to Player ${number + 1}`}
        </Button>
        <p className="mt-2 text-center text-footnote text-text-2">
          {flipped
            ? 'The card turns itself back over before the next person gets it.'
            : 'Turn the card over to carry on.'}
        </p>
      </div>

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
