import { useState } from 'react'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import RoleCard from '../../ui/RoleCard'
import PlayerRoster from '../../ui/PlayerRoster'
import { Alert } from '../../ui/Field'
import { activePlayers } from '../../lib/game'

/*
 * Section 5, peeking. Everyone gets a face-down card. The first tap asks the
 * server for it, which is also what marks you as having peeked; when the last
 * active player has looked, the discussion starts on its own. The host can
 * call it early if someone has wandered off.
 */
export default function PeekPhase({ session, players, me, isHost, card, loadCard, call, busy, error, status, leave }) {
  const [flipped, setFlipped] = useState(false)
  const active = activePlayers(players)
  const seen = active.filter((p) => p.has_peeked).length

  async function onFlip() {
    if (flipped) return setFlipped(false)
    const row = card ?? (await loadCard())
    if (row) setFlipped(true)
  }

  return (
    <Screen
      status={status}
      title="Your card"
      subtitle={
        me.is_active
          ? 'Tap it, read it, keep it to yourself. Tap again to turn it back over.'
          : 'You are out of this one, but you can still watch.'
      }
    >
      <div className="flex flex-col items-center">
        {me.is_active ? (
          <RoleCard
            flipped={flipped && Boolean(card)}
            role={card?.role ?? 'civilian'}
            playerName={card?.target_name ?? ''}
            hint={card?.hint_text ?? null}
            onFlip={busy ? undefined : onFlip}
          />
        ) : null}

        <p className="mt-5 text-center text-small text-chalk-1" data-testid="peek-count">
          <span className="display tabular text-[1.4rem] tracking-[0.06em] text-lime engraved">
            {seen} of {active.length}
          </span>{' '}
          have looked
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="mt-7">
        <PlayerRoster
          players={players}
          youId={me.id}
          minPlayers={0}
          title={`Round ${session.current_round}`}
          marks={(p) => (p.has_peeked ? [{ tone: 'lime', text: 'Seen' }] : [])}
        />
      </div>

      {isHost && (
        <div className="mt-6">
          <Button
            size="lg"
            fullWidth
            variant={seen === active.length ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => call('advance_peeking', {}, 'Could not start the discussion.')}
          >
            Start the discussion
          </Button>
          <p className="mt-2 text-center text-small text-chalk-2">
            It starts by itself once everyone has looked.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={leave}
        className="display mt-8 w-full text-[1.05rem] tracking-[0.12em] text-chalk-2 engraved transition-colors hover:text-flag"
      >
        Leave game
      </button>
    </Screen>
  )
}
