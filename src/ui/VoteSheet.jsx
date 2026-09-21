import { useState } from 'react'
import Panel from './Panel'
import Button from './Button'
import Chip from './Chip'
import { Alert } from './Field'

/*
 * The ballot. Every player still in is a row; tap one and its circle fills.
 * Skip is its own honest button rather than a hidden fallback, and the cast
 * button names who it is for before you press it, because a vote is final.
 */
function Tick({ on }) {
  return (
    <span
      aria-hidden="true"
      className={[
        'grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors duration-[var(--dur-state)]',
        on ? 'fill-accent' : 'border border-white/20',
      ].join(' ')}
    >
      {on && (
        <svg viewBox="0 0 14 14" className="h-[11px] w-[11px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 7.5 5.4 11 12 3.5" />
        </svg>
      )}
    </span>
  )
}

export default function VoteSheet({ candidates, youId, onCast, onSkip, busy = false, error = null }) {
  const [picked, setPicked] = useState(null)
  const chosen = candidates.find((c) => c.id === picked) ?? null

  return (
    <Panel title="Who is the imposter?" accent="accent-gold" bodyClassName="p-0">
      <ul className="divide-hairline" role="list">
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
                className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:cursor-default"
              >
                <Tick on={selected} />
                <span
                  className={`min-w-0 flex-1 truncate text-callout font-semibold ${
                    isYou ? 'text-text-3' : selected ? 'text-gold' : 'text-text'
                  }`}
                >
                  {player.display_name}
                </span>
                {isYou && <Chip tone="neutral">You</Chip>}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="grid gap-2 p-4 pt-3.5">
        <Button size="lg" fullWidth disabled={!chosen || busy} onClick={() => chosen && onCast(chosen)}>
          {chosen ? `Vote out ${chosen.display_name}` : 'Pick a player'}
        </Button>
        <Button variant="secondary" fullWidth disabled={busy} onClick={onSkip}>
          Skip this vote
        </Button>
        {error && <Alert>{error}</Alert>}
      </div>
    </Panel>
  )
}
