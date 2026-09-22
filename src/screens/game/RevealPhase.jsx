import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import Panel from '../../ui/Panel'
import RevealCard from '../../ui/RevealCard'
import PlayerRoster from '../../ui/PlayerRoster'
import { Alert } from '../../ui/Field'
import { useCountdown } from '../../hooks/useCountdown'
import {
  eliminatedThisRound,
  impostersRemaining,
  imposterFoundMessage,
  nextAfterReveal,
  tallyView,
  votingRound,
} from '../../lib/game'

/*
 * Section 5, reveal. Who went out and what they were, in the brief's exact
 * words when it was an imposter. The vote breakdown is public here whatever
 * the host chose for the voting phase.
 *
 * The host moves the game on, with one exception: when the player just voted
 * out was the last imposter, the server puts a clock on this screen and the
 * salvage guess opens by itself. Being caught is what earns that guess, so it
 * is not the host's to withhold. The host can still go early.
 */
export default function RevealPhase({ session, players, rounds, votes, me, isHost, call, nudge, clockOffset, busy, error, status, leave }) {
  const out = eliminatedThisRound(rounds, session, players)
  const remaining = impostersRemaining(session, players)
  const next = nextAfterReveal(session, players)
  const tally = tallyView(votes, votingRound(rounds, session), players)
  const wasImposter = out?.revealed_role === 'imposter'

  // Only armed for the last-imposter-out case; null the rest of the time.
  const secondsLeft = useCountdown(session.reveal_ends_at, clockOffset, nudge)
  const counting = Boolean(session.reveal_ends_at)

  const message = !out
    ? ''
    : wasImposter
      ? imposterFoundMessage(out.display_name, remaining)
      : `${out.display_name} was a civilian. ${remaining === 1 ? 'The imposter is' : 'The imposters are'} still at the table.`

  const continueLabel = {
    discussion: `Start round ${session.current_round + 1}`,
    salvage: 'Give them their last chance',
    'imposters-win': 'See the result',
  }[next]

  const nextNote = {
    discussion: 'Another discussion, another vote.',
    salvage: `That was the last imposter. ${out?.display_name ?? 'They'} get one guess at the footballer to steal the win.`,
    'imposters-win': 'The imposters are no longer outnumbered.',
  }[next]

  return (
    <Screen status={status} title="Voted out" subtitle={`Round ${session.current_round} is over.`}>
      {out && (
        <RevealCard
          eyebrow="Voted out"
          name={out.display_name}
          tone={wasImposter ? 'imposter' : 'civilian'}
          message={message}
        />
      )}

      <div className="mt-6">
        <Panel title="How the vote went">
          <ul className="divide-hairline" data-testid="vote-breakdown">
            {tally.lines.map((line) => (
              <li key={line.player.id} className="flex items-baseline justify-between gap-3 py-2 first:pt-0">
                <span className="font-ui text-callout font-semibold text-text">
                  {line.player.display_name}
                  <span className="tabular ml-2 text-callout font-bold text-gold">
                    {line.count}
                  </span>
                </span>
                <span className="text-right text-footnote text-text-2">{line.voters.join(', ')}</span>
              </li>
            ))}
            {tally.skips.length > 0 && (
              <li className="flex items-baseline justify-between gap-3 py-2">
                <span className="font-ui text-callout font-semibold text-text-3">
                  Skipped
                  <span className="tabular ml-2 text-callout font-bold text-gold">
                    {tally.skips.length}
                  </span>
                </span>
                <span className="text-right text-footnote text-text-2">{tally.skips.join(', ')}</span>
              </li>
            )}
          </ul>
        </Panel>
      </div>

      {error && <Alert>{error}</Alert>}

      {counting && (
        <p
          className={`mt-6 text-center text-footnote text-text-2 ${secondsLeft <= 3 ? 'urgent' : ''}`}
          data-testid="reveal-countdown"
          aria-live="polite"
        >
          Last chance for {out?.display_name ?? 'the imposter'} in{' '}
          <span className="tabular font-semibold text-gold">{secondsLeft}</span>
        </p>
      )}

      <div className="mt-6">
        {isHost ? (
          <>
            <Button
              size="lg"
              fullWidth
              variant={counting ? 'secondary' : 'primary'}
              disabled={busy}
              onClick={() => call('continue_round', {}, 'Could not move the game on.')}
            >
              {counting ? 'Skip the wait' : continueLabel}
            </Button>
            <p className="mt-2 text-center text-footnote text-text-2">
              {counting ? 'It happens by itself when the clock runs out.' : nextNote}
            </p>
          </>
        ) : (
          <p className="text-center text-footnote text-text-2">
            {counting ? nextNote : `${nextNote} Waiting for the host to carry on.`}
          </p>
        )}
      </div>

      <div className="mt-7">
        <PlayerRoster players={players} youId={me.id} minPlayers={0} title="The table" />
      </div>

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
