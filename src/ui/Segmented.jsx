import { useId } from 'react'

/*
 * A row of enamel keys in one steel housing, exactly one of them lit. The
 * lit key is lime with the word stamped up; the others are dark with the
 * word cut in, so the choice reads without colour and at arm's length.
 *
 * Behaves as a radio group: arrow keys move the selection, Home/End jump.
 *
 *   options  [{ id, name, meta? }]   meta is the small line under the name
 *   value    the selected id
 */
export default function Segmented({ label, hint, options, value, onChange, disabled = false }) {
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
    <div className={disabled ? 'opacity-60' : ''}>
      {(label || hint) && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {label && (
            <span id={`${id}-label`} className="display text-[1.15rem] tracking-[0.12em] text-gold engraved">
              {label}
            </span>
          )}
          {hint && <span className="text-meta font-medium text-chalk-2">{hint}</span>}
        </div>
      )}

      <div
        role="radiogroup"
        aria-labelledby={label ? `${id}-label` : undefined}
        onKeyDown={disabled ? undefined : onKeyDown}
        className="frame frame-sm metal-steel"
        style={{ '--fr': '8px', '--fw': '2px' }}
      >
        {/* the housing shows through the 2px gaps between keys */}
        <div
          className="grid gap-[2px] overflow-hidden rounded-[6px]"
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
                className={[
                  'plate plate-pressable flex min-h-12 flex-col items-center justify-center px-1 py-2 text-center select-none touch-manipulation',
                  'transition-colors duration-[var(--dur-state)]',
                  selected ? 'enamel-lime raised' : 'enamel-ink-deep engraved',
                ].join(' ')}
              >
                <span
                  className={`display block text-[clamp(0.9rem,4.2vw,1.05rem)] leading-[0.95] tracking-[0.06em] ${
                    selected ? 'text-on-lime' : 'text-chalk-1'
                  }`}
                  style={{ paddingTop: '0.15em' }}
                >
                  {option.name}
                </span>
                {option.meta && (
                  <span
                    className={`mt-1 block text-[0.65rem] font-semibold uppercase tracking-[0.14em] ${
                      selected ? 'text-on-lime/80' : 'text-chalk-2'
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
