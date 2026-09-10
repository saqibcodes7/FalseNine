import { useId } from 'react'

/*
 * A text field is a recess cut into the panel: dark enamel, a steel hairline,
 * the label engraved above it in Teko. Focus brings the lime rim up.
 *
 *   variant 'text'  ordinary Saira input
 *   variant 'code'  the join code, set like the host's scoreboard: Teko,
 *                   big, letterspaced, lime
 */
const INPUT = {
  text: 'font-ui text-body font-medium px-4 py-3.5 text-chalk-0 placeholder:text-chalk-2',
  code: 'display text-center text-[2.5rem] tracking-[0.34em] pl-[0.34em] pr-0 pt-3 pb-1.5 text-lime placeholder:text-ink-4',
}

function Alert({ id, children }) {
  return (
    <p id={id} role="alert" className="mt-2 flex items-start gap-2 text-small font-medium text-flag">
      <span
        aria-hidden="true"
        className="display mt-[1px] inline-grid h-4 w-4 shrink-0 place-items-center rounded-[3px] bg-flag pt-[2px] text-[0.8rem] leading-none text-ink-0"
      >
        !
      </span>
      {children}
    </p>
  )
}

export default function Field({
  label,
  hint,
  error,
  variant = 'text',
  className = '',
  inputClassName = '',
  ...inputProps
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="display mb-2 block text-[1.15rem] tracking-[0.12em] text-gold engraved"
      >
        {label}
      </label>

      <div
        className="frame frame-sm metal-steel frame-focus transition-[background] duration-150"
        style={{ '--fr': '8px', '--fw': '2px' }}
      >
        <input
          id={id}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={
            [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
            undefined
          }
          className={[
            'frame-inner block w-full bg-ink-1 outline-none',
            'shadow-[inset_0_2px_8px_oklch(0%_0_0/.55)]',
            INPUT[variant] ?? INPUT.text,
            inputClassName,
          ].join(' ')}
          style={{ borderRadius: '6px' }}
          {...inputProps}
        />
      </div>

      {error ? (
        <Alert id={errorId}>{error}</Alert>
      ) : hint ? (
        <p id={hintId} className="mt-2 text-small text-chalk-2">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export { Alert }
