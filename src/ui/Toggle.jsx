/*
 * A physical switch: steel housing, a brass knob that slides, and the word
 * ON or OFF engraved in the track so the state never depends on colour.
 */
export default function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 ${
        disabled ? 'opacity-60' : 'cursor-pointer'
      }`}
    >
      <span className="min-w-0">
        <span className="display block text-[1.15rem] tracking-[0.12em] text-gold engraved">
          {label}
        </span>
        {description && (
          <span className="mt-1 block text-small leading-snug text-chalk-1">
            {description}
          </span>
        )}
      </span>

      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />

        {/* housing */}
        <span
          aria-hidden="true"
          className={`frame frame-sm block h-8 w-[4.25rem] ${
            checked ? 'metal-steel' : 'metal-steel'
          } peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lime`}
          style={{ '--fr': '999px', '--fw': '2px' }}
        >
          <span
            className={`frame-inner plate display relative block h-full rounded-full text-[0.95rem] leading-none tracking-[0.14em] transition-colors duration-200 ${
              checked ? 'enamel-lime raised' : 'enamel-ink-deep engraved'
            }`}
          >
            <span
              className={`absolute top-1/2 -translate-y-1/2 pt-[0.15em] ${
                checked ? 'left-2.5' : 'right-2.5 text-chalk-2'
              }`}
            >
              {checked ? 'ON' : 'OFF'}
            </span>
          </span>
        </span>

        {/* knob */}
        <span
          aria-hidden="true"
          className={`disc metal-gold pointer-events-none absolute top-[5px] h-[22px] w-[22px] transition-transform duration-200 ease-[var(--ease-out)] ${
            checked ? 'translate-x-[2.55rem]' : 'translate-x-[5px]'
          }`}
          style={{ left: 0 }}
        />
      </span>
    </label>
  )
}
