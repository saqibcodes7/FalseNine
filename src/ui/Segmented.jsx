import { useId } from 'react'

/*
 * A segmented control: one recessed track, and a pale pill that slides to the
 * chosen option. The pill is what carries the selection, not colour, so it
 * reads at a glance and in monochrome.
 *
 * Behaves as a radio group — arrow keys move, Home and End jump.
 *
 *   options  [{ id, name, meta? }]   meta is the small line under the name
 */
export default function Segmented({
  label,
  hint,
  options,
  value,
  onChange,
  disabled = false,
}) {
  const id = useId()
  const index = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  )

  function onKeyDown(event) {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    let next = null
    if (event.key in keys) next = (index + keys[event.key] + options.length) % options.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = options.length - 1
    if (next === null) return
    event.preventDefault()
    onChange(options[next].id)
    event.currentTarget.querySelectorAll('[role="radio"]')[next]?.focus()
  }

  return (
    <div className={disabled ? 'opacity-50' : ''}>
      {(label || hint) && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {label && (
            <span id={`${id}-label`} className="text-footnote font-semibold text-text-2">
              {label}
            </span>
          )}
          {hint && <span className="text-caption text-text-3">{hint}</span>}
        </div>
      )}

      <div
        role="radiogroup"
        aria-labelledby={label ? `${id}-label` : undefined}
        onKeyDown={disabled ? undefined : onKeyDown}
        className="surface-sunken relative p-1"
      >
        {/* the selection, sliding */}
        <span
          aria-hidden="true"
          className="fill-soft pointer-events-none absolute inset-y-1 rounded-[9px] transition-transform duration-[var(--dur-state)] ease-[var(--ease-out)]"
          style={{
            width: `calc((100% - 0.5rem) / ${options.length})`,
            transform: `translateX(calc(${index} * 100%))`,
            left: '0.25rem',
          }}
        />

        <div
          className="relative grid"
          style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
          {options.map((option, i) => {
            const selected = i === index
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                disabled={disabled}
                onClick={() => onChange(option.id)}
                className="flex min-h-11 flex-col items-center justify-center px-1 py-1.5 text-center select-none"
              >
                <span
                  className={`text-subhead leading-tight font-semibold transition-colors duration-[var(--dur-state)] ${
                    selected ? 'text-text' : 'text-text-2'
                  }`}
                >
                  {option.name}
                </span>
                {option.meta && (
                  <span
                    className={`mt-0.5 text-caption2 font-medium transition-colors duration-[var(--dur-state)] ${
                      selected ? 'text-gold' : 'text-text-4'
                    }`}
                  >
                    {option.meta}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
