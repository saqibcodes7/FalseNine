import Segmented from '../Segmented'
import { TTT_DIFFICULTIES, getTttDifficulty } from '../../data/tttDifficulties'

/*
 * Difficulty, for whoever may change it. Everyone else gets DifficultyReadout.
 * The line under it says what the choice means, not how it is worked out.
 */
export default function DifficultyPicker({ value, onChange, disabled = false, label = 'Difficulty', hint }) {
  return (
    <div>
      <Segmented
        label={label}
        hint={hint}
        options={TTT_DIFFICULTIES.map((d) => ({ id: d.id, name: d.name }))}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      <p className="mt-2 text-footnote leading-snug text-text-3" data-testid="ttt-difficulty-blurb">
        {getTttDifficulty(value).blurb}
      </p>
    </div>
  )
}

export function DifficultyReadout({ value }) {
  const difficulty = getTttDifficulty(value)
  return (
    <div data-testid="ttt-difficulty-readout">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-subhead text-text-2">Difficulty</span>
        <span className="text-callout font-semibold text-text">{difficulty.name}</span>
      </div>
      <p className="mt-1.5 text-footnote leading-snug text-text-3">{difficulty.blurb}</p>
    </div>
  )
}
