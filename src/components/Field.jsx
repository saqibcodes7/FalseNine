import { useId } from 'react'

export default function Field({
  label,
  hint,
  error,
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
        className="mb-2 block text-sm font-semibold text-chalk-100"
      >
        {label}
      </label>

      <input
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={
          [error ? errorId : null, hint ? hintId : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        className={[
          'w-full rounded-xl border bg-pitch-900 px-4 py-3.5 text-base text-chalk-100',
          'placeholder:text-chalk-600 transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-lime-400/60',
          error
            ? 'border-flag-500 focus:border-flag-500'
            : 'border-pitch-700 focus:border-lime-400',
          inputClassName,
        ].join(' ')}
        {...inputProps}
      />

      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-sm text-flag-500">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-2 text-sm text-chalk-600">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
