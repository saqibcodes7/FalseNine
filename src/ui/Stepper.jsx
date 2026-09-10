import { Alert } from './Field'

/*
 * A numeric control built like a scoreboard: two steel keys either side of an
 * enamel readout with Teko digits. `format` turns raw seconds into "3:00".
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

  const key = (extra) =>
    [
      'frame frame-sm metal-steel block h-12 w-12 shrink-0 select-none touch-manipulation',
      'transition-[filter] duration-150 hover:brightness-110',
      'disabled:pointer-events-none',
      extra,
    ].join(' ')

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="display text-[1.15rem] tracking-[0.12em] text-gold engraved">
          {label}
        </span>
        {hint && <span className="text-meta font-medium text-chalk-2">{hint}</span>}
      </div>

      <div className="flex items-stretch gap-2">
        <button
          type="button"
          className={key(disabled || atMin ? 'opacity-100' : '')}
          onClick={() => onChange(clamp(value - step))}
          disabled={disabled || atMin}
          aria-label={`Decrease ${label}`}
          style={{ '--fr': '8px', '--fw': '2px' }}
        >
          <span
            className={`frame-inner plate plate-pressable display grid h-full place-items-center text-[1.75rem] leading-none ${
              disabled || atMin ? 'enamel-ink-deep text-chalk-2!' : 'enamel-ink engraved'
            }`}
            style={{ paddingTop: '0.1em' }}
            aria-hidden="true"
          >
            &minus;
          </span>
        </button>

        <output
          className="frame frame-sm metal-steel block min-w-0 flex-1"
          style={{ '--fr': '8px', '--fw': '2px' }}
          aria-live="polite"
        >
          <span
            className="frame-inner plate enamel-ink-deep display tabular block h-12 text-center text-[2.1rem] leading-none tracking-[0.06em] text-lime"
            style={{ paddingTop: '0.32em' }}
          >
            {format(value)}
          </span>
        </output>

        <button
          type="button"
          className={key('')}
          onClick={() => onChange(clamp(value + step))}
          disabled={disabled || atMax}
          aria-label={`Increase ${label}`}
          style={{ '--fr': '8px', '--fw': '2px' }}
        >
          <span
            className={`frame-inner plate plate-pressable display grid h-full place-items-center text-[1.75rem] leading-none ${
              disabled || atMax ? 'enamel-ink-deep text-chalk-2!' : 'enamel-ink engraved'
            }`}
            style={{ paddingTop: '0.1em' }}
            aria-hidden="true"
          >
            +
          </span>
        </button>
      </div>

      {warning && <Alert>{warning}</Alert>}
    </div>
  )
}
