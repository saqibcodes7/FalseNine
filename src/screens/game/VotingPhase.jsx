import Screen from "../../ui/Screen";
import Panel from "../../ui/Panel";
import Chip from "../../ui/Chip";
import TimerDisplay from "../../ui/TimerDisplay";
import PlayerRoster from "../../ui/PlayerRoster";
import VoteSheet from "../../ui/VoteSheet";
import MyCard from "./MyCard";
import { useCountdown } from "../../hooks/useCountdown";
import { activePlayers, phaseRound, voteBy, tallyView } from "../../lib/game";

/*
 * Section 5, voting. One vote each, for another player still in or a skip.
 * The count of votes cast is always shown; who voted for whom only if the
 * host turned that on. The server closes the vote the moment the result
 * cannot change, or when the clock runs out.
 */
export default function VotingPhase({
  session,
  players,
  rounds,
  votes,
  me,
  card,
  loadCard,
  call,
  nudge,
  busy,
  error,
  status,
  clockOffset,
  leave,
}) {
  const round = phaseRound(rounds, session, "voting");
  const active = activePlayers(players);
  const mine = voteBy(votes, round, me.id);
  const tally = tallyView(votes, round, players);
  const secondsLeft = useCountdown(round?.ends_at, clockOffset, nudge);
  const canVote = me.is_active && !mine;

  return (
    <Screen
      status={status}
      title={`Round ${session.current_round}`}
      subtitle={
        canVote ? "One vote. No changing your mind." : "Votes are coming in."
      }
    >
      <TimerDisplay
        label="Voting"
        secondsLeft={secondsLeft}
        total={session.voting_seconds}
      />

      {canVote && (
        <div className="mt-6">
          <VoteSheet
            candidates={active}
            youId={me.id}
            busy={busy}
            error={error}
            onCast={(player) =>
              call(
                "cast_vote",
                { p_voted_for_id: player.id, p_is_skip: false },
                "Could not cast your vote.",
              )
            }
            onSkip={() =>
              call(
                "cast_vote",
                { p_voted_for_id: null, p_is_skip: true },
                "Could not cast your vote.",
              )
            }
          />
        </div>
      )}

      <div className="mt-6">
        <Panel title={mine ? "Your vote is in" : "The vote so far"}>
          <p className="text-body text-text-2" data-testid="vote-count">
            <span className="tabular font-semibold text-gold">
              {tally.cast} of {active.length}
            </span>{" "}
            have voted.
            {mine &&
              (mine.is_skip
                ? " You skipped."
                : ` You voted for ${players.find((p) => p.id === mine.voted_for_id)?.display_name ?? "someone"}.`)}
          </p>

          {session.votes_visible && tally.cast > 0 && (
            <ul className="mt-4 divide-hairline" data-testid="live-votes">
              {tally.lines.map((line) => (
                <li
                  key={line.player.id}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <span className="font-ui text-callout font-semibold text-text">
                    {line.player.display_name}
                  </span>
                  <span className="text-footnote text-text-2">
                    {line.voters.join(", ")}
                  </span>
                </li>
              ))}
              {tally.skips.length > 0 && (
                <li className="flex items-baseline justify-between gap-3 py-2">
                  <span className="font-ui text-callout font-semibold text-text-3">
                    Skip
                  </span>
                  <span className="text-footnote text-text-2">
                    {tally.skips.join(", ")}
                  </span>
                </li>
              )}
            </ul>
          )}
          {!session.votes_visible && (
            <p className="mt-3 text-footnote text-text-3">
              Who voted for whom comes out at the reveal.
            </p>
          )}
        </Panel>
      </div>

      <div className="mt-7">
        <PlayerRoster
          players={players}
          youId={me.id}
          minPlayers={0}
          title="The table"
          marks={(p) =>
            voteBy(votes, round, p.id) ? [{ tone: 'go', text: 'Voted' }] : []
          }
        />
      </div>

      {me.is_active && (
        <details className="group mt-7">
          <summary className="mx-auto flex h-11 w-fit cursor-pointer list-none items-center px-4 text-subhead font-semibold text-gold">
            <span className="group-open:hidden">Show my card</span>
            <span className="hidden group-open:inline">Hide my card</span>
          </summary>
          <MyCard
            card={card}
            loadCard={loadCard}
            busy={busy}
            className="mt-4"
          />
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
  );
}
