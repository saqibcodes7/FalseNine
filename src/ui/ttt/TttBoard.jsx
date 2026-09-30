import { Fragment } from 'react'
import Mark from './Mark'
import { CriterionIcon } from './criteria'
import { criterionCaption, criterionSentence, markAccent } from './format'

/*
 * The board: three columns across the top, three rows down the side, nine
 * squares where they meet. The same board serves Online and Pass & Play.
 *
 * Columns sit on a teal rule beneath them and rows on a teal rule beside
 * them, so which way a label runs is never in doubt, and every square's
 * accessible name spells out both of its criteria in full.
 *
 * A claimed square shows its mark and the footballer who took it. The mark is
 * a shape, X or O, so ownership never rests on colour. Squares on the winning
 * line (the one the server named) get a ring.
 *
 * `interactive` is false whenever the person looking at it cannot move: not
 * their turn, board over, or waiting for the next player to take the device.
 */
export default function TttBoard({ axes, cells, selectedCell = null, winning = [], interactive = false, onSelect }) {
  const onLine = new Set(winning)

  return (
    <div
      role="group"
      aria-label="Board"
      data-testid="ttt-board"
      className="grid gap-1.5 sm:gap-2"
      style={{ gridTemplateColumns: 'minmax(4.5rem, 0.82fr) repeat(3, minmax(0, 1fr))' }}
    >
      <div aria-hidden="true" />
      {axes.cols.map((axis) => (
        <AxisHeader key={`col-${axis.position}`} axis={axis} kind="col" />
      ))}

      {axes.rows.map((rowAxis) => (
        <Fragment key={`row-${rowAxis.position}`}>
          <AxisHeader axis={rowAxis} kind="row" />
          {axes.cols.map((colAxis) => {
            const cell = rowAxis.position * 3 + colAxis.position
            return (
              <Cell
                key={cell}
                index={cell}
                rowAxis={rowAxis}
                colAxis={colAxis}
                claim={cells[cell]}
                selected={selectedCell === cell}
                winning={onLine.has(cell)}
                interactive={interactive}
                onSelect={onSelect}
              />
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}

function AxisHeader({ axis, kind }) {
  const col = kind === 'col'
  return (
    <div
      data-testid={`axis-${kind}`}
      data-label={axis.label}
      title={criterionSentence(axis)}
      className={[
        'flex min-w-0 flex-col',
        col
          ? 'items-center justify-end border-b-2 border-teal/45 px-0.5 pb-1.5 text-center'
          : 'justify-center border-r-2 border-teal/45 py-1 pr-2',
      ].join(' ')}
    >
      <span className="mb-1 inline-flex items-center gap-1 text-caption2 font-semibold uppercase tracking-[0.1em] text-text-3">
        <CriterionIcon type={axis.category_type} className="h-3 w-3 shrink-0" />
        {criterionCaption(axis)}
      </span>
      <span className="line-clamp-3 text-caption leading-tight font-semibold break-words text-text [hyphens:auto] sm:text-footnote">
        {axis.label}
      </span>
    </div>
  )
}

function Cell({ index, rowAxis, colAxis, claim, selected, winning, interactive, onSelect }) {
  const where = `${criterionSentence(rowAxis)}, and ${criterionSentence(colAxis)}`

  if (claim) {
    return (
      <div
        role="img"
        aria-label={`${where}. Claimed by ${claim.mark} with ${claim.footballer}.${winning ? ' Part of the winning line.' : ''}`}
        data-testid="cell"
        data-cell={index}
        data-mark={claim.mark}
        data-winning={winning ? '' : undefined}
        className={[
          markAccent(claim.mark),
          'fill-tinted relative flex aspect-square min-w-0 flex-col items-center justify-center gap-1 rounded-[14px] p-1.5',
          winning ? 'shadow-[inset_0_0_0_2px_var(--accent),0_0_22px_-6px_var(--accent)]' : '',
        ].join(' ')}
      >
        <Mark mark={claim.mark} className="h-[32%] w-[32%] shrink-0" />
        <span className="line-clamp-2 w-full text-center text-caption2 leading-tight font-semibold break-words text-text sm:text-caption">
          {claim.footballer}
        </span>
      </div>
    )
  }

  return (
    <button
      type="button"
      disabled={!interactive}
      aria-pressed={interactive ? selected : undefined}
      aria-label={`${where}. Empty square.`}
      data-testid="cell"
      data-cell={index}
      onClick={() => onSelect?.(index)}
      className={[
        'surface-sunken group pressable grid aspect-square min-w-0 place-items-center rounded-[14px]',
        'transition-[box-shadow,background-color] duration-[var(--dur-state)]',
        selected
          ? 'bg-white/[0.08] shadow-[inset_0_0_0_2px_var(--color-gold)]'
          : interactive
            ? 'bg-white/[0.035] hover:bg-white/[0.06]'
            : 'bg-white/[0.02]',
      ].join(' ')}
    >
      {interactive && (
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={`h-4 w-4 transition-colors ${selected ? 'text-gold' : 'text-text-4 group-hover:text-text-3'}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M8 3v10M3 8h10" />
        </svg>
      )}
    </button>
  )
}
