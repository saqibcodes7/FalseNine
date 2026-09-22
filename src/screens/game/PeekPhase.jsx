import { useState } from 'react'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import RoleCard from '../../ui/RoleCard'
import PlayerRoster from '../../ui/PlayerRoster'
import { Alert } from '../../ui/Field'
import { activePlayers } from '../../lib/game'
import { useCountdown } from '../../hooks/useCountdown'

/*
 * Section 5, peeking. Everyone gets a face-down card. The first tap asks the
 * server for it, which is also what marks you as having peeked.
 *
 * When the last active player looks, the server does NOT start the discussion
 * there and then — that used to snatch the card away from whoever tapped last,
 * because their peek and the kick-off were the same round trip. It sets a
 * deadline instead (sessions.peek_ends_at), the table watches it run down
 * together, and the discussion opens when it passes. Nobody has to press
 * anything. The host can still cut it short.
 */
export default function PeekPhase({
  session,
  players,
  me,
  isHost,
  card,
  loadCard,
  call,
  nudge,
  clockOffset,
  busy,
  error,
  status,
  leave,
}) {
  const [flipped, setFlipped] = useState(false)
  const active = activePlayers(players)
  const seen = active.filter((p) => p.has_peeked).length
  const everyoneSeen = seen === active.length

  // Only counts once the server has armed it. Reaching zero nudges tick(),
  // which is what actually opens the discussion.
  const secondsLeft = useCountdown(session.peek_ends_at, clockOffset, nudge)
  const counting = Boolean(session.peek_ends_at)

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

        {counting ? (
          <p
            className={`mt-5 text-center text-footnote text-text-2 ${secondsLeft <= 3 ? 'urgent' : ''}`}
            data-testid="peek-countdown"
            aria-live="polite"
          >
            Discussion starts in{' '}
            <span className="tabular font-semibold text-gold">{secondsLeft}</span>
          </p>
        ) : (
          <p className="mt-5 text-center text-footnote text-text-2" data-testid="peek-count">
            <span className="tabular font-semibold text-gold">
              {seen} of {active.length}
            </span>{' '}
            have looked
          </p>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="mt-7">
        <PlayerRoster
          players={players}
          youId={me.id}
          minPlayers={0}
          title={`Round ${session.current_round}`}
          marks={(p) => (p.has_peeked ? [{ tone: 'go', text: 'Seen' }] : [])}
        />
      </div>

      {isHost && (
        <div className="mt-6">
          <Button
            size="lg"
            fullWidth
            variant={everyoneSeen ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => call('advance_peeking', {}, 'Could not start the discussion.')}
          >
            {counting ? 'Start now' : 'Start the discussion'}
          </Button>
          <p className="mt-2 text-center text-footnote text-text-3">
            {counting
              ? 'It starts by itself when the clock runs out.'
              : 'It starts by itself a few seconds after everyone has looked.'}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={leave}
        className="pressable mt-8 h-11 w-full text-subhead font-semibold text-text-3 transition-colors hover:text-flag"
      >
        Leave game
      </button>
    </Screen>
  )
}
