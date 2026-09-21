import { Alert } from './Field'

/*
 * A number you change with your thumb: the label and its hint on one line,
 * then a recessed readout flanked by two round keys. The value is tabular so
 * it never shifts as it counts.
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
  disabled = false,
  format = (v) => v,
}) {
  const clamp = (v) => Math.min(max, Math.max(min, v))
  const atMin = value <= min
  const atMax = value >= max

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
          onClick={() => onChange(clamp(value - step))}
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
          onClick={() => onChange(clamp(value + step))}
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
