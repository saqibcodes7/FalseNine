import { useId } from 'react'

/*
 * A text field is a recess in the panel: dark, hairlined, no border of its
 * own. The label sits above it in quiet type and the message below it, so the
 * field never changes height when an error appears.
 *
 *   variant 'text'  ordinary 17pt input
 *   variant 'code'  the join code: big, tabular, letterspaced, gold
 */
const INPUT = {
  text: 'text-body text-text px-4 py-3.5 placeholder:text-text-4',
  code: 'tabular text-center text-[2rem] font-semibold tracking-[0.28em] pl-[0.28em] py-3 text-gold placeholder:text-text-4 uppercase',
}

function Alert({ id, children }) {
  return (
    <p
      id={id}
      role="alert"
      className="mt-2 flex items-start gap-1.5 text-footnote font-medium text-flag"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="mt-[2px] h-[14px] w-[14px] shrink-0"
        fill="currentColor"
      >
        <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm0 3.4c.5 0 .9.4.86.9l-.23 3.9a.63.63 0 0 1-1.26 0l-.23-3.9c-.03-.5.36-.9.86-.9Zm0 8.9a.95.95 0 1 1 0-1.9.95.95 0 0 1 0 1.9Z" />
      </svg>
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
      {label && (
        <label htmlFor={id} className="mb-2 block text-footnote font-semibold text-text-2">
          {label}
        </label>
      )}

      <div className="surface-sunken transition-shadow duration-200 focus-within:shadow-[inset_0_0_0_1.5px_var(--color-gold),inset_0_1px_3px_oklch(0%_0_0/.3)]">
        <input
          id={id}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={
            [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
            undefined
          }
          className={[
            'block w-full bg-transparent outline-none',
            INPUT[variant] ?? INPUT.text,
            inputClassName,
          ].join(' ')}
          {...inputProps}
        />
      </div>

      {error ? (
        <Alert id={errorId}>{error}</Alert>
      ) : hint ? (
        <p id={hintId} className="mt-2 text-footnote text-text-3">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export { Alert }
