import { useState } from 'react'
import Panel from './Panel'
import Button from './Button'
import Chip from './Chip'
import { Alert } from './Field'

/*
 * The ballot. Every player still in the game is a row; tap one to pick it
 * (the brass disc fills in, the way the pack picker does), then cast. Skip
 * is its own honest button, never a hidden fallback. A vote is final, so the
 * cast button names who it is for before it is pressed.
 */
export default function VoteSheet({
  candidates,
  youId,
  onCast,
  onSkip,
  busy = false,
  error = null,
}) {
  const [picked, setPicked] = useState(null)
  const chosen = candidates.find((c) => c.id === picked) ?? null

  return (
    <Panel title="Who is the imposter?">
      <ul className="divide-y divide-ink-3" role="list">
        {candidates.map((player) => {
          const selected = player.id === picked
          const isYou = player.id === youId
          return (
            <li key={player.id}>
              <button
                type="button"
                disabled={isYou || busy}
                aria-pressed={selected}
                onClick={() => setPicked(selected ? null : player.id)}
                className="group flex w-full items-center gap-3 py-2.5 text-left first:pt-1 last:pb-1 disabled:cursor-default"
              >
                <span
                  aria-hidden="true"
                  className={
                    selected
                      ? 'disc metal-gold shrink-0 text-[1rem]'
                      : `inline-block h-8 w-8 shrink-0 rounded-full border border-dashed ${
                          isYou ? 'border-ink-3' : 'border-ink-4 group-hover:border-gold-lo'
                        }`
                  }
                >
                  {selected ? '✓' : ''}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate font-ui text-lead font-semibold ${
                    isYou ? 'text-chalk-2' : selected ? 'text-gold-hi' : 'text-chalk-0'
                  }`}
                >
                  {player.display_name}
                </span>
                {isYou && <Chip tone="steel">You</Chip>}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="hairline metal-steel my-4" aria-hidden="true" />

      <div className="grid gap-2">
        <Button size="lg" fullWidth disabled={!chosen || busy} onClick={() => chosen && onCast(chosen)}>
          {chosen ? `Vote out ${chosen.display_name}` : 'Pick a player'}
        </Button>
        <Button variant="secondary" fullWidth disabled={busy} onClick={onSkip}>
          Skip this vote
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}
    </Panel>
  )
}
