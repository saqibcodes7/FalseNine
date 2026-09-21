/*
 * A small tinted pill carrying one word of state. Chips always say what they
 * mean — "Host", "You", "Out", "Imposter" — so no state in this interface is
 * ever carried by colour on its own.
 */
const TONES = {
  gold: 'accent-gold',
  go: 'accent-go',
  flag: 'accent-flag',
  crimson: 'accent-crimson',
  royal: 'accent-royal',
  neutral: 'accent-neutral',
}

export default function Chip({ tone = 'neutral', className = '', children, ...rest }) {
  return (
    <span
      className={[
        'pill fill-tinted inline-flex shrink-0 items-center px-2.5 py-1',
        'text-caption font-semibold tracking-[0.01em] whitespace-nowrap',
        TONES[tone] ?? TONES.neutral,
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </span>
  )
}
