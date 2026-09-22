import { Alert } from './Field'

/*
 * A number you change with your thumb: the label and its hint on one line,
 * then a recessed readout flanked by two round keys. The value is tabular so
 * it never shifts as it counts.
 *
 * `steps` replaces min/max/step with an explicit ascending list, for a setting
 * whose allowed values are not evenly spaced — a clock that runs 60, 90 … 300
 * and then has "no limit" hanging off the bottom, with nothing in between.
 */
export default function Stepper({
  label,
  hint,
  warning,
  value,
  onChange,
  min = 1,
  max = 10,
  step = 1,
  steps = null,
  disabled = false,
  format = (v) => v,
}) {
  const list = Array.isArray(steps) && steps.length > 0 ? steps : null
  const lo = list ? list[0] : min
  const hi = list ? list[list.length - 1] : max

  // One move along the list, or one step of arithmetic. A value that is not on
  // the list (an older lobby, a hand-edited row) moves to the nearest one in
  // the direction of travel rather than refusing to budge.
  const nudge = (direction) => {
    if (!list) return Math.min(max, Math.max(min, value + direction * step))

    const here = list.indexOf(value)
    if (here !== -1) {
      return list[Math.min(list.length - 1, Math.max(0, here + direction))]
    }
    return direction > 0
      ? (list.find((v) => v > value) ?? hi)
      : ([...list].reverse().find((v) => v < value) ?? lo)
  }

  const atMin = value <= lo
  const atMax = value >= hi

  const key = (off) =>
    [
      'pill pressable fill-soft grid h-12 w-12 shrink-0 place-items-center',
      'text-title2 font-medium text-text',
      off ? 'opacity-40' : '',
      'disabled:pointer-events-none',
    ].join(' ')

  return (
    <div className={disabled ? 'opacity-50' : ''}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-footnote font-semibold text-text-2">{label}</span>
        {hint && <span className="text-caption text-text-3">{hint}</span>}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={key(disabled || atMin)}
          onClick={() => onChange(nudge(-1))}
          disabled={disabled || atMin}
          aria-label={`Decrease ${label}`}
        >
          <span aria-hidden="true" className="-mt-px">
            &minus;
          </span>
        </button>

        <output
          className="surface-sunken tabular grid h-12 min-w-0 flex-1 place-items-center text-title2 font-semibold text-text"
          aria-live="polite"
        >
          {format(value)}
        </output>

        <button
          type="button"
          className={key(disabled || atMax)}
          onClick={() => onChange(nudge(1))}
          disabled={disabled || atMax}
          aria-label={`Increase ${label}`}
        >
          <span aria-hidden="true" className="-mt-px">
            +
          </span>
        </button>
      </div>

      {warning && <Alert>{warning}</Alert>}
    </div>
  )
}
