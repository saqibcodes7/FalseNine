/*
 * One shape for everything you press: a pill.
 *
 *   primary    filled in the surrounding accent    the one thing to do next
 *   secondary  the material, ringed                 the other reasonable thing
 *   danger     filled crimson                       leave, close, destroy
 *   quiet      text only                            back out, cancel
 *
 * Height follows Apple's touch guidance rather than the text: 44pt minimum,
 * 50pt for the prominent one at the bottom of a screen.
 */
const SIZES = {
  sm: 'h-11 px-5 text-subhead',
  md: 'h-12 px-6 text-callout',
  lg: 'h-[3.25rem] px-7 text-body',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  type = 'button',
  disabled = false,
  children,
  ...rest
}) {
  const base = [
    'pill pressable inline-flex items-center justify-center gap-2 select-none',
    'font-semibold whitespace-nowrap',
    'disabled:pointer-events-none',
    fullWidth ? 'w-full' : '',
    SIZES[size] ?? SIZES.md,
  ]

  if (variant === 'quiet') {
    return (
      <button
        type={type}
        disabled={disabled}
        className={[
          ...base,
          'text-gold transition-colors',
          'hover:text-gold-soft disabled:text-text-4',
          className,
        ].join(' ')}
        {...rest}
      >
        {children}
      </button>
    )
  }

  /* Disabled is a flat, dim, still perfectly legible plate — never a ghost. */
  const fill = disabled
    ? 'bg-white/[0.06] text-text-3 shadow-[inset_0_0_0_1px_oklch(100%_0_0/.07)]'
    : variant === 'secondary'
      ? 'fill-soft'
      : 'fill-accent'

  return (
    <button
      type={type}
      disabled={disabled}
      className={[
        ...base,
        variant === 'danger' ? 'accent-flag' : '',
        fill,
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}
