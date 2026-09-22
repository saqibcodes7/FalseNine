import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import TimerDisplay from '../../ui/TimerDisplay'
import PlayerRoster from '../../ui/PlayerRoster'
import { Alert } from '../../ui/Field'
import MyCard from './MyCard'
import { useCountdown, useElapsed } from '../../hooks/useCountdown'
import { activePlayers, phaseRound } from '../../lib/game'
import { isUnlimited } from '../../lib/clocks'

/*
 * Section 5, discussion. One synced clock for the whole table. Anyone still
 * in can press Vote now; when everyone has, the vote opens early. Otherwise
 * the clock runs out and the server opens it.
 *
 * With the clock set to no limit there is no deadline to run out, so the
 * figures count up instead and the host gets a button. That button is the only
 * way out if somebody has put their phone down: without it, one quiet player
 * could hold the table up all night.
 */
export default function DiscussionPhase({ session, players, rounds, me, isHost, card, loadCard, call, nudge, busy, error, status, clockOffset, leave }) {
  const round = phaseRound(rounds, session, 'discussion')
  const active = activePlayers(players)
  const ready = active.filter((p) => p.vote_ready).length
  const unlimited = isUnlimited(session.discussion_seconds)
  const secondsLeft = useCountdown(unlimited ? null : round?.ends_at, clockOffset, nudge)
  const elapsed = useElapsed(unlimited ? round?.started_at : null, clockOffset)

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
      <TimerDisplay
        label="Discussion"
        secondsLeft={unlimited ? elapsed : secondsLeft}
        total={unlimited ? 0 : session.discussion_seconds}
        countUp={unlimited}
      />

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
          <p className="mt-2 text-center text-footnote text-text-2" data-testid="ready-count">
            <span className="tabular font-semibold text-gold">
              {ready} of {active.length}
            </span>{' '}
            ready to vote. The vote opens when everyone is{unlimited ? '.' : ', or when the clock runs out.'}
          </p>
        </div>
      )}

      {unlimited && isHost && (
        <div className="mt-5">
          <Button
            size="lg"
            variant="secondary"
            fullWidth
            disabled={busy}
            onClick={() => call('host_advance', {}, 'Could not open the vote.')}
          >
            Open the vote
          </Button>
          <p className="mt-2 text-center text-footnote text-text-3">
            No clock on this one, so it is yours to call when the table has said enough.
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
          marks={(p) => (p.vote_ready ? [{ tone: 'go', text: 'Ready' }] : [])}
        />
      </div>

      {me.is_active && (
        <details className="group mt-7">
          <summary className="mx-auto flex h-11 w-fit cursor-pointer list-none items-center px-4 text-subhead font-semibold text-gold">
            <span className="group-open:hidden">Show my card</span>
            <span className="hidden group-open:inline">Hide my card</span>
          </summary>
          <MyCard card={card} loadCard={loadCard} busy={busy} className="mt-4" />
        </details>
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
