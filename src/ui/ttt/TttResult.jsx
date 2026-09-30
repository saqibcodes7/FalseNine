import Mark from './Mark'
import { markAccent } from './format'
import { nameOfMark, otherMark } from '../../lib/tttBoard'

/*
 * How the board ended, exactly as the server recorded it: a line, a draw
 * (full board, or no square left with an answer), or a forfeit when someone
 * left mid-board. `children` is whatever can happen next, which depends on
 * the mode and on who is looking.
 */
const REASONS = {
  line: () => 'Three in a row.',
  board_full: () => 'Every square is claimed.',
  no_answers_left: () => 'No empty square has an answer left.',
  forfeit: (game) => `${nameOfMark(game, otherMark(game.winner_mark))} left the game.`,
}

export default function TttResult({ game, youMark = null, children }) {
  const winner = game.winner_mark
  const winnerName = nameOfMark(game, winner)
  const headline = !winner
    ? 'Draw'
    : youMark
      ? winner === youMark
        ? 'You win'
        : `${winnerName} wins`
      : `${winnerName} wins`
  const reason = REASONS[game.end_reason]?.(game) ?? ''

  return (
    <section
      className={`surface ${winner ? markAccent(winner) : 'accent-neutral'} p-5 text-center`}
      style={{ '--tint': '12%' }}
      data-testid="ttt-result"
      data-status={game.status}
      data-reason={game.end_reason}
      data-winner={winner ?? ''}
      aria-live="polite"
    >
      <p className="eyebrow">Board {game.board_number}</p>
      <div className="mt-3 flex items-center justify-center gap-2.5">
        {winner && <Mark mark={winner} className="h-8 w-8" />}
        <h2 className="display text-title1 text-text" data-testid="result-headline">
          {headline}
          {game.end_reason === 'forfeit' ? ' by forfeit' : ''}
        </h2>
      </div>
      {reason && <p className="mt-2 text-subhead text-text-2">{reason}</p>}
      {/* What comes next keeps the app's own gold, whatever the panel's tint. */}
      {children && <div className="accent-gold mt-5 text-left">{children}</div>}
    </section>
  )
}
