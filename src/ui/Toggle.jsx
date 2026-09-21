/*
 * A switch. The knob's position carries the state, the word beside it says
 * the same thing in language, and the colour is the third signal rather than
 * the only one.
 */
export default function Toggle({ label, description, checked, onChange, disabled = false }) {
  return (
    <label
      className={`flex items-start justify-between gap-4 ${
        disabled ? 'opacity-50' : 'cursor-pointer'
      }`}
    >
      <span className="min-w-0">
        <span className="block text-callout font-semibold text-text">{label}</span>
        {description && (
          <span className="mt-0.5 block text-footnote leading-snug text-text-2">
            {description}
          </span>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-2.5 pt-0.5">
        <span
          aria-hidden="true"
          className={`w-7 text-right text-caption font-semibold ${
            checked ? 'text-go' : 'text-text-3'
          }`}
        >
          {checked ? 'On' : 'Off'}
        </span>

        <span className="relative">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />

          {/* track */}
          <span
            aria-hidden="true"
            className={[
              'accent-go block h-[31px] w-[51px] rounded-full transition-colors duration-[var(--dur-state)]',
              'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold',
              checked
                ? 'fill-accent'
                : 'bg-white/[0.12] shadow-[inset_0_0_0_1px_oklch(100%_0_0/.08)]',
            ].join(' ')}
          >
            {/* knob */}
            <span
              className={[
                'absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white',
                'shadow-[0_2px_5px_oklch(0%_0_0/.35),0_0_1px_oklch(0%_0_0/.25)]',
                'transition-transform duration-[var(--dur-state)] ease-[var(--ease-out)]',
                checked ? 'translate-x-5' : 'translate-x-0',
              ].join(' ')}
            />
          </span>
        </span>
      </span>
    </label>
  )
}
