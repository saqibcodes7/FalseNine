const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold ' +
  'transition-[transform,background-color,border-color,opacity] duration-150 ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 ' +
  'select-none touch-manipulation'

const VARIANTS = {
  primary:
    'bg-lime-400 text-pitch-950 hover:bg-lime-300 active:bg-lime-600 ' +
    // The glow is an "this is live, press me" cue, so it goes when disabled.
    'shadow-[0_0_28px_-8px_var(--color-lime-400)] disabled:shadow-none',
  secondary:
    'bg-pitch-800 text-chalk-100 border border-pitch-600 hover:border-lime-400 hover:text-lime-400',
  ghost: 'bg-transparent text-chalk-400 hover:text-chalk-100',
  danger:
    'bg-transparent text-flag-500 border border-flag-500/40 hover:bg-flag-500/10',
}

const SIZES = {
  // 44px+ tall throughout: these get tapped with thumbs, not clicked with a mouse.
  sm: 'h-10 px-4 text-sm',
  md: 'h-12 px-5 text-base',
  lg: 'h-14 px-6 text-lg',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  type = 'button',
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      className={[
        BASE,
        VARIANTS[variant] ?? VARIANTS.primary,
        SIZES[size] ?? SIZES.md,
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}
