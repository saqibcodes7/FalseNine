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
          <p className="text-body text-chalk-1" data-testid="vote-count">
            <span className="display tabular text-[1.4rem] tracking-[0.06em] text-lime engraved">
              {tally.cast} of {active.length}
            </span>{" "}
            have voted.
            {mine &&
              (mine.is_skip
                ? " You skipped."
                : ` You voted for ${players.find((p) => p.id === mine.voted_for_id)?.display_name ?? "someone"}.`)}
          </p>

          {session.votes_visible && tally.cast > 0 && (
            <ul className="mt-4 divide-y divide-ink-3" data-testid="live-votes">
              {tally.lines.map((line) => (
                <li
                  key={line.player.id}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <span className="font-ui text-lead font-semibold text-chalk-0">
                    {line.player.display_name}
                  </span>
                  <span className="text-small text-chalk-1">
                    {line.voters.join(", ")}
                  </span>
                </li>
              ))}
              {tally.skips.length > 0 && (
                <li className="flex items-baseline justify-between gap-3 py-2">
                  <span className="font-ui text-lead font-semibold text-chalk-2">
                    Skip
                  </span>
                  <span className="text-small text-chalk-1">
                    {tally.skips.join(", ")}
                  </span>
                </li>
              )}
            </ul>
          )}
          {!session.votes_visible && (
            <p className="mt-3 text-small text-chalk-2">
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
            voteBy(votes, round, p.id) ? [{ tone: "lime", text: "Voted" }] : []
          }
        />
      </div>

      {me.is_active && (
        <details className="group mt-7">
          <summary className="display cursor-pointer list-none text-center text-[1.1rem] tracking-[0.14em] text-gold engraved">
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
        className="display mt-8 w-full text-[1.05rem] tracking-[0.12em] text-chalk-2 engraved transition-colors hover:text-flag"
      >
        Leave game
      </button>
    </Screen>
  );
}
