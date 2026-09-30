import Mark from './Mark'
import { markAccent } from './format'
import { MARKS, nameOfMark } from '../../lib/tttBoard'

/*
 * The two players, side by side: mark, name, boards won this match, and whose
 * turn it is. The player to move gets a ring and the words "To play", so the
 * turn never rests on colour either.
 *
 * `youMark` adds "You" to one plate (Online). Pass & Play leaves it out: both
 * players are holding the same device, so neither plate is "you".
 */
export default function TttScoreboard({ game, youMark = null, score }) {
  const showScore = score && score.boards > 0
  return (
    <div className="grid grid-cols-2 gap-2.5" data-testid="scoreboard">
      {MARKS.map((mark) => {
        const toPlay = game.status === 'playing' && game.turn_mark === mark
        return (
          <div
            key={mark}
            data-testid={`plate-${mark}`}
            data-to-play={toPlay ? '' : undefined}
            className={[
              'surface flex min-w-0 items-center gap-2 px-2.5 py-2.5 sm:gap-2.5 sm:px-3',
              markAccent(mark),
              toPlay ? 'shadow-[inset_0_0_0_1.5px_var(--accent),0_8px_24px_-12px_var(--accent)]' : '',
            ].join(' ')}
            style={toPlay ? { '--tint': '14%' } : undefined}
          >
            <Mark mark={mark} className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" />
            <span className="min-w-0 flex-1">
              <span className="sr-only">{mark}: </span>
              <span className="block truncate text-callout font-semibold text-text" data-testid={`name-${mark}`}>
                {nameOfMark(game, mark)}
              </span>
              <span className="mt-0.5 block truncate text-caption whitespace-nowrap">
                {toPlay ? <span className="font-semibold text-gold">To play</span> : <span className="text-text-3">{mark}</span>}
                {youMark === mark && <span className="font-semibold text-text-2"> · You</span>}
              </span>
            </span>
            {showScore && (
              <span className="tabular shrink-0 text-title3 font-bold text-text" aria-label={`${score[mark]} boards won`}>
                {score[mark]}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
