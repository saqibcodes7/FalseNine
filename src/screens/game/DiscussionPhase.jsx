import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import TimerDisplay from '../../ui/TimerDisplay'
import PlayerRoster from '../../ui/PlayerRoster'
import { Alert } from '../../ui/Field'
import MyCard from './MyCard'
import { useCountdown } from '../../hooks/useCountdown'
import { activePlayers, phaseRound } from '../../lib/game'

/*
 * Section 5, discussion. One synced clock for the whole table. Anyone still
 * in can press Vote now; when everyone has, the vote opens early. Otherwise
 * the clock runs out and the server opens it.
 */
export default function DiscussionPhase({ session, players, rounds, me, card, loadCard, call, nudge, busy, error, status, clockOffset, leave }) {
  const round = phaseRound(rounds, session, 'discussion')
  const active = activePlayers(players)
  const ready = active.filter((p) => p.vote_ready).length
  const secondsLeft = useCountdown(round?.ends_at, clockOffset, nudge)

  return (
    <Screen
      status={status}
      title={`Round ${session.current_round}`}
      subtitle={
        me.is_active
          ? 'Talk. Ask about the player. Say something only someone who knows would say.'
          : 'You are out. Listen in, keep a straight face.'
      }
    >
      <TimerDisplay label="Discussion" secondsLeft={secondsLeft} total={session.discussion_seconds} />

      {me.is_active && (
        <div className="mt-5">
          <Button
            size="lg"
            fullWidth
            disabled={busy || me.vote_ready}
            onClick={() => call('ready_to_vote', {}, 'Could not mark you ready.')}
          >
            {me.vote_ready ? 'Waiting for the others' : 'Vote now'}
          </Button>
          <p className="mt-2 text-center text-small text-chalk-1" data-testid="ready-count">
            <span className="display tabular text-[1.3rem] tracking-[0.06em] text-lime engraved">
              {ready} of {active.length}
            </span>{' '}
            ready to vote. The vote opens when everyone is, or when the clock runs out.
          </p>
        </div>
      )}

      {error && <Alert>{error}</Alert>}

      <div className="mt-7">
        <PlayerRoster
          players={players}
          youId={me.id}
          minPlayers={0}
          title="The table"
          marks={(p) => (p.vote_ready ? [{ tone: 'lime', text: 'Ready' }] : [])}
        />
      </div>

      {me.is_active && (
        <details className="group mt-7">
          <summary className="display cursor-pointer list-none text-center text-[1.1rem] tracking-[0.14em] text-gold engraved">
            <span className="group-open:hidden">Show my card</span>
            <span className="hidden group-open:inline">Hide my card</span>
          </summary>
          <MyCard card={card} loadCard={loadCard} busy={busy} className="mt-4" />
        </details>
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
