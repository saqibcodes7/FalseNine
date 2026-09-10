/*
 * Buttons are enamel plates in a metal rim.
 *
 *   primary    lime enamel, steel rim     the one thing to do next
 *   secondary  ink enamel, gold rim       the other reasonable thing
 *   quiet      no plate, engraved text    back out, cancel, tertiary
 *   danger     red enamel, steel rim      leave, close, destroy
 */
const VARIANTS = {
  primary: { rim: 'metal-steel', enamel: 'enamel-lime', text: 'raised' },
  secondary: { rim: 'metal-gold', enamel: 'enamel-ink', text: 'engraved' },
  danger: { rim: 'metal-steel', enamel: 'enamel-red', text: 'engraved' },
}

const SIZES = {
  sm: 'h-10 px-4 text-[1.15rem]',
  md: 'h-12 px-5 text-[1.35rem]',
  lg: 'h-14 px-6 text-[1.6rem]',
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
  if (variant === 'quiet') {
    return (
      <button
        type={type}
        disabled={disabled}
        className={[
          'display inline-flex items-center justify-center gap-2 px-3 text-[1.2rem] text-gold engraved',
          'transition-colors duration-150 hover:text-gold-hi',
          'disabled:pointer-events-none disabled:text-chalk-2',
          SIZES[size]?.split(' ')[0] ?? 'h-12',
          fullWidth ? 'w-full' : '',
          className,
        ].join(' ')}
        {...rest}
      >
        {children}
      </button>
    )
  }

  const v = VARIANTS[variant] ?? VARIANTS.primary

  return (
    <button
      type={type}
      disabled={disabled}
      className={[
        'frame frame-sm group block select-none touch-manipulation text-left',
        'transition-[transform,filter] duration-150',
        'disabled:pointer-events-none',
        // Disabled: the plate goes cold. Metal desaturates, enamel dims, text
        // stays fully legible. Never a translucent ghost of the button.
        disabled ? 'metal-steel' : v.rim,
        fullWidth ? 'w-full' : 'inline-block',
        className,
      ].join(' ')}
      {...rest}
    >
      <span
        className={[
          'frame-inner plate display flex items-center justify-center gap-2',
          'whitespace-nowrap tracking-[0.06em]',
          v.text,
          disabled ? 'enamel-ink-deep' : `${v.enamel} plate-pressable`,
          disabled ? 'text-chalk-2!' : '',
          SIZES[size] ?? SIZES.md,
        ].join(' ')}
        style={{ paddingTop: '0.12em' }}
      >
        {children}
      </span>
    </button>
  )
}
