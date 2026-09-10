/**
 * Numeric stepper. Used for the imposter count and both timers, so it takes a
 * `step` and an optional `format` for the seconds -> "3:00" display.
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

  const btn =
    'grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-pitch-600 ' +
    'bg-pitch-900 text-xl leading-none font-bold text-chalk-100 transition-colors ' +
    'hover:border-lime-400 hover:text-lime-400 disabled:pointer-events-none disabled:opacity-30'

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-chalk-100">{label}</span>
        {hint && <span className="text-xs text-chalk-600">{hint}</span>}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className={btn}
          onClick={() => onChange(clamp(value - step))}
          disabled={disabled || atMin}
          aria-label={`Decrease ${label}`}
        >
          &minus;
        </button>

        <output
          className="tabular flex-1 rounded-lg border border-pitch-700 bg-pitch-900 py-2.5 text-center text-lg font-bold text-lime-400"
          aria-live="polite"
        >
          {format(value)}
        </output>

        <button
          type="button"
          className={btn}
          onClick={() => onChange(clamp(value + step))}
          disabled={disabled || atMax}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>

      {warning && (
        <p role="alert" className="mt-2 text-sm text-flag-500">
          {warning}
        </p>
      )}
    </div>
  )
}
