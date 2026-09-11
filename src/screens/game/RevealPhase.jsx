import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import Panel from '../../ui/Panel'
import RevealCard from '../../ui/RevealCard'
import PlayerRoster from '../../ui/PlayerRoster'
import { Alert } from '../../ui/Field'
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
 * the host chose for the voting phase. The host moves the game on.
 */
export default function RevealPhase({ session, players, rounds, votes, me, isHost, call, busy, error, status, leave }) {
  const out = eliminatedThisRound(rounds, session, players)
  const remaining = impostersRemaining(session, players)
  const next = nextAfterReveal(session, players)
  const tally = tallyView(votes, votingRound(rounds, session), players)
  const wasImposter = out?.revealed_role === 'imposter'

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
          <ul className="divide-y divide-ink-3" data-testid="vote-breakdown">
            {tally.lines.map((line) => (
              <li key={line.player.id} className="flex items-baseline justify-between gap-3 py-2 first:pt-0">
                <span className="font-ui text-lead font-semibold text-chalk-0">
                  {line.player.display_name}
                  <span className="display ml-2 text-[1.1rem] tracking-[0.06em] text-gold engraved">
                    {line.count}
                  </span>
                </span>
                <span className="text-right text-small text-chalk-1">{line.voters.join(', ')}</span>
              </li>
            ))}
            {tally.skips.length > 0 && (
              <li className="flex items-baseline justify-between gap-3 py-2">
                <span className="font-ui text-lead font-semibold text-chalk-2">
                  Skipped
                  <span className="display ml-2 text-[1.1rem] tracking-[0.06em] text-gold engraved">
                    {tally.skips.length}
                  </span>
                </span>
                <span className="text-right text-small text-chalk-1">{tally.skips.join(', ')}</span>
              </li>
            )}
          </ul>
        </Panel>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="mt-6">
        {isHost ? (
          <>
            <Button size="lg" fullWidth disabled={busy} onClick={() => call('continue_round', {}, 'Could not move the game on.')}>
              {continueLabel}
            </Button>
            <p className="mt-2 text-center text-small text-chalk-1">{nextNote}</p>
          </>
        ) : (
          <p className="text-center text-small text-chalk-1">
            {nextNote} Waiting for the host to carry on.
          </p>
        )}
      </div>

      <div className="mt-7">
        <PlayerRoster players={players} youId={me.id} minPlayers={0} title="The table" />
      </div>

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
